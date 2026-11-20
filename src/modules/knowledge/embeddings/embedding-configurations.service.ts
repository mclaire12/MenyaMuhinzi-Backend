import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  type EmbeddingConfiguration,
  Prisma,
  RecordStatus,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import type {
  CreateEmbeddingConfigurationDto,
  EmbeddingConfigurationResponseDto,
} from '../dto/embedding-configuration.dto';
import { AuditEntity, KnowledgeAuditAction } from '../knowledge.constants';
import {
  EMBEDDING_PROVIDERS,
  VECTOR_STORE,
  type EmbeddingProvider,
  type VectorStore,
} from './embedding.interfaces';

/**
 * Embedding configurations describe a model. Creating or activating one never produces
 * vectors by itself; that needs a registered EmbeddingProvider and VectorStore.
 */
@Injectable()
export class EmbeddingConfigurationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() @Inject(EMBEDDING_PROVIDERS) private readonly providers: EmbeddingProvider[] = [],
    @Optional() @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore | null = null,
  ) {}

  async list(): Promise<EmbeddingConfigurationResponseDto[]> {
    const rows = await this.prisma.embeddingConfiguration.findMany({
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map((row) => this.toResponse(row));
  }

  async create(
    dto: CreateEmbeddingConfigurationDto,
    actor: AuthenticatedUser,
  ): Promise<EmbeddingConfigurationResponseDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.embeddingConfiguration.findFirst({
        where: { provider: dto.provider, model: dto.model },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const created = await tx.embeddingConfiguration.create({
        data: {
          name: dto.name,
          provider: dto.provider,
          model: dto.model,
          modelVersion: dto.modelVersion,
          dimensions: dto.dimensions,
          distanceMetric: dto.distanceMetric,
          settings: dto.settings as Prisma.InputJsonValue | undefined,
          version: (latest?.version ?? 0) + 1,
          createdById: actor.id,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: KnowledgeAuditAction.EmbeddingConfigCreated,
          entityType: AuditEntity.EmbeddingConfiguration,
          entityId: created.id,
          details: { provider: created.provider, model: created.model, version: created.version },
        },
        tx,
      );
      return created;
    });
    return this.toResponse(row);
  }

  /** Only one configuration is active; activating one deactivates the others. */
  async activate(id: string, actor: AuthenticatedUser): Promise<EmbeddingConfigurationResponseDto> {
    await this.require(id);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.embeddingConfiguration.updateMany({
        where: { status: RecordStatus.ACTIVE, id: { not: id } },
        data: { status: RecordStatus.INACTIVE },
      });
      const updated = await tx.embeddingConfiguration.update({
        where: { id },
        data: { status: RecordStatus.ACTIVE },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: KnowledgeAuditAction.EmbeddingConfigActivated,
          entityType: AuditEntity.EmbeddingConfiguration,
          entityId: id,
        },
        tx,
      );
      return updated;
    });
    return this.toResponse(row);
  }

  async deactivate(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<EmbeddingConfigurationResponseDto> {
    await this.require(id);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.embeddingConfiguration.update({
        where: { id },
        data: { status: RecordStatus.INACTIVE },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: KnowledgeAuditAction.EmbeddingConfigDeactivated,
          entityType: AuditEntity.EmbeddingConfiguration,
          entityId: id,
        },
        tx,
      );
      return updated;
    });
    return this.toResponse(row);
  }

  /** The active configuration with its provider and store, or null when semantic search cannot run. */
  async activeRuntime(): Promise<{
    configuration: EmbeddingConfiguration;
    provider: EmbeddingProvider;
    store: VectorStore;
  } | null> {
    const configuration = await this.prisma.embeddingConfiguration.findFirst({
      where: { status: RecordStatus.ACTIVE },
    });
    if (!configuration || !this.vectorStore) return null;
    const provider = this.providers.find((candidate) => candidate.id === configuration.provider);
    return provider ? { configuration, provider, store: this.vectorStore } : null;
  }

  private async require(id: string) {
    const row = await this.prisma.embeddingConfiguration.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Embedding configuration not found');
  }

  private toResponse(row: EmbeddingConfiguration): EmbeddingConfigurationResponseDto {
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      model: row.model,
      modelVersion: row.modelVersion,
      dimensions: row.dimensions,
      distanceMetric: row.distanceMetric,
      version: row.version,
      status: row.status,
      settings: row.settings,
      providerAvailable: this.providers.some((provider) => provider.id === row.provider),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
