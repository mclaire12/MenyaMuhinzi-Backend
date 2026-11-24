import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { authConfig, queueConfig, redisConfig } from '../../../config/configuration';
import { QueueName } from '../../../infrastructure/queue/queue.constants';
import { PASSWORD_RESET_JOB, type PasswordResetJob } from '../auth.service';
import { PasswordResetDeliveryService } from './password-reset-delivery.service';

/**
 * Consumes legacy `notifications` queue jobs produced by forgot-password. Does not log reset tokens.
 */
@Injectable()
export class PasswordResetWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PasswordResetWorker.name);
  private worker?: Worker<PasswordResetJob>;

  constructor(
    private readonly delivery: PasswordResetDeliveryService,
    @Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>,
    @Inject(redisConfig.KEY) private readonly redis: ConfigType<typeof redisConfig>,
    @Inject(queueConfig.KEY) private readonly queue: ConfigType<typeof queueConfig>,
  ) {}

  onModuleInit(): void {
    if (!this.auth.passwordResetWorkerEnabled) return;

    this.worker = new Worker<PasswordResetJob>(
      QueueName.Notifications,
      async (job: Job<PasswordResetJob>) => {
        if (job.name !== PASSWORD_RESET_JOB) return;
        const outcome = await this.delivery.deliverById(job.data.deliveryId);
        if (!outcome.delivered) {
          const retryable =
            outcome.reason !== 'SMTP_NOT_CONFIGURED' &&
            outcome.reason !== 'TWILIO_NOT_CONFIGURED' &&
            outcome.reason !== 'FRONTEND_SITE_ORIGIN_NOT_CONFIGURED' &&
            outcome.reason !== 'DELIVERY_RECORD_UNAVAILABLE';
          if (!retryable) {
            throw new UnrecoverableError(outcome.reason);
          }
          throw new Error(outcome.reason);
        }
        return outcome;
      },
      {
        prefix: this.queue.prefix,
        concurrency: 2,
        connection: {
          host: this.redis.host,
          port: this.redis.port,
          password: this.redis.password,
          db: this.redis.db,
          maxRetriesPerRequest: null,
        },
      },
    );

    this.worker.on('failed', (job, error) => {
      if (job?.name !== PASSWORD_RESET_JOB) return;
      const deliveryId = job.data.deliveryId;
      this.logger.warn(`Password reset delivery ${deliveryId} failed: ${error.message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}