import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../../common/dto/pagination.dto';
import {
  AiRecordStatus,
  Prisma,
  RecordStatus,
  type Language,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { assertActiveCrop, cropSummarySelect } from '../../crops/crop.lookup';
import { isAdmin } from '../../groups/facilitator-groups.service';
import { ALL_ROLE_CODES } from '../../roles/rbac.constants';
import { AiAuditAction, AiAuditEntity } from '../ai.constants';
import type {
  AiAssistantResponseDto,
  AiAssistantSummaryDto,
  CreateAiAssistantDto,
  ListAiAssistantsQueryDto,
  SetAssistantPromptsDto,
  UpdateAiAssistantDto,
} from '../dto/assistant.dto';
import type { ConfigurationHistoryDto } from '../dto/common.dto';

export const assistantInclude = {
  crops: { include: { crop: { select: cropSummarySelect } }, orderBy: { crop: { nameEn: 'asc' } } },
  prompts: {
    include: { template: { select: { code: true, name: true, status: true } } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  },
  modelConfigurations: {
    where: { status: RecordStatus.ACTIVE },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.AiAssistantInclude;

export type AssistantRecord = Prisma.AiAssistantGetPayload<{ include: typeof assistantInclude }>;

type Tx = Prisma.TransactionClient;

@Injectable()
export class AiAssistantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ admin

  async create(
    dto: CreateAiAssistantDto,
    actor: AuthenticatedUser,
  ): Promise<AiAssistantResponseDto> {
    const defaultLanguage = dto.defaultLanguage ?? dto.supportedLanguages[0];
    this.assertSettings({
      supportedLanguages: dto.supportedLanguages,
      defaultLanguage,
      knowledgeAccess: dto.knowledgeAccess ?? false,
      requireSourceReferences: dto.requireSourceReferences ?? false,
    });
    for (const cropId of dto.cropIds ?? []) await assertActiveCrop(this.prisma, cropId);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.aiAssistant.create({
        data: {
          code: dto.code,
          name: dto.name,
          assistantType: dto.assistantType,
          purpose: dto.purpose,
          description: dto.description,
          supportedLanguages: dto.supportedLanguages,
          defaultLanguage,
          allowedRoles: dto.allowedRoles ?? ALL_ROLE_CODES,
          knowledgeAccess: dto.knowledgeAccess ?? false,
          maxKnowledgeChunks: dto.maxKnowledgeChunks ?? 5,
          requireSourceReferences: dto.requireSourceReferences ?? false,
          createdById: actor.id,
          crops: dto.cropIds?.length
            ? { create: dto.cropIds.map((cropId) => ({ cropId })) }
            : undefined,
        },
        include: assistantInclude,
      });
      await this.snapshot(tx, created, actor, dto.changeNote);
      await this.record(tx, actor, AiAuditAction.AssistantCreated, created.id, {
        code: created.code,
        assistantType: created.assistantType,
      });
      return created;
    });
    return this.toResponse(row);
  }

  async list(query: ListAiAssistantsQueryDto): Promise<Paginated<AiAssistantResponseDto>> {
    const where: Prisma.AiAssistantWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.assistantType ? { assistantType: query.assistantType } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.aiAssistant.count({ where }),
      this.prisma.aiAssistant.findMany({
        where,
        include: assistantInclude,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...paginationArgs(query),
      }),
    ]);
    return paginated(
      rows.map((row) => this.toResponse(row)),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<AiAssistantResponseDto> {
    return this.toResponse(await this.require(id));
  }

  async update(
    id: string,
    dto: UpdateAiAssistantDto,
    actor: AuthenticatedUser,
  ): Promise<AiAssistantResponseDto> {
    const current = await this.requireEditable(id);
    const supportedLanguages = dto.supportedLanguages ?? current.supportedLanguages;
    let defaultLanguage = dto.defaultLanguage ?? current.defaultLanguage;
    if (!dto.defaultLanguage && !supportedLanguages.includes(defaultLanguage)) {
      defaultLanguage = supportedLanguages[0];
    }
    const knowledgeAccess = dto.knowledgeAccess ?? current.knowledgeAccess;
    this.assertSettings({
      supportedLanguages,
      defaultLanguage,
      knowledgeAccess,
      requireSourceReferences: dto.requireSourceReferences ?? current.requireSourceReferences,
    });
    const existingCrops = new Set(current.crops.map((link) => link.cropId));
    for (const cropId of dto.cropIds ?? []) {
      if (!existingCrops.has(cropId)) await assertActiveCrop(this.prisma, cropId);
    }

    const changed = Object.keys(dto).filter((key) => key !== 'changeNote');
    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.cropIds) {
        await tx.aiAssistantCrop.deleteMany({ where: { assistantId: id } });
        if (dto.cropIds.length > 0) {
          await tx.aiAssistantCrop.createMany({
            data: dto.cropIds.map((cropId) => ({ assistantId: id, cropId })),
          });
        }
      }
      const updated = await tx.aiAssistant.update({
        where: { id },
        data: {
          name: dto.name,
          assistantType: dto.assistantType,
          purpose: dto.purpose,
          description: dto.description,
          supportedLanguages,
          defaultLanguage,
          allowedRoles: dto.allowedRoles,
          knowledgeAccess,
          maxKnowledgeChunks: dto.maxKnowledgeChunks,
          requireSourceReferences: dto.requireSourceReferences,
          currentVersion: { increment: 1 },
        },
        include: assistantInclude,
      });
      await this.snapshot(tx, updated, actor, dto.changeNote);
      await this.record(tx, actor, AiAuditAction.AssistantUpdated, id, {
        version: updated.currentVersion,
        fields: changed,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  /** Replaces the prompt templates used by the assistant, in position order. */
  async setPrompts(
    id: string,
    dto: SetAssistantPromptsDto,
    actor: AuthenticatedUser,
  ): Promise<AiAssistantResponseDto> {
    await this.requireEditable(id);
    const templateIds = dto.prompts.map((link) => link.templateId);
    if (new Set(templateIds).size !== templateIds.length) {
      throw new BadRequestException('Each prompt template may be linked once');
    }
    const templates = await this.prisma.aiPromptTemplate.findMany({
      where: { id: { in: templateIds } },
      select: { id: true, status: true, versions: { select: { id: true } } },
    });
    const byId = new Map(templates.map((template) => [template.id, template]));
    for (const link of dto.prompts) {
      const template = byId.get(link.templateId);
      if (!template) throw new BadRequestException(`Prompt template ${link.templateId} not found`);
      if (template.status === AiRecordStatus.ARCHIVED) {
        throw new BadRequestException(`Prompt template ${link.templateId} is archived`);
      }
      if (
        link.pinnedVersionId &&
        !template.versions.some((version) => version.id === link.pinnedVersionId)
      ) {
        throw new BadRequestException('pinnedVersionId must be a version of the same template');
      }
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.aiAssistantPrompt.deleteMany({ where: { assistantId: id } });
      if (dto.prompts.length > 0) {
        await tx.aiAssistantPrompt.createMany({
          data: dto.prompts.map((link, index) => ({
            assistantId: id,
            templateId: link.templateId,
            pinnedVersionId: link.pinnedVersionId ?? null,
            position: link.position ?? index,
          })),
        });
      }
      const updated = await tx.aiAssistant.update({
        where: { id },
        data: { currentVersion: { increment: 1 } },
        include: assistantInclude,
      });
      await this.snapshot(tx, updated, actor, dto.changeNote);
      await this.record(tx, actor, AiAuditAction.AssistantPromptsUpdated, id, {
        version: updated.currentVersion,
        templateIds,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  activate(id: string, actor: AuthenticatedUser): Promise<AiAssistantResponseDto> {
    return this.changeStatus(id, AiRecordStatus.ACTIVE, AiAuditAction.AssistantActivated, actor);
  }

  deactivate(id: string, actor: AuthenticatedUser): Promise<AiAssistantResponseDto> {
    return this.changeStatus(
      id,
      AiRecordStatus.INACTIVE,
      AiAuditAction.AssistantDeactivated,
      actor,
    );
  }

  archive(id: string, actor: AuthenticatedUser): Promise<AiAssistantResponseDto> {
    return this.changeStatus(id, AiRecordStatus.ARCHIVED, AiAuditAction.AssistantArchived, actor);
  }

  async history(id: string): Promise<ConfigurationHistoryDto> {
    await this.require(id);
    const [versions, audit] = await Promise.all([
      this.prisma.aiAssistantVersion.findMany({
        where: { assistantId: id },
        orderBy: { version: 'desc' },
      }),
      this.audit.list(AiAuditEntity.Assistant, [id]),
    ]);
    return {
      versions: versions.map((version) => ({
        version: version.version,
        snapshot: version.snapshot,
        changeNote: version.changeNote,
        changedById: version.changedById,
        createdAt: version.createdAt,
      })),
      audit,
    };
  }

  // ------------------------------------------------------------------ users

  async listAvailable(
    actor: AuthenticatedUser,
    query: ListAiAssistantsQueryDto,
  ): Promise<Paginated<AiAssistantSummaryDto>> {
    const where: Prisma.AiAssistantWhereInput = {
      ...this.availableWhere(actor),
      ...(query.assistantType ? { assistantType: query.assistantType } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.aiAssistant.count({ where }),
      this.prisma.aiAssistant.findMany({
        where,
        include: assistantInclude,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...paginationArgs(query),
      }),
    ]);
    return paginated(
      rows.map((row) => this.toSummary(row)),
      total,
      query,
    );
  }

  async findAvailable(id: string, actor: AuthenticatedUser): Promise<AiAssistantSummaryDto> {
    const row = await this.prisma.aiAssistant.findFirst({
      where: { id, ...this.availableWhere(actor) },
      include: assistantInclude,
    });
    if (!row) throw new NotFoundException('Assistant not found');
    return this.toSummary(row);
  }

  /**
   * The assistant if the actor may use it now. Unknown assistants and assistants not offered
   * to the actor's roles are reported as not found; inactive or archived ones as a conflict.
   */
  async requireUsable(id: string, actor: AuthenticatedUser) {
    const row = await this.prisma.aiAssistant.findUnique({ where: { id } });
    if (!row || !this.roleAllowed(row.allowedRoles, actor)) {
      throw new NotFoundException('Assistant not found');
    }
    if (row.status !== AiRecordStatus.ACTIVE) {
      throw new ConflictException('Assistant is not available');
    }
    return row;
  }

  roleAllowed(allowedRoles: string[], actor: AuthenticatedUser): boolean {
    return isAdmin(actor) || actor.roles.some((role) => allowedRoles.includes(role));
  }

  // ------------------------------------------------------------------ helpers

  private availableWhere(actor: AuthenticatedUser): Prisma.AiAssistantWhereInput {
    return {
      status: AiRecordStatus.ACTIVE,
      ...(isAdmin(actor) ? {} : { allowedRoles: { hasSome: actor.roles } }),
    };
  }

  private async changeStatus(
    id: string,
    status: AiRecordStatus,
    action: string,
    actor: AuthenticatedUser,
  ): Promise<AiAssistantResponseDto> {
    const current = await this.requireEditable(id);
    if (current.status === status) return this.toResponse(current);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.aiAssistant.update({
        where: { id },
        data: {
          status,
          archivedAt: status === AiRecordStatus.ARCHIVED ? new Date() : undefined,
          currentVersion: { increment: 1 },
        },
        include: assistantInclude,
      });
      await this.snapshot(tx, updated, actor, null);
      await this.record(tx, actor, action, id, { from: current.status, to: status });
      return updated;
    });
    return this.toResponse(row);
  }

  private assertSettings(settings: {
    supportedLanguages: Language[];
    defaultLanguage: Language;
    knowledgeAccess: boolean;
    requireSourceReferences: boolean;
  }): void {
    if (!settings.supportedLanguages.includes(settings.defaultLanguage)) {
      throw new BadRequestException('defaultLanguage must be one of supportedLanguages');
    }
    if (settings.requireSourceReferences && !settings.knowledgeAccess) {
      throw new BadRequestException('requireSourceReferences needs knowledgeAccess');
    }
  }

  private async require(id: string): Promise<AssistantRecord> {
    const row = await this.prisma.aiAssistant.findUnique({
      where: { id },
      include: assistantInclude,
    });
    if (!row) throw new NotFoundException('Assistant not found');
    return row;
  }

  private async requireEditable(id: string): Promise<AssistantRecord> {
    const row = await this.require(id);
    if (row.status === AiRecordStatus.ARCHIVED) {
      throw new ConflictException('Archived assistants cannot be changed');
    }
    return row;
  }

  private async snapshot(
    tx: Tx,
    row: AssistantRecord,
    actor: AuthenticatedUser,
    changeNote: string | null | undefined,
  ): Promise<void> {
    await tx.aiAssistantVersion.create({
      data: {
        assistantId: row.id,
        version: row.currentVersion,
        changeNote: changeNote ?? null,
        changedById: actor.id,
        snapshot: {
          code: row.code,
          name: row.name,
          assistantType: row.assistantType,
          purpose: row.purpose,
          description: row.description,
          supportedLanguages: row.supportedLanguages,
          defaultLanguage: row.defaultLanguage,
          allowedRoles: row.allowedRoles,
          knowledgeAccess: row.knowledgeAccess,
          maxKnowledgeChunks: row.maxKnowledgeChunks,
          requireSourceReferences: row.requireSourceReferences,
          status: row.status,
          cropIds: row.crops.map((link) => link.cropId),
          prompts: row.prompts.map((link) => ({
            templateId: link.templateId,
            pinnedVersionId: link.pinnedVersionId,
            position: link.position,
          })),
        },
      },
    });
  }

  private record(
    tx: Tx,
    actor: AuthenticatedUser,
    action: string,
    entityId: string,
    details: Prisma.InputJsonValue,
  ): Promise<void> {
    return this.audit.record(
      { actorId: actor.id, action, entityType: AiAuditEntity.Assistant, entityId, details },
      tx,
    );
  }

  toSummary(row: AssistantRecord): AiAssistantSummaryDto {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      assistantType: row.assistantType,
      purpose: row.purpose,
      description: row.description,
      supportedLanguages: row.supportedLanguages,
      defaultLanguage: row.defaultLanguage,
      knowledgeAccess: row.knowledgeAccess,
      requireSourceReferences: row.requireSourceReferences,
      crops: row.crops.map((link) => link.crop),
    };
  }

  toResponse(row: AssistantRecord): AiAssistantResponseDto {
    return {
      ...this.toSummary(row),
      allowedRoles: row.allowedRoles,
      maxKnowledgeChunks: row.maxKnowledgeChunks,
      status: row.status,
      currentVersion: row.currentVersion,
      archivedAt: row.archivedAt,
      createdById: row.createdById,
      prompts: row.prompts.map((link) => ({
        templateId: link.templateId,
        code: link.template.code,
        name: link.template.name,
        status: link.template.status,
        pinnedVersionId: link.pinnedVersionId,
        position: link.position,
      })),
      activeModelConfigurationId: row.modelConfigurations[0]?.id ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
