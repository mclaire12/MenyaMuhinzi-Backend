import { Test } from '@nestjs/testing';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { RedisService } from '../infrastructure/redis/redis.service';
import { HEALTH_CHECK_TIMEOUT_MS, HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  const prisma = { ping: jest.fn() };
  const redis = { ping: jest.fn() };

  beforeEach(async () => {
    prisma.ping.mockReset().mockResolvedValue(undefined);
    redis.ping.mockReset().mockResolvedValue('PONG');

    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = moduleRef.get(HealthService);
  });

  afterEach(() => jest.useRealTimers());

  it('reports liveness without touching dependencies', () => {
    const result = service.liveness();

    expect(result.status).toBe('ok');
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(prisma.ping).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('is ok when PostgreSQL and Redis respond', async () => {
    const result = await service.readiness();

    expect(result.status).toBe('ok');
    expect(result.checks.database.status).toBe('up');
    expect(result.checks.redis.status).toBe('up');
  });

  it('reports the failing dependency when PostgreSQL is down', async () => {
    prisma.ping.mockRejectedValue(Object.assign(new Error(''), { code: 'ECONNREFUSED' }));

    const result = await service.readiness();

    expect(result.status).toBe('error');
    expect(result.checks.database).toEqual({
      status: 'down',
      latencyMs: expect.any(Number),
      error: 'ECONNREFUSED',
    });
    expect(result.checks.redis.status).toBe('up');
  });

  it('reports Redis as down when it is unavailable', async () => {
    redis.ping.mockRejectedValue(new Error('Redis connection is not ready (status: connecting)'));

    const result = await service.readiness();

    expect(result.status).toBe('error');
    expect(result.checks.redis.status).toBe('down');
    expect(result.checks.database.status).toBe('up');
  });

  it('marks a dependency as down when its check exceeds the timeout', async () => {
    jest.useFakeTimers();
    redis.ping.mockReturnValue(new Promise(() => undefined));

    const pending = service.readiness();
    await jest.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS + 1);
    const result = await pending;

    expect(result.status).toBe('error');
    expect(result.checks.redis.error).toBe(`Timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`);
  });
});
