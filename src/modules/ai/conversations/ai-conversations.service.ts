import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../../common/dto/pagination.dto';
import { AiConversationStatus, AiMessageRole, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { AiAuditAction, AiAuditEntity, PROVIDER_NOT_CONFIGURED_NOTICE } from '../ai.constants';
import { AiAssistantsService } from '../assistants/ai-assistants.service';
import type { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import type {
  AdminListConversationsQueryDto,
  ConversationDetailResponseDto,
  ConversationResponseDto,
  ListConversationsQueryDto,
  MessageResponseDto,
  PostMessageDto,
  PostMessageResponseDto,
  RenameConversationDto,
  StartConversationDto,
} from '../dto/conversation.dto';
import { AiOrchestratorService } from '../orchestration/ai-orchestrator.service';
import {
  conversationInclude,
  messageInclude,
  requestInclude,
  toConversationResponse,
  toMessageResponse,
  toRequestResponse,
  type ConversationRecord,
} from './ai.mappers';

const DETAIL_MESSAGE_LIMIT = 50;

/** Conversations belong to one user; other users never see them through these methods. */
@Injectable()
export class AiConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assistants: AiAssistantsService,
    private readonly orchestrator: AiOrchestratorService,
  ) {}

  async start(
    dto: StartConversationDto,
    actor: AuthenticatedUser,
  ): Promise<ConversationResponseDto> {
    const assistant = await this.assistants.requireUsable(dto.assistantId, actor);
    const language = dto.language ?? assistant.defaultLanguage;
    if (!assistant.supportedLanguages.includes(language)) {
      throw new BadRequestException('The assistant does not support this language');
    }
    const row = await this.prisma.aiConversation.create({
      data: {
        userId: actor.id,
        assistantId: assistant.id,
        title: dto.title ?? `${assistant.name} conversation`,
        language,
      },
      include: conversationInclude,
    });
    return toConversationResponse(row);
  }

  async listOwn(
    actor: AuthenticatedUser,
    query: ListConversationsQueryDto,
  ): Promise<Paginated<ConversationResponseDto>> {
    return this.listWhere({ ...this.filters(query), userId: actor.id }, query);
  }

  async findOwn(id: string, actor: AuthenticatedUser): Promise<ConversationDetailResponseDto> {
    return this.detail(await this.requireOwn(id, actor));
  }

  async rename(
    id: string,
    dto: RenameConversationDto,
    actor: AuthenticatedUser,
  ): Promise<ConversationResponseDto> {
    await this.requireOwn(id, actor);
    const row = await this.prisma.aiConversation.update({
      where: { id },
      data: { title: dto.title },
      include: conversationInclude,
    });
    return toConversationResponse(row);
  }

  async archive(id: string, actor: AuthenticatedUser): Promise<ConversationResponseDto> {
    const current = await this.requireOwn(id, actor);
    if (current.status === AiConversationStatus.ARCHIVED) return toConversationResponse(current);
    const row = await this.prisma.aiConversation.update({
      where: { id },
      data: { status: AiConversationStatus.ARCHIVED, archivedAt: new Date() },
      include: conversationInclude,
    });
    return toConversationResponse(row);
  }

  async close(id: string, actor: AuthenticatedUser): Promise<ConversationResponseDto> {
    const current = await this.requireOwn(id, actor);
    if (current.status === AiConversationStatus.CLOSED) return toConversationResponse(current);
    if (current.status === AiConversationStatus.ARCHIVED) {
      throw new ConflictException('Archived conversations cannot be closed');
    }
    const row = await this.prisma.aiConversation.update({
      where: { id },
      data: { status: AiConversationStatus.CLOSED, closedAt: new Date() },
      include: conversationInclude,
    });
    return toConversationResponse(row);
  }

  async listMessages(
    id: string,
    actor: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<Paginated<MessageResponseDto>> {
    await this.requireOwn(id, actor);
    const where = { conversationId: id };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.aiMessage.count({ where }),
      this.prisma.aiMessage.findMany({
        where,
        include: messageInclude,
        orderBy: { sequence: 'asc' },
        ...paginationArgs(query),
      }),
    ]);
    return paginated(rows.map(toMessageResponse), total, query);
  }

  /**
   * Stores the user's message and an AI request for it, then queues the request. No answer
   * is produced while no AI provider is configured; the response says so explicitly.
   */
  async postMessage(
    id: string,
    dto: PostMessageDto,
    actor: AuthenticatedUser,
  ): Promise<PostMessageResponseDto> {
    const conversation = await this.requireOwn(id, actor);
    if (dto.clientRequestId) {
      const existing = await this.findByClientRequestId(id, dto.clientRequestId);
      if (existing) return existing;
    }
    if (conversation.status !== AiConversationStatus.ACTIVE) {
      throw new ConflictException(
        `The conversation is ${conversation.status.toLowerCase()}; start a new one to continue`,
      );
    }
    const assistant = await this.assistants.requireUsable(conversation.assistantId, actor);
    const language = dto.language ?? conversation.language;
    if (!assistant.supportedLanguages.includes(language)) {
      throw new BadRequestException('The assistant does not support this language');
    }
    const plan = await this.orchestrator.plan(assistant.id);

    let created: { messageId: string; requestId: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const bumped = await tx.aiConversation.update({
          where: { id },
          data: { messageCount: { increment: 1 }, lastActivityAt: now },
          select: { messageCount: true },
        });
        const message = await tx.aiMessage.create({
          data: {
            conversationId: id,
            sequence: bumped.messageCount,
            role: AiMessageRole.USER,
            content: dto.content,
            language,
            clientRequestId: dto.clientRequestId,
          },
          select: { id: true },
        });
        const request = await tx.aiRequest.create({
          data: {
            userId: actor.id,
            assistantId: assistant.id,
            conversationId: id,
            userMessageId: message.id,
            modelConfigurationId: plan.configurationId,
            promptVersionId: plan.promptVersionIds[0] ?? null,
            promptVersionIds: plan.promptVersionIds,
            policyVersionIds: plan.policyVersionIds,
            metadata: { assistantVersion: assistant.currentVersion },
          },
          select: { id: true },
        });
        return { messageId: message.id, requestId: request.id };
      });
    } catch (error) {
      if (
        dto.clientRequestId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.findByClientRequestId(id, dto.clientRequestId);
        if (existing) return existing;
      }
      throw error;
    }

    await this.orchestrator.dispatch(created.requestId, plan);
    const [message, request] = await Promise.all([
      this.prisma.aiMessage.findUniqueOrThrow({
        where: { id: created.messageId },
        include: messageInclude,
      }),
      this.prisma.aiRequest.findUniqueOrThrow({
        where: { id: created.requestId },
        include: requestInclude,
      }),
    ]);
    return {
      message: toMessageResponse(message),
      request: toRequestResponse(request),
      execution: this.notice(plan.providerConfigured),
      duplicate: false,
    };
  }

  // ------------------------------------------------------------------ admin oversight

  async adminList(
    query: AdminListConversationsQueryDto,
  ): Promise<Paginated<ConversationResponseDto>> {
    return this.listWhere(
      { ...this.filters(query), ...(query.userId ? { userId: query.userId } : {}) },
      query,
    );
  }

  /** Viewing another user's conversation is recorded in the audit log. */
  async adminFindOne(id: string, actor: AuthenticatedUser): Promise<ConversationDetailResponseDto> {
    const row = await this.prisma.aiConversation.findUnique({
      where: { id },
      include: conversationInclude,
    });
    if (!row) throw new NotFoundException('Conversation not found');
    if (row.userId !== actor.id) {
      await this.audit.record({
        actorId: actor.id,
        action: AiAuditAction.ConversationViewed,
        entityType: AiAuditEntity.Conversation,
        entityId: id,
        details: { ownerId: row.userId },
      });
    }
    return this.detail(row);
  }

  // ------------------------------------------------------------------ helpers

  private notice(providerConfigured: boolean) {
    return {
      providerConfigured,
      message: providerConfigured
        ? 'The request was queued for processing.'
        : PROVIDER_NOT_CONFIGURED_NOTICE,
    };
  }

  private async findByClientRequestId(
    conversationId: string,
    clientRequestId: string,
  ): Promise<PostMessageResponseDto | null> {
    const message = await this.prisma.aiMessage.findUnique({
      where: { conversationId_clientRequestId: { conversationId, clientRequestId } },
      include: { ...messageInclude, requestAsUser: { include: requestInclude } },
    });
    if (!message?.requestAsUser) return null;
    const providerConfigured = await this.orchestrator.providerConfiguredFor(
      message.requestAsUser.modelConfigurationId,
    );
    return {
      message: toMessageResponse(message),
      request: toRequestResponse(message.requestAsUser),
      execution: this.notice(providerConfigured),
      duplicate: true,
    };
  }

  private filters(query: ListConversationsQueryDto): Prisma.AiConversationWhereInput {
    return {
      ...(query.status ? { status: query.status } : {}),
      ...(query.assistantId ? { assistantId: query.assistantId } : {}),
    };
  }

  private async listWhere(
    where: Prisma.AiConversationWhereInput,
    query: PaginationQueryDto,
  ): Promise<Paginated<ConversationResponseDto>> {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.aiConversation.count({ where }),
      this.prisma.aiConversation.findMany({
        where,
        include: conversationInclude,
        orderBy: [{ lastActivityAt: 'desc' }, { id: 'asc' }],
        ...paginationArgs(query),
      }),
    ]);
    return paginated(rows.map(toConversationResponse), total, query);
  }

  private async detail(row: ConversationRecord): Promise<ConversationDetailResponseDto> {
    const messages = await this.prisma.aiMessage.findMany({
      where: { conversationId: row.id },
      include: messageInclude,
      orderBy: { sequence: 'desc' },
      take: DETAIL_MESSAGE_LIMIT,
    });
    return {
      ...toConversationResponse(row),
      messages: messages.reverse().map(toMessageResponse),
    };
  }

  /** Other users' conversations are reported as not found so their existence is not revealed. */
  private async requireOwn(id: string, actor: AuthenticatedUser): Promise<ConversationRecord> {
    const row = await this.prisma.aiConversation.findFirst({
      where: { id, userId: actor.id },
      include: conversationInclude,
    });
    if (!row) throw new NotFoundException('Conversation not found');
    return row;
  }
}
