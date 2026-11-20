import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../../common/dto/pagination.dto';
import {
  AiRecordStatus,
  Prisma,
  RecordStatus,
  type AiModel,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { AiAuditAction, AiAuditEntity } from '../ai.constants';
import { assertNoSecrets } from '../common/safe-metadata';
import type { ConfigurationHistoryDto } from '../dto/common.dto';
import type {
  AiModelResponseDto,
  CreateAiModelDto,
  ListAiModelsQueryDto,
  ModelSummaryDto,
  UpdateAiModelDto,
} from '../dto/model.dto';
import { AiProviderRegistry } from '../orchestration/ai-provider.registry';

type Tx = Prisma.TransactionClient;

/** Registry of models the platform may use. Registering a model never calls it. */
@Injectable()
export class AiModelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly providers: AiProviderRegistry,
  ) {}

  async register(dto: CreateAiModelDto, actor: AuthenticatedUser): Promise<AiModelResponseDto> {
    assertNoSecrets(dto.metadata, 'metadata');
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.aiModel.create({
        data: {
          provider: dto.provider,
          modelName: dto.modelName,
          modelVersion: dto.modelVersion,
          displayName: dto.displayName,
          capabilities: dto.capabilities,
          supportedLanguages: dto.supportedLanguages ?? [],
          contextWindowTokens: dto.contextWindowTokens,
          maxOutputTokens: dto.maxOutputTokens,
          metadata: dto.metadata as Prisma.InputJsonValue | undefined,
          createdById: actor.id,
        },
      });
      await this.snapshot(tx, created, actor, dto.changeNote);
      await this.record(tx, actor, AiAuditAction.ModelRegistered, created.id, {
        provider: created.provider,
        modelName: created.modelName,
        modelVersion: created.modelVersion,
      });
      return created;
    });
    return this.toResponse(row);
  }

  async list(query: ListAiModelsQueryDto): Promise<Paginated<AiModelResponseDto>> {
    const where: Prisma.AiModelWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.capability ? { capabilities: { has: query.capability } } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.aiModel.count({ where }),
      this.prisma.aiModel.findMany({
        where,
        orderBy: [{ provider: 'asc' }, { modelName: 'asc' }, { modelVersion: 'asc' }],
        ...paginationArgs(query),
      }),
    ]);
    return paginated(
      rows.map((row) => this.toResponse(row)),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<AiModelResponseDto> {
    return this.toResponse(await this.require(id));
  }

  async update(
    id: string,
    dto: UpdateAiModelDto,
    actor: AuthenticatedUser,
  ): Promise<AiModelResponseDto> {
    const current = await this.requireEditable(id);
    assertNoSecrets(dto.metadata, 'metadata');
    if (dto.capabilities) {
      const removed = current.capabilities.filter((cap) => !dto.capabilities!.includes(cap));
      if (removed.length > 0) {
        const dependent = await this.prisma.aiAssistantModelConfiguration.count({
          where: {
            ...this.referencing(id),
            status: RecordStatus.ACTIVE,
            requiredCapabilities: { hasSome: removed },
          },
        });
        if (dependent > 0) {
          throw new ConflictException(
            'An active model configuration requires a capability being removed',
          );
        }
      }
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.aiModel.update({
        where: { id },
        data: {
          displayName: dto.displayName,
          capabilities: dto.capabilities,
          supportedLanguages: dto.supportedLanguages,
          contextWindowTokens: dto.contextWindowTokens,
          maxOutputTokens: dto.maxOutputTokens,
          metadata: dto.metadata as Prisma.InputJsonValue | undefined,
          currentVersion: { increment: 1 },
        },
      });
      await this.snapshot(tx, updated, actor, dto.changeNote);
      await this.record(tx, actor, AiAuditAction.ModelUpdated, id, {
        version: updated.currentVersion,
        fields: Object.keys(dto).filter((key) => key !== 'changeNote'),
      });
      return updated;
    });
    return this.toResponse(row);
  }

  activate(id: string, actor: AuthenticatedUser): Promise<AiModelResponseDto> {
    return this.changeStatus(id, AiRecordStatus.ACTIVE, AiAuditAction.ModelActivated, actor);
  }

  deactivate(id: string, actor: AuthenticatedUser): Promise<AiModelResponseDto> {
    return this.changeStatus(id, AiRecordStatus.INACTIVE, AiAuditAction.ModelDeactivated, actor);
  }

  archive(id: string, actor: AuthenticatedUser): Promise<AiModelResponseDto> {
    return this.changeStatus(id, AiRecordStatus.ARCHIVED, AiAuditAction.ModelArchived, actor);
  }

  async history(id: string): Promise<ConfigurationHistoryDto> {
    await this.require(id);
    const [versions, audit] = await Promise.all([
      this.prisma.aiModelVersion.findMany({ where: { modelId: id }, orderBy: { version: 'desc' } }),
      this.audit.list(AiAuditEntity.Model, [id]),
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

  toSummary(row: AiModel): ModelSummaryDto {
    return {
      id: row.id,
      provider: row.provider,
      modelName: row.modelName,
      modelVersion: row.modelVersion,
      displayName: row.displayName,
      status: row.status,
      providerRegistered: this.providers.isRegistered(row.provider),
    };
  }

  private async changeStatus(
    id: string,
    status: AiRecordStatus,
    action: string,
    actor: AuthenticatedUser,
  ): Promise<AiModelResponseDto> {
    const current = await this.requireEditable(id);
    if (current.status === status) return this.toResponse(current);
    if (status !== AiRecordStatus.ACTIVE) {
      const inUse = await this.prisma.aiAssistantModelConfiguration.count({
        where: { ...this.referencing(id), status: RecordStatus.ACTIVE },
      });
      if (inUse > 0) {
        throw new ConflictException(
          'The model is used by an active assistant model configuration; deactivate that configuration first',
        );
      }
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.aiModel.update({
        where: { id },
        data: {
          status,
          archivedAt: status === AiRecordStatus.ARCHIVED ? new Date() : undefined,
          currentVersion: { increment: 1 },
        },
      });
      await this.snapshot(tx, updated, actor, null);
      await this.record(tx, actor, action, id, { from: current.status, to: status });
      return updated;
    });
    return this.toResponse(row);
  }

  private referencing(modelId: string): Prisma.AiAssistantModelConfigurationWhereInput {
    return { OR: [{ primaryModelId: modelId }, { fallbackModelId: modelId }] };
  }

  private async require(id: string): Promise<AiModel> {
    const row = await this.prisma.aiModel.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Model not found');
    return row;
  }

  private async requireEditable(id: string): Promise<AiModel> {
    const row = await this.require(id);
    if (row.status === AiRecordStatus.ARCHIVED) {
      throw new ConflictException('Archived models cannot be changed');
    }
    return row;
  }

  private async snapshot(
    tx: Tx,
    row: AiModel,
    actor: AuthenticatedUser,
    changeNote: string | null | undefined,
  ): Promise<void> {
    await tx.aiModelVersion.create({
      data: {
        modelId: row.id,
        version: row.currentVersion,
        changeNote: changeNote ?? null,
        changedById: actor.id,
        snapshot: {
          provider: row.provider,
          modelName: row.modelName,
          modelVersion: row.modelVersion,
          displayName: row.displayName,
          capabilities: row.capabilities,
          supportedLanguages: row.supportedLanguages,
          contextWindowTokens: row.contextWindowTokens,
          maxOutputTokens: row.maxOutputTokens,
          metadata: row.metadata ?? null,
          status: row.status,
        } as Prisma.InputJsonValue,
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
      { actorId: actor.id, action, entityType: AiAuditEntity.Model, entityId, details },
      tx,
    );
  }

  private toResponse(row: AiModel): AiModelResponseDto {
    return {
      id: row.id,
      provider: row.provider,
      modelName: row.modelName,
      modelVersion: row.modelVersion,
      displayName: row.displayName,
      capabilities: row.capabilities,
      supportedLanguages: row.supportedLanguages,
      contextWindowTokens: row.contextWindowTokens,
      maxOutputTokens: row.maxOutputTokens,
      metadata: row.metadata,
      status: row.status,
      currentVersion: row.currentVersion,
      providerRegistered: this.providers.isRegistered(row.provider),
      archivedAt: row.archivedAt,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
