import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma.module';
import { LoggerModule } from './logger/logger.module';
import { QueueModule } from './queue/queue.module';
import { RedisModule } from './redis/redis.module';

/**
 * Cross-cutting technical services shared by every feature module.
 */
@Module({
  imports: [LoggerModule, PrismaModule, RedisModule, QueueModule],
  exports: [LoggerModule, PrismaModule, RedisModule, QueueModule],
})
export class InfrastructureModule {}
