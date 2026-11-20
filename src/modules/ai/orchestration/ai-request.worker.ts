import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { aiConfig, queueConfig, redisConfig } from '../../../config/configuration';
import { AiRequestStatus } from '../../../generated/prisma/client';
import { QueueName } from '../../../infrastructure/queue/queue.constants';
import { AiOrchestratorService, type AiJobData } from './ai-orchestrator.service';

/**
 * Consumes the ai-generation queue. Permanent failures (no provider, no configuration,
 * validation) end the job without retries; transient provider errors are retried.
 * Disabled with AI_WORKER_ENABLED=false.
 */
@Injectable()
export class AiRequestWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AiRequestWorker.name);
  private worker?: Worker<AiJobData>;

  constructor(
    private readonly orchestrator: AiOrchestratorService,
    @Inject(aiConfig.KEY) private readonly ai: ConfigType<typeof aiConfig>,
    @Inject(redisConfig.KEY) private readonly redis: ConfigType<typeof redisConfig>,
    @Inject(queueConfig.KEY) private readonly queue: ConfigType<typeof queueConfig>,
  ) {}

  onModuleInit(): void {
    if (!this.ai.workerEnabled) return;
    this.worker = new Worker<AiJobData>(
      QueueName.AiGeneration,
      async (job: Job<AiJobData>) => {
        const outcome = await this.orchestrator.execute(job.data.requestId, {
          attempt: job.attemptsMade + 1,
          maxAttempts: job.opts.attempts ?? 1,
        });
        if (outcome.status === AiRequestStatus.FAILED && !outcome.skipped) {
          throw new UnrecoverableError(outcome.errorCode ?? 'AI_REQUEST_FAILED');
        }
        return outcome;
      },
      {
        prefix: this.queue.prefix,
        concurrency: this.ai.workerConcurrency,
        connection: {
          host: this.redis.host,
          port: this.redis.port,
          password: this.redis.password,
          db: this.redis.db,
          maxRetriesPerRequest: null,
        },
      },
    );
    this.worker.on('error', (error) => this.logger.warn(`AI worker: ${error.message}`));
    this.worker.on('failed', (job, error) =>
      this.logger.warn(`AI request ${job?.data.requestId ?? '?'} failed: ${error.message}`),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
