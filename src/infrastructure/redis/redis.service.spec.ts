import type { Redis } from 'ioredis';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  const createClient = (status: string) =>
    ({
      status,
      ping: jest.fn().mockResolvedValue('PONG'),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
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

  it('closes the connection on shutdown', async () => {
    const client = createClient('ready');

    await new RedisService(client).onModuleDestroy();

    expect(client.quit).toHaveBeenCalled();
  });
});
