import type { Redis } from 'ioredis';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  const createClient = (status: string) =>
    ({
      status,
      ping: jest.fn().mockResolvedValue('PONG'),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    }) as unknown as jest.Mocked<Redis>;

  it('pings Redis when the connection is ready', async () => {
    const client = createClient('ready');

    await expect(new RedisService(client).ping()).resolves.toBe('PONG');
  });

  it('fails fast without sending a command when the connection is not ready', async () => {
    const client = createClient('reconnecting');

    await expect(new RedisService(client).ping()).rejects.toThrow(
      'Redis connection is not ready (status: reconnecting)',
    );
    expect(client.ping).not.toHaveBeenCalled();
  });

  it('stores and reads JSON values with optional TTL', async () => {
    const client = createClient('ready');
    client.get.mockResolvedValue('{"ok":true}');
    const redis = new RedisService(client);

    await expect(redis.getJson<{ ok: boolean }>('cache:key')).resolves.toEqual({ ok: true });
    await redis.setJson('cache:key', { ok: true }, 30);
    expect(client.set).toHaveBeenCalledWith('cache:key', '{"ok":true}', 'EX', 30);
    await redis.del('cache:key');
    expect(client.del).toHaveBeenCalledWith('cache:key');
  });

  it('closes the connection on shutdown', async () => {
    const client = createClient('ready');

    await new RedisService(client).onModuleDestroy();

    expect(client.quit).toHaveBeenCalled();
  });
});
