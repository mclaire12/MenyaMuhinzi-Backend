import { UserStatus } from '../../src/generated/prisma/client';
import { REDIS_CLIENT } from '../../src/infrastructure/redis/redis.constants';
import { RoleCode } from '../../src/modules/roles/rbac.constants';
import {
  API,
  bearer,
  createTestContext,
  DEFAULT_PASSWORD,
  login,
  resetDatabase,
  seedUser,
  type TestContext,
} from './helpers';

const BFF_SECRET = process.env.MENYA_BFF_SHARED_SECRET as string;
const WEB_SESSIONS = `${API}/auth/web-sessions`;

function bffHeaders(sessionId?: string): Record<string, string> {
  const headers: Record<string, string> = { 'x-menya-bff-secret': BFF_SECRET };
  if (sessionId) headers['x-menya-web-session'] = sessionId;
  return headers;
}

function expectNoCredentialsInJson(body: unknown): void {
  const text = JSON.stringify(body);
  expect(body).not.toHaveProperty('accessToken');
  expect(body).not.toHaveProperty('refreshToken');
  expect(text).not.toMatch(/"sessionId"/);
  expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./);
}

describe('Web session HTTP endpoints (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
  });

  async function activeFarmer(email = 'farmer@example.rw') {
    return seedUser(ctx.prisma, {
      roles: [RoleCode.SmartphoneFarmer],
      email,
      status: UserStatus.ACTIVE,
    });
  }

  it('creates a web session on valid login without tokens in JSON', async () => {
    const user = await activeFarmer();
    const res = await ctx
      .http()
      .post(WEB_SESSIONS)
      .set(bffHeaders())
      .send({ email: user.email, password: DEFAULT_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.headers['x-menya-web-session']).toEqual(expect.any(String));
    expect(res.body.user.id).toBe(user.id);
    expect(res.body).toHaveProperty('idleExpiresAt');
    expect(res.body).toHaveProperty('absoluteExpiresAt');
    expectNoCredentialsInJson(res.body);
  });

  it('rejects invalid credentials', async () => {
    const user = await activeFarmer();
    const res = await ctx
      .http()
      .post(WEB_SESSIONS)
      .set(bffHeaders())
      .send({ email: user.email, password: 'WrongPassword2026!' });

    expect(res.status).toBe(401);
    expectNoCredentialsInJson(res.body);
  });

  it.each([
    ['pending', UserStatus.PENDING],
    ['rejected', UserStatus.REJECTED],
    ['suspended', UserStatus.SUSPENDED],
    ['inactive', UserStatus.INACTIVE],
  ] as const)('rejects %s accounts', async (_label, status) => {
    const user = await seedUser(ctx.prisma, {
      roles: [RoleCode.SmartphoneFarmer],
      email: `${status.toLowerCase()}@example.rw`,
      status,
    });
    const res = await ctx
      .http()
      .post(WEB_SESSIONS)
      .set(bffHeaders())
      .send({ email: user.email, password: DEFAULT_PASSWORD });

    expect(res.status).toBe(403);
    expectNoCredentialsInJson(res.body);
  });

  it('rejects missing or incorrect BFF secret', async () => {
    const user = await activeFarmer();
    const missing = await ctx
      .http()
      .post(WEB_SESSIONS)
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    expect(missing.status).toBe(401);

    const wrong = await ctx
      .http()
      .post(WEB_SESSIONS)
      .set({ 'x-menya-bff-secret': 'wrong-secret-that-is-long-enough-32chars' })
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    expect(wrong.status).toBe(401);
  });

  it('rejects browser-originated requests', async () => {
    const user = await activeFarmer();
    const res = await ctx
      .http()
      .post(WEB_SESSIONS)
      .set({ ...bffHeaders(), origin: 'https://evil.example' })
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(403);
  });

  it('returns current user for a valid session and requires session header', async () => {
    const user = await activeFarmer();
    const created = await ctx
      .http()
      .post(WEB_SESSIONS)
      .set(bffHeaders())
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    const sessionId = created.headers['x-menya-web-session'] as string;

    const missing = await ctx.http().get(`${WEB_SESSIONS}/me`).set(bffHeaders());
    expect(missing.status).toBe(401);

    const me = await ctx.http().get(`${WEB_SESSIONS}/me`).set(bffHeaders(sessionId));
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);
    expect(me.body.roles).toContain(RoleCode.SmartphoneFarmer);
    expect(me.body.permissions).toEqual(expect.any(Array));
    expectNoCredentialsInJson(me.body);
  });

  it('rejects expired and revoked sessions on /me', async () => {
    const user = await activeFarmer();
    const created = await ctx
      .http()
      .post(WEB_SESSIONS)
      .set(bffHeaders())
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    const sessionId = created.headers['x-menya-web-session'] as string;
    const row = await ctx.prisma.webSession.findFirst();
    await ctx.prisma.webSession.update({
      where: { id: row?.id },
      data: { idleExpiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await ctx.http().get(`${WEB_SESSIONS}/me`).set(bffHeaders(sessionId));
    expect(expired.status).toBe(401);

    const created2 = await ctx
      .http()
      .post(WEB_SESSIONS)
      .set(bffHeaders())
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    const session2 = created2.headers['x-menya-web-session'] as string;
    await ctx.http().delete(`${WEB_SESSIONS}/current`).set(bffHeaders(session2));
    const revoked = await ctx.http().get(`${WEB_SESSIONS}/me`).set(bffHeaders(session2));
    expect(revoked.status).toBe(401);
  });

  it('refreshes credentials through headers only', async () => {
    const user = await activeFarmer();
    const created = await ctx
      .http()
      .post(WEB_SESSIONS)
      .set(bffHeaders())
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    const sessionId = created.headers['x-menya-web-session'] as string;

    const refresh = await ctx.http().post(`${WEB_SESSIONS}/refresh`).set(bffHeaders(sessionId));
    expect(refresh.status).toBe(200);
    const nextId = refresh.headers['x-menya-web-session'] as string;
    expect(nextId).not.toBe(sessionId);
    expect(refresh.headers['x-menya-access-token']).toEqual(expect.any(String));
    expect(refresh.headers['x-menya-access-expires-in']).toEqual(expect.any(String));
    expectNoCredentialsInJson(refresh.body);

    const stale = await ctx.http().post(`${WEB_SESSIONS}/refresh`).set(bffHeaders(sessionId));
    expect(stale.status).toBe(401);

    const again = await ctx.http().post(`${WEB_SESSIONS}/refresh`).set(bffHeaders(nextId));
    expect(again.status).toBe(200);
    expect(again.headers['x-menya-web-session']).not.toBe(nextId);
  });

  it('coordinates concurrent refresh requests', async () => {
    const user = await activeFarmer();
    const created = await ctx
      .http()
      .post(WEB_SESSIONS)
      .set(bffHeaders())
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    const sessionId = created.headers['x-menya-web-session'] as string;

    const [a, b] = await Promise.all([
      ctx.http().post(`${WEB_SESSIONS}/refresh`).set(bffHeaders(sessionId)),
      ctx.http().post(`${WEB_SESSIONS}/refresh`).set(bffHeaders(sessionId)),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 200]);
    const winnerA = a.headers['x-menya-web-session'] as string;
    const winnerB = b.headers['x-menya-web-session'] as string;
    expect(winnerA).toBe(winnerB);
    expect(a.headers['x-menya-access-token']).toBe(b.headers['x-menya-access-token']);
    expectNoCredentialsInJson(a.body);
    expectNoCredentialsInJson(b.body);
  });

  it('returns 503 when Redis is unavailable for refresh', async () => {
    const down = await createTestContext({
      overrides: [
        {
          token: REDIS_CLIENT,
          value: { status: 'end', set: jest.fn(), get: jest.fn(), eval: jest.fn(), ping: jest.fn() },
        },
      ],
    });
    try {
      const user = await seedUser(down.prisma, {
        roles: [RoleCode.SmartphoneFarmer],
        email: 'redis-down@example.rw',
        status: UserStatus.ACTIVE,
      });
      const created = await down
        .http()
        .post(WEB_SESSIONS)
        .set(bffHeaders())
        .send({ email: user.email, password: DEFAULT_PASSWORD });
      const sessionId = created.headers['x-menya-web-session'] as string;
      const refresh = await down.http().post(`${WEB_SESSIONS}/refresh`).set(bffHeaders(sessionId));
      expect(refresh.status).toBe(503);
      expectNoCredentialsInJson(refresh.body);
    } finally {
      await down.close();
    }
  });

  it('logs out and tolerates repeated logout', async () => {
    const user = await activeFarmer();
    const created = await ctx
      .http()
      .post(WEB_SESSIONS)
      .set(bffHeaders())
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    const sessionId = created.headers['x-menya-web-session'] as string;

    const first = await ctx.http().delete(`${WEB_SESSIONS}/current`).set(bffHeaders(sessionId));
    expect(first.status).toBe(204);
    const second = await ctx.http().delete(`${WEB_SESSIONS}/current`).set(bffHeaders(sessionId));
    expect(second.status).toBe(204);
  });

  it('keeps JWT login and refresh working', async () => {
    const user = await activeFarmer('jwt-still@example.rw');
    const tokens = await login(ctx, user.email as string);
    const me = await ctx.http().get(`${API}/auth/me`).set(...bearer(tokens.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);

    const refreshed = await ctx
      .http()
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: tokens.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
  });
});