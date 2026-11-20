import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { notificationsConfig, queueConfig, redisConfig } from '../../../config/configuration';
import { NotificationDeliveryStatus } from '../../../generated/prisma/client';
import { QueueName } from '../../../infrastructure/queue/queue.constants';
import { NotificationDispatcher, type DeliveryJobData } from './notification-dispatcher.service';

/**
 * Consumes the notification-delivery queue. Permanent failures (no provider, no address) end the
 * job without retries; transient provider errors are retried. Disabled with
 * NOTIFICATIONS_WORKER_ENABLED=false. The legacy `notifications` queue is not consumed here.
 */
@Injectable()
export class NotificationDeliveryWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationDeliveryWorker.name);
  private worker?: Worker<DeliveryJobData>;

  constructor(
    private readonly dispatcher: NotificationDispatcher,
    @Inject(notificationsConfig.KEY)
    private readonly config: ConfigType<typeof notificationsConfig>,
    @Inject(redisConfig.KEY) private readonly redis: ConfigType<typeof redisConfig>,
    @Inject(queueConfig.KEY) private readonly queue: ConfigType<typeof queueConfig>,
  ) {}

  onModuleInit(): void {
    if (!this.config.workerEnabled) return;
    this.worker = new Worker<DeliveryJobData>(
      QueueName.NotificationDelivery,
      async (job: Job<DeliveryJobData>) => {
        const outcome = await this.dispatcher.execute(job.data.deliveryId, {
          attempt: job.attemptsMade + 1,
          maxAttempts: job.opts.attempts ?? 1,
        });
        if (outcome.status === NotificationDeliveryStatus.FAILED && !outcome.skipped) {
          throw new UnrecoverableError(outcome.reasonCode ?? 'NOTIFICATION_DELIVERY_FAILED');
        }
        return outcome;
      },
      {
        prefix: this.queue.prefix,
        concurrency: this.config.workerConcurrency,
        connection: {
          host: this.redis.host,
          port: this.redis.port,
          password: this.redis.password,
          db: this.redis.db,
          maxRetriesPerRequest: null,
        },
      },
    );
    this.worker.on('error', (error) => this.logger.warn(`Notification worker: ${error.message}`));
    this.worker.on('failed', (job, error) =>
      this.logger.warn(`Delivery ${job?.data.deliveryId ?? '?'} failed: ${error.message}`),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
