import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import { knowledgeConfig, queueConfig, redisConfig } from '../../../config/configuration';
import { QueueName } from '../../../infrastructure/queue/queue.constants';
import type { KnowledgeJobData } from './knowledge-jobs.service';
import { KnowledgePipelineService } from './knowledge-pipeline.service';

/**
 * Consumes the knowledge queue. Disabled with KNOWLEDGE_WORKER_ENABLED=false, for example
 * in tests or on API-only instances when a separate worker process runs the pipeline.
 */
@Injectable()
export class KnowledgeWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(KnowledgeWorker.name);
  private worker?: Worker<KnowledgeJobData>;

  constructor(
    private readonly pipeline: KnowledgePipelineService,
    @Inject(knowledgeConfig.KEY) private readonly knowledge: ConfigType<typeof knowledgeConfig>,
    @Inject(redisConfig.KEY) private readonly redis: ConfigType<typeof redisConfig>,
    @Inject(queueConfig.KEY) private readonly queue: ConfigType<typeof queueConfig>,
  ) {}

  onModuleInit(): void {
    if (!this.knowledge.workerEnabled) return;
    this.worker = new Worker<KnowledgeJobData>(
      QueueName.Knowledge,
      (job: Job<KnowledgeJobData>) =>
        this.pipeline.runJob(job.data.jobId, {
          attempt: job.attemptsMade + 1,
          maxAttempts: job.opts.attempts ?? 1,
        }),
      {
        prefix: this.queue.prefix,
        concurrency: this.knowledge.workerConcurrency,
        connection: {
          host: this.redis.host,
          port: this.redis.port,
          password: this.redis.password,
          db: this.redis.db,
          maxRetriesPerRequest: null,
        },
      },
    );
    this.worker.on('error', (error) => this.logger.warn(`Knowledge worker: ${error.message}`));
    this.worker.on('failed', (job, error) =>
      this.logger.warn(`Knowledge job ${job?.data.jobId ?? '?'} failed: ${error.message}`),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
