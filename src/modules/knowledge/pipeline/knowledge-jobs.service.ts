import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { knowledgeConfig } from '../../../config/configuration';
import {
  KnowledgeHistoryEvent,
  KnowledgeJobStatus,
  type KnowledgeStage,
  Prisma,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { QueueName } from '../../../infrastructure/queue/queue.constants';

export interface KnowledgeJobData {
  /** KnowledgeProcessingJob.id; also used as the BullMQ job id so a stage is never queued twice. */
  jobId: string;
}

export interface EnqueueRequest {
  sourceId: string;
  versionId: string;
  stage: KnowledgeStage;
  requestedById: string | null;
}

export const OPEN_JOB_STATUSES: KnowledgeJobStatus[] = [
  KnowledgeJobStatus.QUEUED,
  KnowledgeJobStatus.RUNNING,
];

@Injectable()
export class KnowledgeJobsService {
  private readonly logger = new Logger(KnowledgeJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QueueName.Knowledge) private readonly queue: Queue<KnowledgeJobData>,
    @Inject(knowledgeConfig.KEY) private readonly config: ConfigType<typeof knowledgeConfig>,
  ) {}

  /**
   * Records the stage and queues it. If the stage is already queued or running for the
   * version, the existing job is returned instead of starting a second one.
   */
  async enqueue(request: EnqueueRequest): Promise<{ id: string; duplicate: boolean }> {
    const existing = await this.findOpen(request.versionId, request.stage);
    if (existing) return { id: existing.id, duplicate: true };

    const previousRuns = await this.prisma.knowledgeProcessingJob.count({
      where: { versionId: request.versionId, stage: request.stage },
    });
    let job: { id: string };
    try {
      job = await this.prisma.$transaction(async (tx) => {
        const created = await tx.knowledgeProcessingJob.create({
          data: {
            sourceId: request.sourceId,
            versionId: request.versionId,
            stage: request.stage,
            runNumber: previousRuns + 1,
            maxAttempts: this.config.jobAttempts,
            requestedById: request.requestedById,
          },
          select: { id: true },
        });
        await tx.knowledgeProcessingHistory.create({
          data: {
            sourceId: request.sourceId,
            versionId: request.versionId,
            jobId: created.id,
            stage: request.stage,
            event: KnowledgeHistoryEvent.QUEUED,
            message: `${request.stage} queued`,
          },
        });
        return created;
      });
    } catch (error) {
      // The partial unique index allows one open job per version and stage.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const open = await this.findOpen(request.versionId, request.stage);
        if (open) return { id: open.id, duplicate: true };
      }
      throw error;
    }

    try {
      await this.queue.add(
        request.stage,
        { jobId: job.id },
        {
          jobId: job.id,
          attempts: this.config.jobAttempts,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
    } catch (error) {
      const message = 'The processing queue is unavailable';
      this.logger.error(`${message}: ${(error as Error).message}`);
      await this.prisma.knowledgeProcessingJob.update({
        where: { id: job.id },
        data: { status: KnowledgeJobStatus.FAILED, error: message, finishedAt: new Date() },
      });
      throw new ServiceUnavailableException(message);
    }
    await this.prisma.knowledgeProcessingJob.update({
      where: { id: job.id },
      data: { queueJobId: job.id },
    });
    return { id: job.id, duplicate: false };
  }

  private findOpen(versionId: string, stage: KnowledgeStage) {
    return this.prisma.knowledgeProcessingJob.findFirst({
      where: { versionId, stage, status: { in: OPEN_JOB_STATUSES } },
      select: { id: true },
    });
  }
}
