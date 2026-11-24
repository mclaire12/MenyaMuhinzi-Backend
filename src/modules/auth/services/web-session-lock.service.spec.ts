import type { Redis } from 'ioredis';
import { webSessionConfig } from '../../../config/configuration';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WebSessionLockService } from './web-session-lock.service';

const config = {
  hashSecret: 'web-session-hash-secret-0123456789abcd',
  previousHashSecret: undefined,
  encryptionKey: 'ignored',
  encryptionKeyVersion: 1,
  idleTtl: '30m',
  absoluteTtl: '12h',
  lockTtlMs: 1500,
};

function lockService(client: object): WebSessionLockService {
  return new WebSessionLockService(
    new RedisService(client as Redis),
    config as ReturnType<typeof webSessionConfig>,
  );
}

describe('WebSessionLockService', () => {
  it('acquires a lock with NX and PX, and only the owner can release it', async () => {
    const store = new Map<string, string>();
    const client = {
      status: 'ready' as const,
      set: jest.fn(async (key: string, value: string, px: string, ttl: number, nx: string) => {
        expect(px).toBe('PX');
        expect(ttl).toBe(1500);
        expect(nx).toBe('NX');
        if (store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      }),
      eval: jest.fn(async (_script: string, _count: number, key: string, owner: string) => {
        if (store.get(key) !== owner) return 0;
        store.delete(key);
        return 1;
      }),
    };
    const service = lockService(client);
    const first = await service.acquire('a'.repeat(64));
    const second = await service.acquire('a'.repeat(64));

    expect(first.acquired).toBe(true);
    expect(second).toEqual({ acquired: false, reason: 'contended' });
    if (!first.acquired) return;
    expect(await service.release({ ...first.lock, owner: 'someone-else' })).toBe(false);
    expect(store.size).toBe(1);
    expect(await service.release(first.lock)).toBe(true);
    expect(store.size).toBe(0);
  });

  it('fails closed when Redis is unavailable and does not report a lock', async () => {
    const down = lockService({ status: 'reconnecting' as const });
    await expect(down.acquire('abc')).resolves.toEqual({ acquired: false, reason: 'unavailable' });

    const throwing = lockService({
      status: 'ready' as const,
      set: jest.fn(async () => {
        throw new Error('connection reset');
      }),
    });
    await expect(throwing.acquire('abc')).resolves.toEqual({ acquired: false, reason: 'unavailable' });
  });
});
