import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConnectionStateLogger } from '../../common/utils/connection-state-logger';
import { databaseConfig } from '../../config/configuration';
import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly state = new ConnectionStateLogger(new Logger(PrismaService.name), 'PostgreSQL');

  constructor(@Inject(databaseConfig.KEY) config: ConfigType<typeof databaseConfig>) {
    super({ adapter: new PrismaPg({ connectionString: config.url }) });
  }

  async onModuleInit(): Promise<void> {
    // The pg driver adapter connects lazily, so verify with a real query.
    // A database outage must not prevent the API from booting; /health reports it instead.
    try {
      await this.ping();
      this.state.ready();
    } catch (error) {
      this.state.error(error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
