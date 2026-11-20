import { Global, Logger, Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Redis } from 'ioredis';
import { ConnectionStateLogger } from '../../common/utils/connection-state-logger';
import { redisConfig } from '../../config/configuration';
import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [redisConfig.KEY],
      useFactory: (config: ConfigType<typeof redisConfig>): Redis => {
        const logger = new Logger('Redis');
        const client = new Redis({
          host: config.host,
          port: config.port,
          password: config.password,
          db: config.db,
          // Fail fast instead of queueing commands while Redis is unreachable.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
        });
        const state = new ConnectionStateLogger(logger, `Redis at ${config.host}:${config.port}`);
        client.on('ready', () => state.ready());
        client.on('error', (error) => state.error(error));
        return client;
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
