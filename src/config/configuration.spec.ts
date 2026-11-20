import { appConfig, redisConfig } from './configuration';

describe('configuration namespaces', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('splits and trims CORS origins', () => {
    process.env.CORS_ORIGINS = 'https://a.rw, https://b.rw ,';

    expect(appConfig().corsOrigins).toEqual(['https://a.rw', 'https://b.rw']);
  });

  it('treats an empty Redis password as no password', () => {
    process.env.REDIS_PASSWORD = '';

    expect(redisConfig().password).toBeUndefined();
  });

  it('reads Redis connection settings from the environment', () => {
    process.env.REDIS_HOST = 'redis.internal';
    process.env.REDIS_PORT = '6380';
    process.env.REDIS_PASSWORD = 'secret';

    expect(redisConfig()).toEqual({
      host: 'redis.internal',
      port: 6380,
      password: 'secret',
      db: 0,
    });
  });
});
