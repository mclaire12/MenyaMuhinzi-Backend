import { Injectable } from '@nestjs/common';
import { describeError } from '../common/utils/describe-error';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { RedisService } from '../infrastructure/redis/redis.service';
import type { DependencyHealthDto, HealthResponseDto, LivenessResponseDto } from './dto/health-response.dto';

export const HEALTH_CHECK_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  liveness(): LivenessResponseDto {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime() * 10) / 10,
    };
  }

  async readiness(): Promise<HealthResponseDto> {
    const [database, redis] = await Promise.all([
      this.check(() => this.prisma.ping()),
      this.check(() => this.redis.ping()),
    ]);

    const healthy = database.status === 'up' && redis.status === 'up';
    return {
      ...this.liveness(),
      status: healthy ? 'ok' : 'error',
      checks: { database, redis },
    };
  }

  private async check(probe: () => Promise<unknown>): Promise<DependencyHealthDto> {
    const startedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        probe(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`)),
            HEALTH_CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - startedAt,
        error: describeError(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
