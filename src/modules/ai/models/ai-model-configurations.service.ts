import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../../common/dto/pagination.dto';
import {
  AiCapability,
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
import type {
  CreateModelConfigurationDto,
  ListModelConfigurationsQueryDto,
  ModelConfigurationResponseDto,
} from '../dto/model.dto';
import { AiModelsService } from './ai-models.service';

export const configurationInclude = {
  primaryModel: true,
  fallbackModel: true,
} satisfies Prisma.AiAssistantModelConfigurationInclude;

export type ConfigurationRecord = Prisma.AiAssistantModelConfigurationGetPayload<{
  include: typeof configurationInclude;
}>;

/**
 * Versioned assistant-to-model links. Each change is a new configuration; at most one per
 * assistant is active and it may only reference active models with the required capabilities.
 */
@Injectable()
export class AiModelConfigurationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly models: AiModelsService,
  ) {}

  async create(
    dto: CreateModelConfigurationDto,
    actor: AuthenticatedUser,
  ): Promise<ModelConfigurationResponseDto> {
    assertNoSecrets(dto.parameters, 'parameters');
    const assistant = await this.prisma.aiAssistant.findUnique({
      where: { id: dto.assistantId },
      select: { status: true },
    });
    if (!assistant) throw new NotFoundException('Assistant not found');
    if (assistant.status === AiRecordStatus.ARCHIVED) {
      throw new ConflictException('Archived assistants cannot be configured');
    }
    if (dto.fallbackModelId && dto.fallbackModelId === dto.primaryModelId) {
      throw new BadRequestException('The fallback model must differ from the primary model');
    }
    const required = dto.requiredCapabilities ?? [AiCapability.TEXT_GENERATION];
    const primary = await this.loadModel(dto.primaryModelId, 'Primary');
    const fallback = dto.fallbackModelId
      ? await this.loadModel(dto.fallbackModelId, 'Fallback')
      : null;
    for (const [label, model] of [
      ['Primary', primary],
      ['Fallback', fallback],
    ] as const) {
      if (!model) continue;
      if (model.status === AiRecordStatus.ARCHIVED) {
        throw new BadRequestException(`${label} model is archived`);
      }
      this.assertCapabilities(label, model, required, BadRequestException);
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.aiAssistantModelConfiguration.findFirst({
        where: { assistantId: dto.assistantId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const created = await tx.aiAssistantModelConfiguration.create({
        data: {
          assistantId: dto.assistantId,
          version: (latest?.version ?? 0) + 1,
          primaryModelId: dto.primaryModelId,
          fallbackModelId: dto.fallbackModelId,
          requiredCapabilities: required,
          parameters: dto.parameters as Prisma.InputJsonValue | undefined,
          effectiveFrom: dto.effectiveFrom,
          changeNote: dto.changeNote,
          createdById: actor.id,
        },
        include: configurationInclude,
      });
      await this.record(tx, actor, AiAuditAction.ModelConfigurationCreated, created.id, {
        assistantId: created.assistantId,
        version: created.version,
        primaryModelId: created.primaryModelId,
        fallbackModelId: created.fallbackModelId,
      });
      return created;
    });
    return this.toResponse(row);
  }

  async list(
    query: ListModelConfigurationsQueryDto,
  ): Promise<Paginated<ModelConfigurationResponseDto>> {
    const where: Prisma.AiAssistantModelConfigurationWhereInput = {
      ...(query.assistantId ? { assistantId: query.assistantId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.aiAssistantModelConfiguration.count({ where }),
      this.prisma.aiAssistantModelConfiguration.findMany({
        where,
        include: configurationInclude,
        orderBy: [{ assistantId: 'asc' }, { version: 'desc' }],
        ...paginationArgs(query),
      }),
    ]);
    return paginated(
      rows.map((row) => this.toResponse(row)),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<ModelConfigurationResponseDto> {
    return this.toResponse(await this.require(id));
  }

  /** Activating deactivates the assistant's previously active configuration. */
  async activate(id: string, actor: AuthenticatedUser): Promise<ModelConfigurationResponseDto> {
    const current = await this.require(id);
    if (current.status === RecordStatus.ACTIVE) return this.toResponse(current);
    const assistant = await this.prisma.aiAssistant.findUniqueOrThrow({
      where: { id: current.assistantId },
      select: { status: true },
    });
    if (assistant.status === AiRecordStatus.ARCHIVED) {
      throw new ConflictException('Archived assistants cannot be configured');
    }
    for (const [label, model] of [
      ['Primary', current.primaryModel],
      ['Fallback', current.fallbackModel],
    ] as const) {
      if (!model) continue;
      if (model.status !== AiRecordStatus.ACTIVE) {
        throw new ConflictException(`${label} model is not active`);
      }
      this.assertCapabilities(label, model, current.requiredCapabilities, ConflictException);
    }

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const previous = await tx.aiAssistantModelConfiguration.findMany({
          where: { assistantId: current.assistantId, status: RecordStatus.ACTIVE },
          select: { id: true },
        });
        await tx.aiAssistantModelConfiguration.updateMany({
          where: { id: { in: previous.map((p) => p.id) } },
          data: { status: RecordStatus.INACTIVE, deactivatedAt: now },
        });
        const updated = await tx.aiAssistantModelConfiguration.update({
          where: { id },
          data: {
            status: RecordStatus.ACTIVE,
            effectiveFrom: current.effectiveFrom ?? now,
            deactivatedAt: null,
          },
          include: configurationInclude,
        });
        await this.record(tx, actor, AiAuditAction.ModelConfigurationActivated, id, {
          assistantId: current.assistantId,
          version: current.version,
          replaced: previous.map((p) => p.id),
        });
        return updated;
      });
      return this.toResponse(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Another configuration was activated at the same time');
      }
      throw error;
    }
  }

  async deactivate(id: string, actor: AuthenticatedUser): Promise<ModelConfigurationResponseDto> {
    const current = await this.require(id);
    if (current.status === RecordStatus.INACTIVE) return this.toResponse(current);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.aiAssistantModelConfiguration.update({
        where: { id },
        data: { status: RecordStatus.INACTIVE, deactivatedAt: new Date() },
        include: configurationInclude,
      });
      await this.record(tx, actor, AiAuditAction.ModelConfigurationDeactivated, id, {
        assistantId: current.assistantId,
        version: current.version,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  /** The configuration requests would use now, or null. */
  activeFor(assistantId: string, at = new Date()): Promise<ConfigurationRecord | null> {
    return this.prisma.aiAssistantModelConfiguration.findFirst({
      where: {
        assistantId,
        status: RecordStatus.ACTIVE,
        OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }],
      },
      include: configurationInclude,
    });
  }

  private assertCapabilities(
    label: string,
    model: AiModel,
    required: AiCapability[],
    error: new (message: string) => Error,
  ): void {
    const missing = required.filter((cap) => !model.capabilities.includes(cap));
    if (missing.length > 0) {
      throw new error(`${label} model lacks required capabilities: ${missing.join(', ')}`);
    }
  }

  private async loadModel(id: string, label: string): Promise<AiModel> {
    const model = await this.prisma.aiModel.findUnique({ where: { id } });
    if (!model) throw new BadRequestException(`${label} model not found`);
    return model;
  }

  private async require(id: string): Promise<ConfigurationRecord> {
    const row = await this.prisma.aiAssistantModelConfiguration.findUnique({
      where: { id },
      include: configurationInclude,
    });
    if (!row) throw new NotFoundException('Model configuration not found');
    return row;
  }

  private record(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    action: string,
    entityId: string,
    details: Prisma.InputJsonValue,
  ): Promise<void> {
    return this.audit.record(
      {
        actorId: actor.id,
        action,
        entityType: AiAuditEntity.ModelConfiguration,
        entityId,
        details,
      },
      tx,
    );
  }

  private toResponse(row: ConfigurationRecord): ModelConfigurationResponseDto {
    return {
      id: row.id,
      assistantId: row.assistantId,
      version: row.version,
      primaryModel: this.models.toSummary(row.primaryModel),
      fallbackModel: row.fallbackModel ? this.models.toSummary(row.fallbackModel) : null,
      requiredCapabilities: row.requiredCapabilities,
      parameters: row.parameters,
      status: row.status,
      effectiveFrom: row.effectiveFrom,
      deactivatedAt: row.deactivatedAt,
      changeNote: row.changeNote,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
