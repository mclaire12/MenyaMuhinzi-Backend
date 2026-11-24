import { LogLevel, NodeEnvironment, validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const minimal = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    WEB_SESSION_HASH_SECRET: 'c'.repeat(32),
    WEB_SESSION_ENCRYPTION_KEY: Buffer.from('d'.repeat(32)).toString('base64'),
    MENYA_BFF_SHARED_SECRET: 'e'.repeat(32),
  };

  it('requires both JWT secrets', () => {
    expect(() => validateEnvironment({ DATABASE_URL: minimal.DATABASE_URL })).toThrow(
      /JWT_ACCESS_SECRET.*JWT_REFRESH_SECRET/,
    );
  });

  it('rejects a web-session secret reused from the JWT refresh secret', () => {
    expect(() =>
      validateEnvironment({ ...minimal, WEB_SESSION_HASH_SECRET: minimal.JWT_REFRESH_SECRET }),
    ).toThrow(/WEB_SESSION_HASH_SECRET must be distinct/);
  });

  it('rejects a web-session encryption key that is not 32 bytes', () => {
    expect(() =>
      validateEnvironment({ ...minimal, WEB_SESSION_ENCRYPTION_KEY: Buffer.from('short').toString('base64') }),
    ).toThrow(/WEB_SESSION_ENCRYPTION_KEY/);
  });

  it('rejects JWT secrets shorter than 32 characters', () => {
    expect(() => validateEnvironment({ ...minimal, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('rejects malformed token lifetimes', () => {
    expect(() => validateEnvironment({ ...minimal, JWT_REFRESH_EXPIRES_IN: '7 days' })).toThrow(
      /JWT_REFRESH_EXPIRES_IN must be a duration/,
    );
  });

  it('applies the authentication policy defaults', () => {
    const env = validateEnvironment(minimal);

    expect(env.JWT_ACCESS_EXPIRES_IN).toBe('15m');
    expect(env.JWT_REFRESH_EXPIRES_IN).toBe('7d');
    expect(env.AUTH_MAX_FAILED_LOGINS).toBe(5);
    expect(env.AUTH_FARMER_REQUIRES_APPROVAL).toBe(true);
    expect(env.AUTH_EXPOSE_RESET_TOKEN).toBe(false);
  });

  it('applies defaults when only required variables are provided', () => {
    const env = validateEnvironment(minimal);

    expect(env.NODE_ENV).toBe(NodeEnvironment.Development);
    expect(env.APP_PORT).toBe(4000);
    expect(env.API_PREFIX).toBe('api');
    expect(env.API_VERSION).toBe('1');
    expect(env.REDIS_PORT).toBe(6379);
    expect(env.LOG_LEVEL).toBe(LogLevel.Info);
    expect(env.SWAGGER_ENABLED).toBe(true);
  });

  it('converts numeric strings to numbers', () => {
    const env = validateEnvironment({ ...minimal, APP_PORT: '8080', REDIS_DB: '2' });

    expect(env.APP_PORT).toBe(8080);
    expect(env.REDIS_DB).toBe(2);
  });

  it.each([
    ['false', false],
    ['FALSE', false],
    ['true', true],
  ])('parses boolean string %p as %p', (raw, expected) => {
    const env = validateEnvironment({ ...minimal, SWAGGER_ENABLED: raw, LOG_PRETTY: raw });

    expect(env.SWAGGER_ENABLED).toBe(expected);
    expect(env.LOG_PRETTY).toBe(expected);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnvironment({})).toThrow(/DATABASE_URL/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateEnvironment({ ...minimal, APP_PORT: '70000' })).toThrow(/APP_PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnvironment({ ...minimal, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects a non-boolean flag', () => {
    expect(() => validateEnvironment({ ...minimal, SWAGGER_ENABLED: 'yes' })).toThrow(
      /SWAGGER_ENABLED/,
    );
  });
});
