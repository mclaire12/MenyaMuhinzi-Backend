import { LOG_REDACT_PATHS } from './logger.module';

describe('log redaction', () => {
  it('covers session headers, cookies, passwords and tokens', () => {
    const paths = LOG_REDACT_PATHS.join('\n');
    expect(paths).toContain('x-menya-web-session');
    expect(paths).toContain('x-menya-bff-secret');
    expect(paths).toContain('x-menya-access-token');
    expect(paths).toContain('authorization');
    expect(paths).toContain('cookie');
    expect(paths).toContain('set-cookie');
    expect(paths).toContain('password');
    expect(paths).toContain('accessToken');
    expect(paths).toContain('refreshToken');
    expect(paths).toContain('sessionId');
  });
});
