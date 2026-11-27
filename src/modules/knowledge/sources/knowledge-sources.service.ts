import { basename } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { knowledgeConfig } from '../../../config/configuration';
import {
  paginated,
  paginationArgs,
  type Paginated,
  type PaginationQueryDto,
} from '../../../common/dto/pagination.dto';
import {
  EmbeddingStatus,
  KnowledgeReviewAction,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
  KnowledgeStage,
  KnowledgeStorageKind,
  Prisma,
  RecordStatus,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { isAdmin } from '../../groups/facilitator-groups.service';
import type {
  AddKnowledgeVersionDto,
  CreateKnowledgeSourceDto,
  KnowledgeChunkResponseDto,
  KnowledgeSourceResponseDto,
  ListChunksQueryDto,
  ListKnowledgeSourcesQueryDto,
  ProcessingStatusResponseDto,
  ProcessResponseDto,
  SourceHistoryResponseDto,
  TrainingCorpusEntryDto,
  UpdateKnowledgeSourceDto,
} from '../dto/knowledge-source.dto';
import {
  AuditEntity,
  KnowledgeAuditAction,
  PROCESS_START_STATUSES,
  RETRIEVABLE_CHUNK_WHERE,
  RETRIEVABLE_SOURCE_WHERE,
  VERSION_BUSY_STATUSES,
} from '../knowledge.constants';
import { KnowledgeJobsService } from '../pipeline/knowledge-jobs.service';
import { chunkTags, topicDefinition } from '../processing/chunk-tags';
import {
  DocumentValidationError,
  PROCESSABLE_TYPES,
  sanitizeFilename,
  validateDocument,
} from '../processing/document-validation';
import { KnowledgeStorageService, StorageKeyError } from '../storage/knowledge-storage.service';
import {
  chunkSelect,
  sourceInclude,
  toSourceResponse,
  versionSelect,
  type SourceRecord,
} from './source.mapper';
import { syncSourceStatus } from './source-status';

/** The parts of a Multer upload this service uses. */
export interface UploadedDocument {
  originalname: string;
  buffer: Buffer;
  size: number;
}

interface ResolvedFile {
  storageKind: KnowledgeStorageKind;
  storageRef: string;
  originalFilename: string | null;
  fileSizeBytes: number | null;
  mimeType: string | null;
  checksumSha256: string | null;
  /** Set when this request wrote the file, so it can be removed if the database write fails. */
  written: boolean;
}

const EXTERNAL_URL_TYPES: KnowledgeSourceType[] = [
  KnowledgeSourceType.HTML,
  KnowledgeSourceType.WEB_ARTICLE,
  KnowledgeSourceType.OTHER,
];

@Injectable()
export class KnowledgeSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: KnowledgeStorageService,
    private readonly jobs: KnowledgeJobsService,
    private readonly audit: AuditService,
    @Inject(knowledgeConfig.KEY) private readonly config: ConfigType<typeof knowledgeConfig>,
  ) {}

  // ---------------------------------------------------------------------------
  // Sources
  // ---------------------------------------------------------------------------

  async create(
    dto: CreateKnowledgeSourceDto,
    file: UploadedDocument | undefined,
    actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    const cropIds = unique(dto.cropIds);
    const topicIds = unique(dto.topicIds);
    await this.assertTags(cropIds, topicIds);
    const resolved = await this.resolveFile(dto.sourceType, file, dto);

    try {
      const sourceId = await this.prisma.$transaction(async (tx) => {
        const source = await tx.knowledgeSource.create({
          data: {
            title: dto.title,
            description: dto.description,
            sourceType: dto.sourceType,
            language: dto.language,
            sourceOrganization: dto.sourceOrganization,
            author: dto.author,
            publicationDate: dto.publicationDate ? new Date(dto.publicationDate) : undefined,
            includeInTraining: dto.includeInTraining ?? true,
            latestVersionNumber: 1,
            createdById: actor.id,
            crops: { create: cropIds.map((cropId) => ({ cropId })) },
            topics: { create: topicIds.map((topicId) => ({ topicId })) },
            versions: {
              create: {
                ...versionData(resolved),
                versionNumber: 1,
                changeNote: dto.changeNote,
                createdById: actor.id,
              },
            },
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: KnowledgeAuditAction.SourceCreated,
            entityType: AuditEntity.Source,
            entityId: source.id,
            details: {
              title: dto.title,
              sourceType: dto.sourceType,
              storageKind: resolved.storageKind,
            },
          },
          tx,
        );
        return source.id;
      });
      return this.findOne(sourceId, actor);
    } catch (error) {
      await this.discardFile(resolved);
      throw error;
    }
  }

  async list(
    query: ListKnowledgeSourcesQueryDto,
    actor: AuthenticatedUser,
  ): Promise<Paginated<KnowledgeSourceResponseDto>> {
    const where = this.listWhere(query, actor);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.knowledgeSource.count({ where }),
      this.prisma.knowledgeSource.findMany({
        where,
        include: sourceInclude,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        ...paginationArgs(query),
      }),
    ]);
    const admin = isAdmin(actor);
    return paginated(
      rows.map((row) => toSourceResponse(row, { admin })),
      total,
      query,
    );
  }

  /** Filters shared by the source list and metadata search. Non-admins only see retrievable knowledge. */
  listWhere(
    query: ListKnowledgeSourcesQueryDto,
    actor: AuthenticatedUser,
  ): Prisma.KnowledgeSourceWhereInput {
    const and: Prisma.KnowledgeSourceWhereInput[] = [];
    if (!isAdmin(actor)) and.push(RETRIEVABLE_SOURCE_WHERE);
    else if (query.status) and.push({ status: query.status });
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { description: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.sourceType) and.push({ sourceType: query.sourceType });
    if (query.language) and.push({ language: query.language });
    if (query.cropId) and.push({ crops: { some: { cropId: query.cropId } } });
    if (query.topicId) and.push({ topics: { some: { topicId: query.topicId } } });
    if (query.publishedFrom || query.publishedTo) {
      and.push({
        publicationDate: {
          ...(query.publishedFrom ? { gte: new Date(query.publishedFrom) } : {}),
          ...(query.publishedTo ? { lte: new Date(query.publishedTo) } : {}),
        },
      });
    }
    return { AND: and };
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<KnowledgeSourceResponseDto> {
    const admin = isAdmin(actor);
    const source = await this.prisma.knowledgeSource.findFirst({
      where: admin ? { id } : { id, ...RETRIEVABLE_SOURCE_WHERE },
      include: sourceInclude,
    });
    if (!source) throw new NotFoundException('Knowledge source not found');
    return toSourceResponse(source, { admin, withVersions: true });
  }

  async update(
    id: string,
    dto: UpdateKnowledgeSourceDto,
    actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    const source = await this.requireSource(id);
    if (source.archivedAt) throw new ConflictException('Archived sources cannot be changed');
    const cropIds = dto.cropIds ? unique(dto.cropIds) : undefined;
    const topicIds = dto.topicIds ? unique(dto.topicIds) : undefined;
    await this.assertTags(cropIds ?? [], topicIds ?? []);

    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeSource.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          language: dto.language,
          sourceOrganization: dto.sourceOrganization,
          author: dto.author,
          publicationDate: dto.publicationDate ? new Date(dto.publicationDate) : undefined,
          includeInTraining: dto.includeInTraining,
        },
      });
      if (cropIds) {
        await tx.knowledgeSourceCrop.deleteMany({ where: { sourceId: id } });
        await tx.knowledgeSourceCrop.createMany({
          data: cropIds.map((cropId) => ({ sourceId: id, cropId })),
        });
      }
      if (topicIds) {
        await tx.knowledgeSourceTopic.deleteMany({ where: { sourceId: id } });
        await tx.knowledgeSourceTopic.createMany({
          data: topicIds.map((topicId) => ({ sourceId: id, topicId })),
        });
      }
      if (dto.language && dto.language !== source.language) {
        await tx.knowledgeChunk.updateMany({
          where: { sourceId: id },
          data: { language: dto.language },
        });
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: KnowledgeAuditAction.SourceUpdated,
          entityType: AuditEntity.Source,
          entityId: id,
          details: { fields: Object.keys(dto) },
        },
        tx,
      );
    });
    if (cropIds || topicIds) await this.retagChunks(id);
    return this.findOne(id, actor);
  }

  async setActive(
    id: string,
    isActive: boolean,
    actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    const source = await this.requireSource(id);
    if (source.isActive !== isActive) {
      await this.prisma.$transaction(async (tx) => {
        await tx.knowledgeSource.update({ where: { id }, data: { isActive } });
        await this.audit.record(
          {
            actorId: actor.id,
            action: isActive
              ? KnowledgeAuditAction.SourceActivated
              : KnowledgeAuditAction.SourceDeactivated,
            entityType: AuditEntity.Source,
            entityId: id,
          },
          tx,
        );
      });
    }
    return this.findOne(id, actor);
  }

  /** Only sources that never had an approved version can be deleted; others must be archived. */
  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const source = await this.requireSource(id);
    const everApproved = await this.prisma.knowledgeApproval.count({
      where: { sourceId: id, action: KnowledgeReviewAction.APPROVED },
    });
    if (everApproved > 0 || source.approvedVersionId) {
      throw new ConflictException(
        'This source has approved knowledge. Archive it instead of deleting it.',
      );
    }
    if (source.versions.some((version) => version.status === KnowledgeSourceStatus.PROCESSING)) {
      throw new ConflictException('Wait for processing to finish before deleting the source');
    }
    const keys = source.versions
      .filter((version) => version.storageKind !== KnowledgeStorageKind.EXTERNAL_URL)
      .map((version) => version.storageRef);

    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeSource.delete({ where: { id } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: KnowledgeAuditAction.SourceDeleted,
          entityType: AuditEntity.Source,
          entityId: id,
          details: { title: source.title, versions: source.versions.length },
        },
        tx,
      );
    });
    for (const key of new Set(keys)) await this.removeIfUnreferenced(key);
  }

  // ---------------------------------------------------------------------------
  // Versions and processing
  // ---------------------------------------------------------------------------

  async addVersion(
    id: string,
    dto: AddKnowledgeVersionDto,
    file: UploadedDocument | undefined,
    actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    const source = await this.requireSource(id);
    if (source.archivedAt) throw new ConflictException('Archived sources cannot get new versions');
    const latest = source.versions[0];
    if (latest && VERSION_BUSY_STATUSES.includes(latest.status)) {
      throw new ConflictException(
        `The latest version is ${latest.status}. Wait until it is finished or reviewed.`,
      );
    }
    const resolved = await this.resolveFile(source.sourceType, file, dto);
    if (
      resolved.checksumSha256 &&
      source.versions.some((version) => version.checksumSha256 === resolved.checksumSha256)
    ) {
      await this.discardFile(resolved);
      throw new ConflictException('This file is already a version of this source');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Guarded by the version number so two concurrent uploads cannot both succeed.
        const bumped = await tx.knowledgeSource.updateMany({
          where: { id, latestVersionNumber: source.latestVersionNumber },
          data: { latestVersionNumber: { increment: 1 } },
        });
        if (bumped.count === 0) throw new ConflictException('The source changed. Try again.');
        const versionNumber = source.latestVersionNumber + 1;
        await tx.knowledgeSourceVersion.create({
          data: {
            ...versionData(resolved),
            sourceId: id,
            versionNumber,
            changeNote: dto.changeNote,
            createdById: actor.id,
          },
        });
        await syncSourceStatus(tx, id);
        await this.audit.record(
          {
            actorId: actor.id,
            action: KnowledgeAuditAction.VersionAdded,
            entityType: AuditEntity.Source,
            entityId: id,
            details: { versionNumber, storageKind: resolved.storageKind },
          },
          tx,
        );
      });
    } catch (error) {
      await this.discardFile(resolved);
      throw error;
    }
    return this.findOne(id, actor);
  }

  async process(
    id: string,
    versionId: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<ProcessResponseDto> {
    const source = await this.requireSource(id);
    if (source.archivedAt) throw new ConflictException('Archived sources cannot be processed');
    const version = versionId
      ? source.versions.find((candidate) => candidate.id === versionId)
      : source.versions[0];
    if (!version) throw new NotFoundException('Version not found');
    if (
      version.storageKind === KnowledgeStorageKind.EXTERNAL_URL ||
      !PROCESSABLE_TYPES.includes(source.sourceType)
    ) {
      throw new ConflictException(
        `Only ${PROCESSABLE_TYPES.join(', ')} files can be processed in this version of the platform`,
      );
    }
    if (!PROCESS_START_STATUSES.includes(version.status)) {
      const reason =
        version.status === KnowledgeSourceStatus.PROCESSING
          ? 'This version is already being processed'
          : 'This version has already been processed. Upload a new version to process it again.';
      throw new ConflictException(reason);
    }

    // Conditional update so concurrent requests cannot start processing twice.
    const started = await this.prisma.knowledgeSourceVersion.updateMany({
      where: { id: version.id, status: { in: PROCESS_START_STATUSES } },
      data: { status: KnowledgeSourceStatus.PROCESSING, processingError: null },
    });
    if (started.count === 0) throw new ConflictException('This version is already being processed');
    await syncSourceStatus(this.prisma, id);
    await this.audit.record({
      actorId: actor.id,
      action: KnowledgeAuditAction.ProcessingRequested,
      entityType: AuditEntity.Source,
      entityId: id,
      details: { versionId: version.id, versionNumber: version.versionNumber },
    });

    try {
      const job = await this.jobs.enqueue({
        sourceId: id,
        versionId: version.id,
        stage: KnowledgeStage.EXTRACTION,
        requestedById: actor.id,
      });
      return { versionId: version.id, jobId: job.id, status: KnowledgeSourceStatus.PROCESSING };
    } catch (error) {
      await this.prisma.knowledgeSourceVersion.update({
        where: { id: version.id },
        data: {
          status: KnowledgeSourceStatus.FAILED,
          processingError: 'The processing queue is unavailable',
        },
      });
      await syncSourceStatus(this.prisma, id);
      throw error;
    }
  }

  async processingStatus(id: string, versionId?: string): Promise<ProcessingStatusResponseDto> {
    const source = await this.requireSource(id);
    const version = versionId
      ? source.versions.find((candidate) => candidate.id === versionId)
      : source.versions[0];
    if (!version) throw new NotFoundException('Version not found');
    const [jobs, document, chunkCount, embeddingGroups] = await Promise.all([
      this.prisma.knowledgeProcessingJob.findMany({
        where: { versionId: version.id },
        orderBy: [{ queuedAt: 'asc' }, { runNumber: 'asc' }],
        select: {
          id: true,
          versionId: true,
          stage: true,
          status: true,
          runNumber: true,
          attempts: true,
          maxAttempts: true,
          error: true,
          queuedAt: true,
          startedAt: true,
          finishedAt: true,
        },
      }),
      this.prisma.knowledgeDocument.findUnique({
        where: { versionId: version.id },
        select: {
          pageCount: true,
          characterCount: true,
          wordCount: true,
          detectedLanguage: true,
          languageConfidence: true,
          detectedCropCodes: true,
          detectedTopicCodes: true,
          extractedMetadata: true,
          chunkingOptions: true,
          extractedAt: true,
          normalizedAt: true,
          metadataProcessedAt: true,
          chunkedAt: true,
        },
      }),
      this.prisma.knowledgeChunk.count({ where: { versionId: version.id } }),
      this.prisma.knowledgeEmbedding.groupBy({
        by: ['status'],
        where: { chunk: { versionId: version.id } },
        _count: { _all: true },
      }),
    ]);
    const count = (status: EmbeddingStatus) =>
      embeddingGroups.find((group) => group.status === status)?._count._all ?? 0;
    return {
      sourceId: id,
      sourceStatus: source.status,
      version,
      jobs,
      document,
      chunkCount,
      embeddings: {
        pending: count(EmbeddingStatus.PENDING),
        processing: count(EmbeddingStatus.PROCESSING),
        completed: count(EmbeddingStatus.COMPLETED),
        failed: count(EmbeddingStatus.FAILED),
      },
    };
  }

  async history(id: string): Promise<SourceHistoryResponseDto> {
    const source = await this.requireSource(id);
    const [approvals, processing, audit] = await Promise.all([
      this.prisma.knowledgeApproval.findMany({
        where: { sourceId: id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          versionId: true,
          action: true,
          actorId: true,
          reason: true,
          createdAt: true,
        },
      }),
      this.prisma.knowledgeProcessingHistory.findMany({
        where: { sourceId: id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          versionId: true,
          jobId: true,
          stage: true,
          event: true,
          message: true,
          details: true,
          createdAt: true,
        },
      }),
      this.audit.list(AuditEntity.Source, [id]),
    ]);
    return { versions: [...source.versions].reverse(), approvals, processing, audit };
  }

  // ---------------------------------------------------------------------------
  // Chunks
  // ---------------------------------------------------------------------------

  async listChunks(
    id: string,
    query: ListChunksQueryDto,
    actor: AuthenticatedUser,
  ): Promise<Paginated<KnowledgeChunkResponseDto>> {
    let where: Prisma.KnowledgeChunkWhereInput;
    if (isAdmin(actor)) {
      const source = await this.requireSource(id);
      const versionId = query.versionId ?? source.approvedVersionId ?? source.versions[0]?.id;
      if (query.versionId && !source.versions.some((version) => version.id === query.versionId)) {
        throw new NotFoundException('Version not found');
      }
      where = { sourceId: id, versionId };
    } else {
      const source = await this.prisma.knowledgeSource.findFirst({
        where: { id, ...RETRIEVABLE_SOURCE_WHERE },
        select: { approvedVersionId: true },
      });
      if (!source) throw new NotFoundException('Knowledge source not found');
      where = { sourceId: id, versionId: source.approvedVersionId!, ...RETRIEVABLE_CHUNK_WHERE };
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.knowledgeChunk.count({ where }),
      this.prisma.knowledgeChunk.findMany({
        where,
        select: chunkSelect,
        orderBy: { chunkIndex: 'asc' },
        ...paginationArgs(query),
      }),
    ]);
    return paginated(rows, total, query);
  }

  async findChunk(id: string, actor: AuthenticatedUser): Promise<KnowledgeChunkResponseDto> {
    const chunk = await this.prisma.knowledgeChunk.findFirst({
      where: isAdmin(actor) ? { id } : { id, ...RETRIEVABLE_CHUNK_WHERE },
      select: chunkSelect,
    });
    if (!chunk) throw new NotFoundException('Knowledge chunk not found');
    return chunk;
  }

  /** Recomputes chunk crops and topics after an administrator changes the source tags. */
  private async retagChunks(sourceId: string): Promise<void> {
    const [source, topics, chunks] = await Promise.all([
      this.prisma.knowledgeSource.findUniqueOrThrow({
        where: { id: sourceId },
        select: {
          crops: { select: { crop: { select: { code: true } } } },
          topics: { select: { topic: { select: { code: true } } } },
          documents: { select: { id: true, detectedCropCodes: true } },
        },
      }),
      this.prisma.knowledgeTopic.findMany({ where: { status: RecordStatus.ACTIVE } }),
      this.prisma.knowledgeChunk.findMany({
        where: { sourceId },
        select: { id: true, documentId: true, text: true },
      }),
    ]);
    const definitions = topics.map(topicDefinition);
    const detectedByDocument = new Map(
      source.documents.map((document) => [document.id, document.detectedCropCodes]),
    );
    const updates = chunks.map((chunk) => {
      const tags = chunkTags(chunk.text, {
        sourceCropCodes: source.crops.map((link) => link.crop.code),
        detectedCropCodes: detectedByDocument.get(chunk.documentId) ?? [],
        sourceTopicCodes: source.topics.map((link) => link.topic.code),
        topicDefinitions: definitions,
      });
      return this.prisma.knowledgeChunk.update({ where: { id: chunk.id }, data: tags });
    });
    if (updates.length > 0) await this.prisma.$transaction(updates);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Approved, active sources marked for training, with the exact approved version, so the
   * model-training pipeline can retrain on the same documents the assistant retrieves from.
   */
  async trainingCorpus(query: PaginationQueryDto): Promise<Paginated<TrainingCorpusEntryDto>> {
    const where: Prisma.KnowledgeSourceWhereInput = {
      includeInTraining: true,
      archivedAt: null,
      approvedVersionId: { not: null },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.knowledgeSource.findMany({
        where,
        orderBy: { approvedAt: 'desc' },
        select: {
          id: true,
          title: true,
          sourceType: true,
          language: true,
          approvedAt: true,
          crops: { select: { crop: { select: { code: true } } } },
          topics: { select: { topic: { select: { code: true } } } },
          approvedVersion: { select: versionSelect },
        },
        ...paginationArgs(query),
      }),
      this.prisma.knowledgeSource.count({ where }),
    ]);
    return paginated(
      rows.flatMap((row) =>
        row.approvedVersion
          ? [
              {
                sourceId: row.id,
                title: row.title,
                sourceType: row.sourceType,
                language: row.language,
                cropCodes: row.crops.map((link) => link.crop.code),
                topicCodes: row.topics.map((link) => link.topic.code),
                approvedAt: row.approvedAt,
                version: row.approvedVersion as unknown as TrainingCorpusEntryDto['version'],
              },
            ]
          : [],
      ),
      total,
      query,
    );
  }

  async requireSource(id: string): Promise<SourceRecord> {
    const source = await this.prisma.knowledgeSource.findUnique({
      where: { id },
      include: sourceInclude,
    });
    if (!source) throw new NotFoundException('Knowledge source not found');
    return source;
  }

  private async assertTags(cropIds: string[], topicIds: string[]): Promise<void> {
    if (cropIds.length > 0) {
      const crops = await this.prisma.crop.count({
        where: { id: { in: cropIds }, status: RecordStatus.ACTIVE },
      });
      if (crops !== cropIds.length)
        throw new BadRequestException('One or more crops are not available');
    }
    if (topicIds.length > 0) {
      const topics = await this.prisma.knowledgeTopic.count({
        where: { id: { in: topicIds }, status: RecordStatus.ACTIVE },
      });
      if (topics !== topicIds.length)
        throw new BadRequestException('One or more topics are not available');
    }
  }

  private async resolveFile(
    sourceType: KnowledgeSourceType,
    file: UploadedDocument | undefined,
    reference: { storageRef?: string; originalFilename?: string },
  ): Promise<ResolvedFile> {
    if (file && reference.storageRef) {
      throw new BadRequestException('Upload a file or give a storageRef, not both');
    }
    if (file) {
      const filename = this.cleanFilename(file.originalname);
      const detected = this.validate(file.buffer, filename, sourceType);
      const stored = await this.storage.save(file.buffer, detected.extension);
      const alreadyStored = await this.prisma.knowledgeSourceVersion.count({
        where: { storageRef: stored.key },
      });
      return {
        storageKind: KnowledgeStorageKind.UPLOAD,
        storageRef: stored.key,
        originalFilename: filename,
        fileSizeBytes: stored.sizeBytes,
        mimeType: detected.mimeType,
        checksumSha256: stored.checksumSha256,
        written: alreadyStored === 0,
      };
    }
    const ref = reference.storageRef;
    if (!ref) throw new BadRequestException('Upload a file or give a storageRef');

    if (/^https?:\/\//i.test(ref)) {
      let url: URL;
      try {
        url = new URL(ref);
      } catch {
        throw new BadRequestException('storageRef is not a valid URL');
      }
      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new BadRequestException('External references must be https URLs without credentials');
      }
      if (!EXTERNAL_URL_TYPES.includes(sourceType)) {
        throw new BadRequestException(
          `${sourceType} sources need an uploaded file or a storage key, not a URL`,
        );
      }
      return {
        storageKind: KnowledgeStorageKind.EXTERNAL_URL,
        storageRef: url.toString(),
        originalFilename: reference.originalFilename
          ? this.cleanFilename(reference.originalFilename)
          : null,
        fileSizeBytes: null,
        mimeType: null,
        checksumSha256: null,
        written: false,
      };
    }

    let described;
    try {
      described = await this.storage.describe(ref);
    } catch (error) {
      if (error instanceof StorageKeyError) throw new BadRequestException(error.message);
      throw error;
    }
    if (!described) throw new BadRequestException('No file exists at this storage reference');
    if (described.sizeBytes > this.config.maxFileBytes) {
      throw new BadRequestException(
        `The file is larger than the ${this.config.maxFileBytes} byte limit`,
      );
    }
    const filename = this.cleanFilename(reference.originalFilename ?? basename(ref));
    const detected = this.validate(await this.storage.read(ref), filename, sourceType);
    return {
      storageKind: KnowledgeStorageKind.STORAGE_REFERENCE,
      storageRef: ref,
      originalFilename: filename,
      fileSizeBytes: described.sizeBytes,
      mimeType: detected.mimeType,
      checksumSha256: described.checksumSha256,
      written: false,
    };
  }

  private validate(bytes: Buffer, filename: string, sourceType: KnowledgeSourceType) {
    try {
      return validateDocument(bytes, filename, sourceType, this.config.maxFileBytes);
    } catch (error) {
      if (error instanceof DocumentValidationError)
        throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }

  private cleanFilename(name: string): string {
    try {
      return sanitizeFilename(name);
    } catch (error) {
      if (error instanceof DocumentValidationError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  private async discardFile(resolved: ResolvedFile): Promise<void> {
    if (resolved.written) await this.removeIfUnreferenced(resolved.storageRef);
  }

  private async removeIfUnreferenced(key: string): Promise<void> {
    const references = await this.prisma.knowledgeSourceVersion.count({
      where: { storageRef: key },
    });
    if (references === 0) await this.storage.remove(key).catch(() => undefined);
  }
}

function unique(ids: string[] | undefined): string[] {
  return [...new Set(ids ?? [])];
}

function versionData(file: ResolvedFile) {
  return {
    storageKind: file.storageKind,
    storageRef: file.storageRef,
    originalFilename: file.originalFilename,
    fileSizeBytes: file.fileSizeBytes,
    mimeType: file.mimeType,
    checksumSha256: file.checksumSha256,
  };
}
