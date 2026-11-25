import { UserStatus } from '../../src/generated/prisma/client';
import { RoleCode } from '../../src/modules/roles/rbac.constants';
import { hashVerificationToken } from '../../src/modules/users/email-verification.service';
import {
  API,
  createTestContext,
  DEFAULT_PASSWORD,
  localFormat,
  nextPhone,
  resetDatabase,
  seedUser,
  type TestContext,
} from './helpers';

const INVALID = 'Email verification link is invalid or has expired';
const GENERIC_RESEND =
  'If an account matches and still needs verification, a new verification email has been sent.';

describe('Email verification (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.mail.clear();
  });

  async function registerFarmer(): Promise<{ userId: string; email: string; phone: string }> {
    const phone = localFormat(nextPhone());
    const email = `farmer.${phone}@example.rw`;
    const res = await ctx
      .http()
      .post(`${API}/auth/register`)
      .send({
        accountType: RoleCode.SmartphoneFarmer,
        fullName: 'Uwimana Jeanne',
        phoneNumber: phone,
        email,
        password: DEFAULT_PASSWORD,
        location: {
          province: 'NORTHERN',
          district: 'Musanze',
          sector: 'Muhoza',
          cell: 'Ruhengeri',
          village: 'Kigombe',
        },
      })
      .expect(201);
    return { userId: res.body.user.id, email, phone };
  }

  const verify = (body: { token: unknown; code?: unknown }) =>
    ctx.http().post(`${API}/auth/verify-email`).send(body);
  const latest = (userId: string) => ctx.mail.latestVerification(userId);
  const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');
  const signIn = (identifier: string) =>
    ctx.http().post(`${API}/auth/login`).send({ identifier, password: DEFAULT_PASSWORD });
  /** Moves the user's last verification email out of the resend cooldown. */
  const ageTokens = (userId: string) =>
    ctx.prisma.emailVerificationToken.updateMany({
      where: { userId },
      data: { createdAt: new Date(Date.now() - 5 * 60_000) },
    });

  it('emails a link and a 6-digit code, stores only hashes, and verifies with both', async () => {
    const { userId, email } = await registerFarmer();
    const { token, code } = latest(userId);
    expect(code).toMatch(/^\d{6}$/);
    const row = await ctx.prisma.emailVerificationToken.findUniqueOrThrow({
      where: { tokenHash: hashVerificationToken(token) },
    });
    expect(row.otpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.otpHash).not.toContain(code);

    await verify({ token, code }).expect(204);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    const stored = await ctx.prisma.emailVerificationToken.findUniqueOrThrow({
      where: { tokenHash: hashVerificationToken(token) },
    });
    expect(stored.usedAt).toBeInstanceOf(Date);
    await signIn(email).expect(200);
  });

  it('refuses a reused token', async () => {
    const { userId } = await registerFarmer();
    const body = latest(userId);
    await verify(body).expect(204);

    const reuse = await verify(body);
    expect(reuse.status).toBe(400);
    expect(reuse.body.message).toBe(INVALID);
  });

  it('refuses an expired token and leaves the account unverified', async () => {
    const { userId, email } = await registerFarmer();
    await ctx.prisma.emailVerificationToken.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await verify(latest(userId));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(INVALID);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.emailVerifiedAt).toBeNull();
    await signIn(email).expect(403);
  });

  it.each([
    ['an unknown token', 'not-a-real-token'],
    ['an empty token', ''],
  ])('refuses %s', async (_label, token) => {
    const res = await verify({ token, code: '123456' });
    expect(res.status).toBe(400);
  });

  it('rejects requests without a token or code, a malformed code, or extra fields', async () => {
    const { userId } = await registerFarmer();
    const { token, code } = latest(userId);
    await verify({ token }).expect(400);
    await verify({ token, code: '12345' }).expect(400);
    await verify({ token, code: 'abcdef' }).expect(400);
    await ctx.http().post(`${API}/auth/verify-email`).send({}).expect(400);
    await ctx
      .http()
      .post(`${API}/auth/verify-email`)
      .send({ token, code, userId: 'y' })
      .expect(400);
    // None of the malformed requests counted against the link.
    await verify({ token, code }).expect(204);
  });

  it('refuses a wrong code, counts attempts, and retires the link after 5 wrong codes', async () => {
    const { userId, email } = await registerFarmer();
    const { token, code } = latest(userId);

    const first = await verify({ token, code: wrongCode(code) });
    expect(first.status).toBe(400);
    expect(first.body.message).toBe('The verification code is incorrect. 4 attempt(s) remaining.');
    for (let attempt = 2; attempt <= 4; attempt += 1) {
      await verify({ token, code: wrongCode(code) }).expect(400);
    }
    const last = await verify({ token, code: wrongCode(code) });
    expect(last.body.message).toBe(INVALID);

    // Even the right code no longer works: the user must request a new email.
    const retired = await verify({ token, code });
    expect(retired.status).toBe(400);
    expect(retired.body.message).toBe(INVALID);
    await signIn(email).expect(403);
  });

  it('does not accept the code with another email link', async () => {
    const a = await registerFarmer();
    const b = await registerFarmer();
    await verify({ token: latest(a.userId).token, code: latest(b.userId).code }).expect(400);
  });

  it('refuses a token issued for an address the account no longer uses', async () => {
    const { userId } = await registerFarmer();
    const body = latest(userId);
    await ctx.prisma.user.update({ where: { id: userId }, data: { email: 'changed@example.rw' } });

    const res = await verify(body);
    expect(res.status).toBe(400);
  });

  it('resends with a generic answer, invalidates the previous link and rate-limits per account', async () => {
    const { userId, email, phone } = await registerFarmer();
    const first = latest(userId);

    // Inside the cooldown: no second email, same generic answer.
    const early = await ctx
      .http()
      .post(`${API}/auth/resend-verification`)
      .send({ identifier: email });
    expect(early.status).toBe(202);
    expect(early.body).toEqual({ message: GENERIC_RESEND });
    expect(ctx.mail.verificationsFor(userId)).toHaveLength(1);

    await ageTokens(userId);
    await ctx
      .http()
      .post(`${API}/auth/resend-verification`)
      .send({ identifier: phone })
      .expect(202);
    expect(ctx.mail.verificationsFor(userId)).toHaveLength(2);
    const second = latest(userId);
    expect(second.token).not.toBe(first.token);

    await verify(first).expect(400);
    await verify(second).expect(204);

    // Once verified, nothing more is sent.
    await ageTokens(userId);
    await ctx
      .http()
      .post(`${API}/auth/resend-verification`)
      .send({ identifier: email })
      .expect(202);
    expect(ctx.mail.verificationsFor(userId)).toHaveLength(2);
  });

  it('gives the same answer for unknown accounts and never reveals existence', async () => {
    const res = await ctx
      .http()
      .post(`${API}/auth/resend-verification`)
      .send({ identifier: 'nobody@example.rw' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: GENERIC_RESEND });
    expect(ctx.mail.sent).toHaveLength(0);
    await ctx.http().post(`${API}/auth/resend-verification`).send({}).expect(400);
  });

  it('cannot be used by a pending facilitator to skip administrator approval', async () => {
    const res = await ctx
      .http()
      .post(`${API}/auth/register`)
      .send({
        accountType: RoleCode.Facilitator,
        fullName: 'Niyonsaba Claudine',
        phoneNumber: nextPhone(),
        email: 'claudine@rab.gov.rw',
        password: DEFAULT_PASSWORD,
        location: { province: 'SOUTHERN', district: 'Huye' },
        facilitator: { professionalTitle: 'Agronomist', organization: 'Rwanda Agriculture Board' },
      })
      .expect(201);
    const userId = res.body.user.id as string;

    await ctx
      .http()
      .post(`${API}/auth/resend-verification`)
      .send({ identifier: 'claudine@rab.gov.rw' })
      .expect(202);
    expect(ctx.mail.verificationsFor(userId)).toHaveLength(0);
    await expect(ctx.prisma.emailVerificationToken.count({ where: { userId } })).resolves.toBe(0);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.status).toBe(UserStatus.PENDING);
    const login = await signIn('claudine@rab.gov.rw');
    expect(login.status).toBe(403);
    expect(login.body.message).toMatch(/awaiting administrator approval/);
  });

  it('does not verify accounts that are no longer active', async () => {
    const { userId } = await registerFarmer();
    await ctx.prisma.user.update({ where: { id: userId }, data: { status: UserStatus.SUSPENDED } });
    await verify(latest(userId)).expect(400);
  });

  it('lets an eligible basic-phone farmer sign in once verified', async () => {
    const farmer = await seedUser(ctx.prisma, {
      roles: [RoleCode.BasicPhoneFarmer],
      email: 'basic@example.rw',
      emailVerified: false,
    });
    await signIn('basic@example.rw').expect(403);

    await ctx
      .http()
      .post(`${API}/auth/resend-verification`)
      .send({ identifier: localFormat(farmer.phoneNumber) })
      .expect(202);
    await verify(latest(farmer.id)).expect(204);

    const res = await signIn(localFormat(farmer.phoneNumber));
    expect(res.status).toBe(200);
    expect(res.body.user.roles).toEqual([RoleCode.BasicPhoneFarmer]);
  });
});
