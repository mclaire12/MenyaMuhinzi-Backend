import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecordStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { isAdmin } from '../../groups/facilitator-groups.service';
import type {
  CreateKnowledgeTopicDto,
  KnowledgeTopicResponseDto,
  ListKnowledgeTopicsQueryDto,
  UpdateKnowledgeTopicDto,
} from '../dto/knowledge-topic.dto';
import { AuditEntity, KnowledgeAuditAction } from '../knowledge.constants';

const cleanKeywords = (keywords: string[] | undefined) =>
  keywords
    ? [...new Set(keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean))]
    : undefined;

@Injectable()
export class KnowledgeTopicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(
    query: ListKnowledgeTopicsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<KnowledgeTopicResponseDto[]> {
    const status = isAdmin(actor) ? query.status : RecordStatus.ACTIVE;
    return this.prisma.knowledgeTopic.findMany({
      where: status ? { status } : {},
      orderBy: { nameEn: 'asc' },
    });
  }

  async create(
    dto: CreateKnowledgeTopicDto,
    actor: AuthenticatedUser,
  ): Promise<KnowledgeTopicResponseDto> {
    await this.assertNamesFree(dto.nameEn, dto.nameRw, undefined, dto.code);
    return this.prisma.$transaction(async (tx) => {
      const topic = await tx.knowledgeTopic.create({
        data: { ...dto, keywords: cleanKeywords(dto.keywords) ?? [] },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: KnowledgeAuditAction.TopicCreated,
          entityType: AuditEntity.Topic,
          entityId: topic.id,
          details: { code: topic.code },
        },
        tx,
      );
      return topic;
    });
  }

  async update(
    id: string,
    dto: UpdateKnowledgeTopicDto,
    actor: AuthenticatedUser,
  ): Promise<KnowledgeTopicResponseDto> {
    await this.require(id);
    await this.assertNamesFree(dto.nameEn, dto.nameRw, id);
    return this.prisma.$transaction(async (tx) => {
      const topic = await tx.knowledgeTopic.update({
        where: { id },
        data: { ...dto, keywords: cleanKeywords(dto.keywords) },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: KnowledgeAuditAction.TopicUpdated,
          entityType: AuditEntity.Topic,
          entityId: id,
          details: { fields: Object.keys(dto) },
        },
        tx,
      );
      return topic;
    });
  }

  /** Topics are referenced by sources and glossary terms, so they are deactivated rather than deleted. */
  async deactivate(id: string, actor: AuthenticatedUser): Promise<KnowledgeTopicResponseDto> {
    await this.require(id);
    return this.prisma.$transaction(async (tx) => {
      const topic = await tx.knowledgeTopic.update({
        where: { id },
        data: { status: RecordStatus.INACTIVE },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: KnowledgeAuditAction.TopicDeactivated,
          entityType: AuditEntity.Topic,
          entityId: id,
        },
        tx,
      );
      return topic;
    });
  }

  private async require(id: string) {
    const topic = await this.prisma.knowledgeTopic.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!topic) throw new NotFoundException('Topic not found');
    return topic;
  }

  private async assertNamesFree(
    nameEn?: string,
    nameRw?: string,
    exceptId?: string,
    code?: string,
  ): Promise<void> {
    const or: Prisma.KnowledgeTopicWhereInput[] = [];
    if (code) or.push({ code });
    if (nameEn) or.push({ nameEn: { equals: nameEn, mode: 'insensitive' } });
    if (nameRw) or.push({ nameRw: { equals: nameRw, mode: 'insensitive' } });
    if (or.length === 0) return;
    const clash = await this.prisma.knowledgeTopic.findFirst({
      where: { OR: or, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictException('A topic with this code or name already exists');
  }
}
