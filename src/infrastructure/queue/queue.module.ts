import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { queueConfig, redisConfig } from '../../config/configuration';
import { queueConnectionMonitorProvider } from './queue-connection.monitor';
import { ALL_QUEUES } from './queue.constants';

const registeredQueues = BullModule.registerQueue(...ALL_QUEUES.map((name) => ({ name })));

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [redisConfig.KEY, queueConfig.KEY],
      useFactory: (redis: ConfigType<typeof redisConfig>, queue: ConfigType<typeof queueConfig>) => ({
        prefix: queue.prefix,
        connection: {
          host: redis.host,
          port: redis.port,
          password: redis.password,
          db: redis.db,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      }),
    }),
    registeredQueues,
  ],
  providers: [queueConnectionMonitorProvider],
  exports: [registeredQueues],
})
export class QueueModule {}
