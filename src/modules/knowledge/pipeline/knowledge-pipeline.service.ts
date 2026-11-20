import { basename } from 'node:path';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { UnrecoverableError } from 'bullmq';
import { knowledgeConfig } from '../../../config/configuration';
import {
  EmbeddingStatus,
  KnowledgeChunkStatus,
  KnowledgeHistoryEvent,
  KnowledgeJobStatus,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
  KnowledgeStage,
  Prisma,
  RecordStatus,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { describeError } from '../../../common/utils/describe-error';
import {
  EMBEDDING_PROVIDERS,
  VECTOR_STORE,
  type EmbeddingProvider,
  type VectorStore,
} from '../embeddings/embedding.interfaces';
import { chunkBlocks, type ChunkingOptions } from '../processing/chunker';
import { chunkTags, topicDefinition } from '../processing/chunk-tags';
import {
  decodeText,
  DocumentValidationError,
  validateDocument,
} from '../processing/document-validation';
import {
  ExtractionFailure,
  extractInSandbox,
  type ExtractedPage,
  type ExtractionResult,
} from '../processing/extraction-sandbox';
import { detectLanguage } from '../processing/language-detector';
import { cropTerms, detectTags } from '../processing/tagging';
import { normalizeDocument, type NormalizedBlock } from '../processing/text-normalizer';
import { sha256, KnowledgeStorageService } from '../storage/knowledge-storage.service';
import { syncSourceStatus } from '../sources/source-status';
import { KnowledgeJobsService } from './knowledge-jobs.service';

/** A failure that will repeat on every attempt, such as a malformed or empty document. */
export class PermanentPipelineError extends Error {}

export interface RunOptions {
  /** 1-based attempt number from the queue. */
  attempt: number;
  maxAttempts: number;
}

export type RunOutcome = 'completed' | 'skipped' | 'ignored';

const NEXT_STAGE: Partial<Record<KnowledgeStage, KnowledgeStage>> = {
  [KnowledgeStage.EXTRACTION]: KnowledgeStage.NORMALIZATION,
  [KnowledgeStage.NORMALIZATION]: KnowledgeStage.METADATA,
  [KnowledgeStage.METADATA]: KnowledgeStage.CHUNKING,
};

const EMBEDDING_BATCH_SIZE = 32;

type JobRecord = Prisma.KnowledgeProcessingJobGetPayload<{
  include: {
    version: true;
    source: {
      include: { crops: { include: { crop: true } }; topics: { include: { topic: true } } };
    };
  };
}>;

interface StageResult {
  status: typeof KnowledgeJobStatus.COMPLETED | typeof KnowledgeJobStatus.SKIPPED;
  message: string;
  details?: Prisma.InputJsonValue;
}

/**
 * Runs one pipeline stage per queue job. Every stage writes its output before the next
 * stage is queued, and re-running a stage replaces its own output, so retries are safe.
 */
@Injectable()
export class KnowledgePipelineService {
  private readonly logger = new Logger(KnowledgePipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: KnowledgeStorageService,
    private readonly jobs: KnowledgeJobsService,
    @Inject(knowledgeConfig.KEY) private readonly config: ConfigType<typeof knowledgeConfig>,
    @Optional() @Inject(EMBEDDING_PROVIDERS) private readonly providers: EmbeddingProvider[] = [],
    @Optional() @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore | null = null,
  ) {}

  chunkingOptions(): ChunkingOptions {
    return { chunkSize: this.config.chunkSize, chunkOverlap: this.config.chunkOverlap };
  }

  async runJob(jobId: string, options: RunOptions): Promise<RunOutcome> {
    const job = await this.loadJob(jobId);
    if (!job) {
      throw new UnrecoverableError(`Knowledge job ${jobId} does not exist`);
    }
    if (job.status !== KnowledgeJobStatus.QUEUED && job.status !== KnowledgeJobStatus.RUNNING) {
      return 'ignored';
    }
    // Content stages only run while the version is being processed; embeddings may run later.
    if (
      job.stage !== KnowledgeStage.EMBEDDING &&
      job.version.status !== KnowledgeSourceStatus.PROCESSING
    ) {
      await this.finishJob(
        job,
        KnowledgeJobStatus.SKIPPED,
        `Skipped because the version is ${job.version.status}`,
      );
      return 'ignored';
    }

    await this.prisma.knowledgeProcessingJob.update({
      where: { id: job.id },
      data: {
        status: KnowledgeJobStatus.RUNNING,
        attempts: options.attempt,
        startedAt: new Date(),
        error: null,
      },
    });
    await this.history(
      job,
      KnowledgeHistoryEvent.STARTED,
      `${job.stage} started (attempt ${options.attempt} of ${options.maxAttempts})`,
    );

    let result: StageResult;
    try {
      result = await this.runStage(job);
    } catch (error) {
      await this.handleFailure(job, error, options);
      throw error instanceof PermanentPipelineError || !this.isRetryable(error)
        ? new UnrecoverableError(describeError(error))
        : error;
    }

    await this.finishJob(job, result.status, result.message, result.details);
    await this.advance(job);
    return result.status === KnowledgeJobStatus.COMPLETED ? 'completed' : 'skipped';
  }

  private async runStage(job: JobRecord): Promise<StageResult> {
    switch (job.stage) {
      case KnowledgeStage.EXTRACTION:
        return this.extract(job);
      case KnowledgeStage.NORMALIZATION:
        return this.normalize(job);
      case KnowledgeStage.METADATA:
        return this.extractMetadata(job);
      case KnowledgeStage.CHUNKING:
        return this.chunk(job);
      case KnowledgeStage.EMBEDDING:
        return this.embed(job);
    }
  }

  private async extract(job: JobRecord): Promise<StageResult> {
    const version = job.version;
    let bytes: Buffer;
    try {
      bytes = await this.storage.read(version.storageRef);
    } catch (error) {
      throw new PermanentPipelineError(
        `The stored file could not be read: ${describeError(error)}`,
      );
    }
    if (version.checksumSha256 && sha256(bytes) !== version.checksumSha256) {
      throw new PermanentPipelineError('The stored file does not match the uploaded checksum');
    }
    const filename = version.originalFilename ?? basename(version.storageRef);
    let detected;
    try {
      detected = validateDocument(bytes, filename, job.source.sourceType, this.config.maxFileBytes);
    } catch (error) {
      throw new PermanentPipelineError(describeError(error));
    }

    let extraction: ExtractionResult;
    const limits = {
      timeoutMs: this.config.extractionTimeoutMs,
      maxPages: this.config.maxPages,
      maxMemoryMb: this.config.extractionMemoryMb,
    };
    switch (detected.sourceType) {
      case KnowledgeSourceType.PDF:
        extraction = await extractInSandbox('pdf', bytes, limits);
        break;
      case KnowledgeSourceType.DOCX:
        extraction = await extractInSandbox('docx', bytes, limits);
        break;
      case KnowledgeSourceType.TXT:
        try {
          extraction = {
            pages: [{ pageNumber: null, text: decodeText(bytes) }],
            pageCount: null,
            metadata: {},
            warnings: [],
          };
        } catch {
          throw new PermanentPipelineError('The text file is not valid UTF-8');
        }
        break;
      default:
        throw new PermanentPipelineError(`${detected.sourceType} files cannot be processed yet`);
    }

    const rawText = extraction.pages.map((page) => page.text).join('\n\n');
    if (rawText.trim().length === 0) {
      throw new PermanentPipelineError(
        'No text could be extracted. Scanned documents need OCR, which is not available.',
      );
    }
    const data = {
      rawText,
      pages: extraction.pages as unknown as Prisma.InputJsonValue,
      pageCount: extraction.pageCount,
      extractedMetadata: extraction.metadata as Prisma.InputJsonValue,
      characterCount: rawText.length,
      extractedAt: new Date(),
      normalizedText: null,
      blocks: Prisma.DbNull,
      normalizedAt: null,
      metadataProcessedAt: null,
      chunkedAt: null,
    };
    await this.prisma.knowledgeDocument.upsert({
      where: { versionId: version.id },
      create: { ...data, sourceId: job.sourceId, versionId: version.id },
      update: data,
    });
    for (const warning of extraction.warnings.slice(0, 20)) {
      await this.history(job, KnowledgeHistoryEvent.WARNING, warning.slice(0, 1000));
    }
    return {
      status: KnowledgeJobStatus.COMPLETED,
      message: `Extracted ${rawText.length} characters`,
      details: {
        pageCount: extraction.pageCount,
        characters: rawText.length,
        warnings: extraction.warnings.length,
      },
    };
  }

  private async normalize(job: JobRecord): Promise<StageResult> {
    const document = await this.requireDocument(job.versionId);
    const normalized = normalizeDocument(document.pages as unknown as ExtractedPage[]);
    if (normalized.blocks.length === 0) {
      throw new PermanentPipelineError('The document has no readable text after normalization');
    }
    await this.prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: {
        normalizedText: normalized.text,
        blocks: normalized.blocks as unknown as Prisma.InputJsonValue,
        characterCount: normalized.characterCount,
        wordCount: normalized.wordCount,
        normalizedAt: new Date(),
      },
    });
    return {
      status: KnowledgeJobStatus.COMPLETED,
      message: `Normalized into ${normalized.blocks.length} blocks`,
      details: { blocks: normalized.blocks.length, words: normalized.wordCount },
    };
  }

  private async extractMetadata(job: JobRecord): Promise<StageResult> {
    const document = await this.requireDocument(job.versionId);
    const text = document.normalizedText ?? '';
    const [crops, topics] = await Promise.all([
      this.prisma.crop.findMany({ where: { status: RecordStatus.ACTIVE } }),
      this.prisma.knowledgeTopic.findMany({ where: { status: RecordStatus.ACTIVE } }),
    ]);
    const language = detectLanguage(text);
    const detectedCropCodes = detectTags(
      text,
      crops.map((crop) => ({ code: crop.code, terms: cropTerms(crop) })),
    );
    const detectedTopicCodes = detectTags(text, topics.map(topicDefinition));

    await this.prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: {
        detectedLanguage: language.language,
        languageConfidence: language.confidence,
        detectedCropCodes,
        detectedTopicCodes,
        metadataProcessedAt: new Date(),
      },
    });
    if (language.language && language.language !== job.source.language) {
      await this.history(
        job,
        KnowledgeHistoryEvent.WARNING,
        `The text looks like "${language.language}" but the source language is "${job.source.language}". The source language is kept.`,
      );
    }
    return {
      status: KnowledgeJobStatus.COMPLETED,
      message: 'Metadata extracted',
      details: {
        detectedLanguage: language.language,
        languageConfidence: language.confidence,
        detectedCropCodes,
        detectedTopicCodes,
      },
    };
  }

  private async chunk(job: JobRecord): Promise<StageResult> {
    const document = await this.requireDocument(job.versionId);
    const options = this.chunkingOptions();
    const drafts = chunkBlocks((document.blocks ?? []) as unknown as NormalizedBlock[], options);
    if (drafts.length === 0) {
      throw new PermanentPipelineError('The document produced no chunks');
    }
    const topics = await this.prisma.knowledgeTopic.findMany({
      where: { status: RecordStatus.ACTIVE },
    });
    const context = {
      sourceCropCodes: job.source.crops.map((link) => link.crop.code),
      detectedCropCodes: document.detectedCropCodes,
      sourceTopicCodes: job.source.topics.map((link) => link.topic.code),
      topicDefinitions: topics.map(topicDefinition),
    };
    const rows = drafts.map((draft, index) => {
      const tags = chunkTags(draft.text, context);
      return {
        documentId: document.id,
        sourceId: job.sourceId,
        versionId: job.versionId,
        chunkIndex: index,
        text: draft.text,
        contentHash: draft.contentHash,
        sectionTitle: draft.sectionTitle?.slice(0, 300) ?? null,
        pageNumber: draft.pageNumber,
        language: job.source.language,
        cropCodes: tags.cropCodes,
        topicCodes: tags.topicCodes,
        metadata: {
          headingPath: draft.headingPath,
          pageEnd: draft.pageEnd,
          overlapChars: draft.overlapChars,
          charCount: draft.text.length,
        },
      };
    });
    await this.prisma.$transaction([
      this.prisma.knowledgeChunk.deleteMany({ where: { versionId: job.versionId } }),
      this.prisma.knowledgeChunk.createMany({ data: rows }),
      this.prisma.knowledgeDocument.update({
        where: { id: document.id },
        data: { chunkingOptions: { ...options }, chunkedAt: new Date() },
      }),
    ]);
    return {
      status: KnowledgeJobStatus.COMPLETED,
      message: `Created ${rows.length} chunks`,
      details: { chunks: rows.length, ...options },
    };
  }

  private async embed(job: JobRecord): Promise<StageResult> {
    const configuration = await this.prisma.embeddingConfiguration.findFirst({
      where: { status: RecordStatus.ACTIVE },
    });
    if (!configuration) {
      return { status: KnowledgeJobStatus.SKIPPED, message: 'No active embedding configuration' };
    }
    const provider = this.providers.find((candidate) => candidate.id === configuration.provider);
    if (!provider || !this.vectorStore) {
      return {
        status: KnowledgeJobStatus.SKIPPED,
        message: `No embedding provider "${configuration.provider}" or vector store is registered. Embeddings stay pending.`,
      };
    }
    const pending = await this.prisma.knowledgeEmbedding.findMany({
      where: {
        configurationId: configuration.id,
        status: { in: [EmbeddingStatus.PENDING, EmbeddingStatus.FAILED] },
        chunk: { versionId: job.versionId },
      },
      include: { chunk: true },
    });
    for (let start = 0; start < pending.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = pending.slice(start, start + EMBEDDING_BATCH_SIZE);
      const vectors = await provider.embed(
        batch.map((row) => row.chunk.text),
        configuration,
      );
      if (
        vectors.length !== batch.length ||
        vectors.some((vector) => vector.length !== configuration.dimensions)
      ) {
        throw new PermanentPipelineError(
          'The embedding provider returned vectors that do not match the configuration',
        );
      }
      const refs = await this.vectorStore.upsert(
        batch.map((row, index) => ({
          chunkId: row.chunkId,
          configurationId: configuration.id,
          vector: vectors[index],
          metadata: {
            sourceId: row.chunk.sourceId,
            versionId: row.chunk.versionId,
            language: row.chunk.language,
          },
        })),
      );
      await this.prisma.$transaction(
        batch.flatMap((row, index) => [
          this.prisma.knowledgeEmbedding.update({
            where: { id: row.id },
            data: {
              status: EmbeddingStatus.COMPLETED,
              dimensions: configuration.dimensions,
              vectorStore: this.vectorStore!.id,
              vectorRef: refs[index] ?? null,
              contentHash: row.chunk.contentHash,
              attempts: { increment: 1 },
              error: null,
              embeddedAt: new Date(),
            },
          }),
          this.prisma.knowledgeChunk.update({
            where: { id: row.chunkId },
            data: { status: KnowledgeChunkStatus.EMBEDDED },
          }),
        ]),
      );
    }
    return { status: KnowledgeJobStatus.COMPLETED, message: `Embedded ${pending.length} chunks` };
  }

  /** Queues the next stage, or marks the version processed after chunking. */
  private async advance(job: JobRecord): Promise<void> {
    const next = NEXT_STAGE[job.stage];
    if (next) {
      await this.jobs.enqueue({
        sourceId: job.sourceId,
        versionId: job.versionId,
        stage: next,
        requestedById: job.requestedById,
      });
      return;
    }
    if (job.stage !== KnowledgeStage.CHUNKING) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeSourceVersion.update({
        where: { id: job.versionId },
        data: {
          status: KnowledgeSourceStatus.PROCESSED,
          processedAt: new Date(),
          processingError: null,
        },
      });
      await syncSourceStatus(tx, job.sourceId);
    });
    await this.history(
      job,
      KnowledgeHistoryEvent.COMPLETED,
      'Processing finished. The version can be submitted for review.',
    );
    await this.prepareEmbeddings(job);
  }

  /** Records pending embeddings for the active configuration. Vectors are only made by a registered provider. */
  async prepareEmbeddings(job: {
    sourceId: string;
    versionId: string;
    requestedById: string | null;
  }): Promise<boolean> {
    const configuration = await this.prisma.embeddingConfiguration.findFirst({
      where: { status: RecordStatus.ACTIVE },
    });
    if (!configuration) return false;
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: { versionId: job.versionId },
      select: { id: true, contentHash: true },
    });
    if (chunks.length === 0) return false;
    await this.prisma.$transaction([
      this.prisma.knowledgeEmbedding.createMany({
        data: chunks.map((chunk) => ({
          chunkId: chunk.id,
          configurationId: configuration.id,
          contentHash: chunk.contentHash,
        })),
        skipDuplicates: true,
      }),
      this.prisma.knowledgeChunk.updateMany({
        where: { versionId: job.versionId, status: KnowledgeChunkStatus.CHUNKED },
        data: { status: KnowledgeChunkStatus.EMBEDDING_PENDING },
      }),
    ]);
    await this.jobs.enqueue({ ...job, stage: KnowledgeStage.EMBEDDING });
    return true;
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof PermanentPipelineError || error instanceof DocumentValidationError)
      return false;
    if (error instanceof ExtractionFailure) return error.retryable;
    return true;
  }

  private async handleFailure(job: JobRecord, error: unknown, options: RunOptions): Promise<void> {
    const message = describeError(error).slice(0, 2000);
    const final = !this.isRetryable(error) || options.attempt >= options.maxAttempts;
    this.logger.warn(
      `Knowledge job ${job.id} (${job.stage}) failed on attempt ${options.attempt}: ${message}`,
    );

    if (!final) {
      await this.prisma.knowledgeProcessingJob.update({
        where: { id: job.id },
        data: { status: KnowledgeJobStatus.QUEUED, error: message },
      });
      await this.history(
        job,
        KnowledgeHistoryEvent.RETRYING,
        `${job.stage} failed and will be retried: ${message}`.slice(0, 1000),
        {
          attempt: options.attempt,
          maxAttempts: options.maxAttempts,
        },
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeProcessingJob.update({
        where: { id: job.id },
        data: { status: KnowledgeJobStatus.FAILED, error: message, finishedAt: new Date() },
      });
      if (job.stage === KnowledgeStage.EMBEDDING) {
        await tx.knowledgeEmbedding.updateMany({
          where: {
            chunk: { versionId: job.versionId },
            status: { in: [EmbeddingStatus.PENDING, EmbeddingStatus.PROCESSING] },
          },
          data: { status: EmbeddingStatus.FAILED, error: message, attempts: { increment: 1 } },
        });
        await tx.knowledgeChunk.updateMany({
          where: { versionId: job.versionId, status: KnowledgeChunkStatus.EMBEDDING_PENDING },
          data: { status: KnowledgeChunkStatus.EMBEDDING_FAILED },
        });
      } else {
        await tx.knowledgeSourceVersion.update({
          where: { id: job.versionId },
          data: { status: KnowledgeSourceStatus.FAILED, processingError: message },
        });
        await syncSourceStatus(tx, job.sourceId);
      }
    });
    await this.history(
      job,
      KnowledgeHistoryEvent.FAILED,
      `${job.stage} failed: ${message}`.slice(0, 1000),
      {
        attempt: options.attempt,
        retryable: this.isRetryable(error),
      },
    );
  }

  private async finishJob(
    job: JobRecord,
    status: KnowledgeJobStatus,
    message: string,
    details?: Prisma.InputJsonValue,
  ) {
    await this.prisma.knowledgeProcessingJob.update({
      where: { id: job.id },
      data: { status, finishedAt: new Date(), error: null },
    });
    await this.history(
      job,
      status === KnowledgeJobStatus.SKIPPED
        ? KnowledgeHistoryEvent.SKIPPED
        : KnowledgeHistoryEvent.COMPLETED,
      `${job.stage}: ${message}`.slice(0, 1000),
      details,
    );
  }

  private history(
    job: JobRecord,
    event: KnowledgeHistoryEvent,
    message: string,
    details?: Prisma.InputJsonValue,
  ) {
    return this.prisma.knowledgeProcessingHistory.create({
      data: {
        sourceId: job.sourceId,
        versionId: job.versionId,
        jobId: job.id,
        stage: job.stage,
        event,
        message,
        details,
      },
    });
  }

  private loadJob(jobId: string): Promise<JobRecord | null> {
    return this.prisma.knowledgeProcessingJob.findUnique({
      where: { id: jobId },
      include: {
        version: true,
        source: {
          include: { crops: { include: { crop: true } }, topics: { include: { topic: true } } },
        },
      },
    });
  }

  private async requireDocument(versionId: string) {
    const document = await this.prisma.knowledgeDocument.findUnique({ where: { versionId } });
    if (!document)
      throw new PermanentPipelineError(
        'The document text is missing; extraction has not completed',
      );
    return document;
  }
}
