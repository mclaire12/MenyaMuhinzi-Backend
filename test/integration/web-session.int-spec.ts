import { TokenRevocationReason, UserStatus } from '../../src/generated/prisma/client';
import { AccountRequestsService } from '../../src/modules/account-requests/account-requests.service';
import { RoleCode } from '../../src/modules/roles/rbac.constants';
import { TokenService } from '../../src/modules/auth/services/token.service';
import { WebSessionCryptoService } from '../../src/modules/auth/services/web-session-crypto.service';
import { WebSessionService } from '../../src/modules/auth/services/web-session.service';
import { UsersService } from '../../src/modules/users/users.service';
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

describe('Web sessions', () => {
  let ctx: TestContext;
  let sessions: WebSessionService;

  beforeAll(async () => {
    ctx = await createTestContext();
    sessions = ctx.app.get(WebSessionService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
  });

  async function activeUser(email: string) {
    return seedUser(ctx.prisma, {
      roles: [RoleCode.SmartphoneFarmer],
      email,
      status: UserStatus.ACTIVE,
    });
  }

  it('creates a session and can look it up without storing the raw id or refresh token', async () => {
    const user = await activeUser('session@example.rw');
    const { sessionId } = await sessions.create({
      userId: user.id,
      passwordChangedAt: null,
      client: { ipAddress: '127.0.0.1' },
    });
    const row = await sessions.findBySessionId(sessionId);

    expect(row?.userId).toBe(user.id);
    expect(row?.sessionHash).not.toContain(sessionId);
    expect(Buffer.from(row?.refreshCiphertext ?? []).toString('utf8')).not.toContain('eyJ');
    const plaintext = await sessions.decryptRefreshToken(sessionId);
    expect(plaintext).toEqual(expect.any(String));
    expect(plaintext).not.toBe(row?.sessionHash);
    const storedHashes = await ctx.prisma.refreshToken.findMany({ select: { tokenHash: true } });
    expect(storedHashes.some((item) => item.tokenHash === plaintext)).toBe(false);

    const other = await activeUser('other@example.rw');
    await expect(sessions.revokeOne(sessionId, other.id, TokenRevocationReason.LOGOUT)).resolves.toBe(false);
    expect((await sessions.validate(sessionId)).ok).toBe(true);
  });

  it('rolls back the refresh token when the session insert fails', async () => {
    const user = await activeUser('rollback@example.rw');
    const created = await sessions.create({
      userId: user.id,
      passwordChangedAt: null,
      client: {},
    });
    const existing = await sessions.findBySessionId(created.sessionId);
    const before = await ctx.prisma.refreshToken.count();
    const hash = jest
      .spyOn(ctx.app.get(WebSessionCryptoService), 'hashSessionId')
      .mockReturnValue(existing?.sessionHash ?? '');

    await expect(
      sessions.create({ userId: user.id, passwordChangedAt: null, client: {} }),
    ).rejects.toThrow();
    hash.mockRestore();
    expect(await ctx.prisma.refreshToken.count()).toBe(before);
    expect(await ctx.prisma.webSession.count()).toBe(1);
  });

  it('enforces idle and absolute expiry and rotates only the expected version', async () => {
    const user = await activeUser('expiry@example.rw');
    const { sessionId } = await sessions.create({
      userId: user.id,
      passwordChangedAt: null,
      client: {},
    });
    const row = await sessions.findBySessionId(sessionId);
    await ctx.prisma.webSession.update({
      where: { id: row?.id },
      data: { idleExpiresAt: new Date(Date.now() - 1000) },
    });

    expect(await sessions.validate(sessionId)).toMatchObject({ ok: false, reason: 'idle_expired' });
    expect((await sessions.findBySessionId(sessionId))?.revokedAt).toEqual(expect.any(Date));

    const second = await sessions.create({ userId: user.id, passwordChangedAt: null, client: {} });
    const current = await sessions.findBySessionId(second.sessionId);
    await ctx.prisma.webSession.update({
      where: { id: current?.id },
      data: { absoluteExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await sessions.validate(second.sessionId)).toMatchObject({ ok: false, reason: 'absolute_expired' });

    const third = await sessions.create({ userId: user.id, passwordChangedAt: null, client: {} });
    const live = await sessions.validate(third.sessionId);
    expect(live.ok).toBe(true);
    if (!live.ok) return;
    expect(await sessions.rotateSessionId(third.sessionId, live.session.sessionVersion + 1)).toBeNull();
    const rotated = await sessions.rotateSessionId(third.sessionId, live.session.sessionVersion);
    expect(rotated).toEqual(expect.any(String));
    expect(await sessions.findBySessionId(third.sessionId)).toBeNull();
    expect((await sessions.findBySessionId(rotated as string))?.sessionVersion).toBe(2);
  });

  it('revokes sessions after password change, reset, suspension and rejection', async () => {
    const user = await activeUser('revoke@example.rw');
    const admin = await seedUser(ctx.prisma, {
      roles: [RoleCode.Admin],
      email: 'admin-session@example.rw',
      status: UserStatus.ACTIVE,
    });
    const created = await sessions.create({
      userId: user.id,
      passwordChangedAt: null,
      client: {},
    });
    const auth = await login(ctx, user.email as string);
    const changed = await ctx
      .http()
      .post(`${API}/auth/change-password`)
      .set(...bearer(auth.accessToken))
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'Ibihingwa2027' });
    expect(changed.status).toBe(204);
    expect((await sessions.findBySessionId(created.sessionId))?.revokedReason).toBe(
      TokenRevocationReason.PASSWORD_CHANGED,
    );
    expect(auth.accessToken).toEqual(expect.any(String));

    const resetUser = await activeUser('reset@example.rw');
    const resetSession = await sessions.create({
      userId: resetUser.id,
      passwordChangedAt: null,
      client: {},
    });
    const resetToken = 'reset-token-for-web-session';
    await ctx.prisma.passwordResetToken.create({
      data: {
        userId: resetUser.id,
        tokenHash: ctx.app.get(TokenService).hashToken(resetToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const reset = await ctx
      .http()
      .post(`${API}/auth/reset-password`)
      .send({ token: resetToken, newPassword: 'Ibihingwa2027' });
    expect(reset.status).toBe(204);
    expect((await sessions.findBySessionId(resetSession.sessionId))?.revokedReason).toBe(
      TokenRevocationReason.PASSWORD_CHANGED,
    );

    const suspendedUser = await activeUser('suspended@example.rw');
    const suspendedSession = await sessions.create({
      userId: suspendedUser.id,
      passwordChangedAt: null,
      client: {},
    });
    await ctx.app.get(UsersService).changeStatus(
      suspendedUser.id,
      { status: UserStatus.SUSPENDED, reason: 'Suspended for a test' },
      { id: admin.id, roles: [RoleCode.Admin], permissions: [] },
    );
    expect((await sessions.findBySessionId(suspendedSession.sessionId))?.revokedReason).toBe(
      TokenRevocationReason.ACCOUNT_DISABLED,
    );

    const applicant = await seedUser(ctx.prisma, {
      roles: [RoleCode.Facilitator],
      email: 'reject@example.rw',
      status: UserStatus.PENDING,
    });
    const role = await ctx.prisma.role.findUniqueOrThrow({ where: { code: RoleCode.Facilitator } });
    const request = await ctx.prisma.accountRequest.create({
      data: { userId: applicant.id, requestedRoleId: role.id },
      select: { id: true },
    });
    const rejectedSession = await sessions.create({
      userId: applicant.id,
      passwordChangedAt: null,
      client: {},
    });
    await ctx.app.get(AccountRequestsService).reject(
      request.id,
      { reason: 'The application was not accepted' },
      { id: admin.id, roles: [RoleCode.Admin], permissions: [] },
    );
    expect((await sessions.findBySessionId(rejectedSession.sessionId))?.revokedReason).toBe(
      TokenRevocationReason.ACCOUNT_DISABLED,
    );
  });

  it('fails validation when the stored password version no longer matches', async () => {
    const user = await activeUser('version@example.rw');
    const { sessionId } = await sessions.create({
      userId: user.id,
      passwordChangedAt: null,
      client: {},
    });
    await ctx.prisma.user.update({
      where: { id: user.id },
      data: { passwordChangedAt: new Date() },
    });

    expect(await sessions.validate(sessionId)).toMatchObject({ ok: false, reason: 'password_changed' });
    expect((await sessions.findBySessionId(sessionId))?.revokedReason).toBe(
      TokenRevocationReason.PASSWORD_CHANGED,
    );
  });
});
