import {
  AccountRequestStatus,
  LoginAttemptOutcome,
  TokenRevocationReason,
  UserStatus,
} from '../../src/generated/prisma/client';
import { PASSWORD_RESET_JOB } from '../../src/modules/auth/auth.service';
import { PasswordResetDeliveryStoreService } from '../../src/modules/auth/delivery/password-reset-delivery-store.service';
import { RoleCode } from '../../src/modules/roles/rbac.constants';
import {
  API,
  bearer,
  createTestContext,
  DEFAULT_PASSWORD,
  localFormat,
  login,
  nextPhone,
  notificationsQueue,
  resetDatabase,
  resetTokenFromJob,
  seedUser,
  type TestContext,
} from './helpers';

const farmerRegistration = (phoneNumber = localFormat(nextPhone())) => ({
  accountType: RoleCode.SmartphoneFarmer,
  fullName: 'Uwimana Jeanne',
  phoneNumber,
  email: `jeanne.${phoneNumber.replace(/\D/g, '')}@example.rw`,
  password: DEFAULT_PASSWORD,
  location: {
    province: 'NORTHERN',
    district: 'musanze',
    sector: 'Muhoza',
    cell: 'Ruhengeri',
    village: 'Kigombe',
  },
});

describe('Authentication (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    notificationsQueue(ctx).add.mockClear();
    ctx.mail.clear();
  });

  describe('POST /auth/register', () => {
    it('registers a smartphone farmer without approval and sends an email verification link', async () => {
      const res = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({ ...farmerRegistration('0788111222'), email: 'Jeanne@Example.rw' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        requiresApproval: false,
        requiresEmailVerification: true,
        verificationEmailSent: true,
        accountRequestId: null,
        user: {
          phoneNumber: '+250788111222',
          status: UserStatus.ACTIVE,
          roles: [RoleCode.SmartphoneFarmer],
          preferredLanguage: 'rw',
          email: 'jeanne@example.rw',
        },
      });
      // The token only ever travels in the email, and only its hash is stored.
      const [mail] = ctx.mail.verificationsFor(res.body.user.id);
      expect(mail).toMatchObject({ to: 'jeanne@example.rw', context: 'registration' });
      expect(JSON.stringify(res.body)).not.toContain(mail!.token);
      const storedToken = await ctx.prisma.emailVerificationToken.findFirstOrThrow({
        where: { userId: res.body.user.id },
      });
      expect(storedToken.tokenHash).not.toBe(mail!.token);
      expect(res.body).not.toHaveProperty('accessToken');
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt/);

      const user = await ctx.prisma.user.findUniqueOrThrow({
        where: { phoneNumber: '+250788111222' },
        include: { farmerProfile: true, location: true, accountRequests: true },
      });
      expect(user.passwordHash).toMatch(/^scrypt\$/);
      expect(user.passwordHash).not.toContain(DEFAULT_PASSWORD);
      expect(user.farmerProfile).toMatchObject({
        farmerType: 'SMARTPHONE',
        farmerCategory: 'SMALLHOLDER',
      });
      expect(user.location).toMatchObject({
        province: 'NORTHERN',
        district: 'Musanze',
        sector: 'Muhoza',
        cell: 'Ruhengeri',
        village: 'Kigombe',
      });
      expect(user.emailVerifiedAt).toBeNull();
      // Smartphone farmers never enter the administrator approval queue.
      expect(user.accountRequests).toHaveLength(0);
    });

    it('reports honestly when the verification email could not be sent', async () => {
      ctx.mail.failNext = true;
      const res = await ctx.http().post(`${API}/auth/register`).send(farmerRegistration());
      expect(res.status).toBe(201);
      expect(res.body.verificationEmailSent).toBe(false);
      expect(res.body.message).toMatch(/could not be sent/);
    });

    it('requires a personal email and the full address for smartphone farmers', async () => {
      const { email: _email, ...noEmail } = farmerRegistration();
      const missingEmail = await ctx.http().post(`${API}/auth/register`).send(noEmail);
      expect(missingEmail.status).toBe(400);
      expect(missingEmail.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/^email/)]),
      );

      const body = farmerRegistration();
      const missingVillage = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({ ...body, location: { ...body.location, village: undefined, cell: '' } });
      expect(missingVillage.status).toBe(400);
      expect(missingVillage.body.message).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/location\.cell/),
          expect.stringMatching(/location\.village/),
        ]),
      );
    });

    it('accepts facilitator titles only from the approved list', async () => {
      const facilitator = (professionalTitle: string) => ({
        accountType: RoleCode.Facilitator,
        fullName: 'Niyonsaba Claudine',
        phoneNumber: nextPhone(),
        email: `claudine.${Math.random().toString(36).slice(2, 8)}@rab.gov.rw`,
        password: DEFAULT_PASSWORD,
        location: { province: 'SOUTHERN', district: 'Huye' },
        facilitator: { professionalTitle, organization: 'Rwanda Agriculture Board' },
      });
      const invalid = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send(facilitator('Chief Wizard'));
      expect(invalid.status).toBe(400);
      expect(invalid.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/professionalTitle must be one of/)]),
      );
      const valid = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send(facilitator('Agricultural Extension Officer'));
      expect(valid.status).toBe(201);
      const profile = await ctx.prisma.facilitatorProfile.findFirstOrThrow({
        where: { userId: valid.body.user.id },
      });
      expect(profile.professionalTitle).toBe('Agricultural Extension Officer');
    });

    it('registers a facilitator with profile details', async () => {
      const res = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({
          accountType: RoleCode.Facilitator,
          fullName: 'Niyonsaba Claudine',
          phoneNumber: nextPhone(),
          email: 'Claudine@RAB.gov.rw',
          password: DEFAULT_PASSWORD,
          preferredLanguage: 'en',
          location: { province: 'SOUTHERN', district: 'Huye' },
          facilitator: {
            professionalTitle: 'Agronomist',
            organization: 'Rwanda Agriculture Board',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ requiresApproval: true, verificationEmailSent: false });
      expect(res.body.user).toMatchObject({
        email: 'claudine@rab.gov.rw',
        status: UserStatus.PENDING,
        roles: [RoleCode.Facilitator],
        preferredLanguage: 'en',
      });
      // Verification is only triggered after an administrator approves the request.
      expect(ctx.mail.sent).toHaveLength(0);
      const request = await ctx.prisma.accountRequest.findFirstOrThrow({
        where: { userId: res.body.user.id },
      });
      expect(request.status).toBe(AccountRequestStatus.PENDING);
      const profile = await ctx.prisma.facilitatorProfile.findFirstOrThrow({
        where: { userId: res.body.user.id },
      });
      expect(profile.organization).toBe('Rwanda Agriculture Board');
    });

    it('requires email and facilitator details for facilitators', async () => {
      const res = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({
          accountType: RoleCode.Facilitator,
          fullName: 'No Details',
          phoneNumber: nextPhone(),
          password: DEFAULT_PASSWORD,
          location: { province: 'SOUTHERN', district: 'Huye' },
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^email/),
          expect.stringMatching(/^facilitator/),
        ]),
      );
    });

    it.each([
      ['an administrator role', { accountType: RoleCode.Admin }],
      ['a basic-phone farmer role', { accountType: RoleCode.BasicPhoneFarmer }],
      ['an invalid phone number', { phoneNumber: '0612345678' }],
      ['a weak password', { password: 'password' }],
      [
        'a district outside the province',
        { location: { province: 'SOUTHERN', district: 'Musanze', sector: 'X' } },
      ],
      ['a farmer without a sector', { location: { province: 'NORTHERN', district: 'Musanze' } }],
      ['unknown fields', { roles: [RoleCode.Admin] }],
    ])('rejects %s', async (_case, override) => {
      const res = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({ ...farmerRegistration(), ...override });
      expect(res.status).toBe(400);
    });

    it('rejects a duplicate phone number in any format', async () => {
      await seedUser(ctx.prisma, {
        roles: [RoleCode.SmartphoneFarmer],
        phoneNumber: '+250788333444',
      });

      const res = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send(farmerRegistration('250 788 333 444'));

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('An account with this phone number already exists');
    });

    it('prevents a duplicate pending request', async () => {
      const facilitator = (email: string) => ({
        accountType: RoleCode.Facilitator,
        fullName: 'Niyonsaba Claudine',
        phoneNumber: '0788555666',
        email,
        password: DEFAULT_PASSWORD,
        location: { province: 'SOUTHERN', district: 'Huye' },
        facilitator: { professionalTitle: 'Agronomist', organization: 'Rwanda Agriculture Board' },
      });
      await ctx
        .http()
        .post(`${API}/auth/register`)
        .send(facilitator('first@rab.gov.rw'))
        .expect(201);

      const res = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send(facilitator('second@rab.gov.rw'));

      expect(res.status).toBe(409);
      expect(res.body.message).toBe(
        'An account request for this phone number is already pending approval',
      );
      await expect(ctx.prisma.accountRequest.count()).resolves.toBe(1);
    });

    it('rejects a duplicate email', async () => {
      await seedUser(ctx.prisma, { roles: [RoleCode.Facilitator], email: 'taken@example.rw' });

      const res = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({ ...farmerRegistration(), email: 'TAKEN@example.rw' });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('An account with this email address already exists');
    });
  });

  describe('POST /auth/login', () => {
    it('signs in with an email address and returns tokens without secrets', async () => {
      const user = await seedUser(ctx.prisma, {
        roles: [RoleCode.SmartphoneFarmer],
        email: 'jeanne@example.rw',
      });

      const res = await ctx
        .http()
        .post(`${API}/auth/login`)
        .set('User-Agent', 'integration-test')
        .send({ email: 'Jeanne@Example.RW', password: DEFAULT_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        tokenType: 'Bearer',
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        expiresIn: 900,
        user: { id: user.id, roles: [RoleCode.SmartphoneFarmer] },
      });
      expect(JSON.stringify(res.body.user)).not.toMatch(/password|failedLogin|locked/i);

      const stored = await ctx.prisma.refreshToken.findFirstOrThrow({ where: { userId: user.id } });
      expect(stored.tokenHash).not.toBe(res.body.refreshToken);
      expect(stored.userAgent).toBe('integration-test');

      const attempt = await ctx.prisma.loginAttempt.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(attempt.outcome).toBe(LoginAttemptOutcome.SUCCESS);
      expect(attempt.identifier).toBe('jeanne@example.rw');
    });

    it.each(['0788123450', '250788123450', '+250 788 123 450'])(
      'signs in with the phone number written as %s',
      async (written) => {
        const user = await seedUser(ctx.prisma, {
          roles: [RoleCode.SmartphoneFarmer],
          phoneNumber: '+250788123450',
          email: 'jeanne@example.rw',
        });
        const res = await ctx
          .http()
          .post(`${API}/auth/login`)
          .send({ identifier: written, password: DEFAULT_PASSWORD });
        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe(user.id);
        const attempt = await ctx.prisma.loginAttempt.findFirstOrThrow({
          where: { userId: user.id, outcome: LoginAttemptOutcome.SUCCESS },
        });
        expect(attempt.identifier).toBe('+250788123450');
      },
    );

    it('accepts the identifier field for email and requires one identifier', async () => {
      await seedUser(ctx.prisma, {
        roles: [RoleCode.SmartphoneFarmer],
        email: 'jeanne@example.rw',
      });
      await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ identifier: 'JEANNE@example.rw', password: DEFAULT_PASSWORD })
        .expect(200);
      await ctx.http().post(`${API}/auth/login`).send({ password: DEFAULT_PASSWORD }).expect(400);
      await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ identifier: '', password: DEFAULT_PASSWORD })
        .expect(400);
    });

    it('refuses an unverified smartphone farmer until the email is verified', async () => {
      const registered = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send(farmerRegistration('0788222333'))
        .expect(201);

      for (const identifier of [registered.body.user.email, '0788222333']) {
        const res = await ctx
          .http()
          .post(`${API}/auth/login`)
          .send({ identifier, password: DEFAULT_PASSWORD });
        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Email verification is required before login');
      }
      await expect(ctx.prisma.refreshToken.count()).resolves.toBe(0);

      await ctx
        .http()
        .post(`${API}/auth/verify-email`)
        .send(ctx.mail.latestVerification(registered.body.user.id))
        .expect(204);
      const res = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ identifier: '0788222333', password: DEFAULT_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.user.roles).toEqual([RoleCode.SmartphoneFarmer]);
    });

    it('returns the same 401 for a wrong password and an unknown account', async () => {
      const user = await seedUser(ctx.prisma, {
        roles: [RoleCode.SmartphoneFarmer],
        email: 'jeanne@example.rw',
      });

      const wrong = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: 'Wrong12345' });
      const unknown = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: 'missing@example.rw', password: 'Wrong12345' });

      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.message).toBe(unknown.body.message);

      const outcomes = (await ctx.prisma.loginAttempt.findMany()).map((a) => a.outcome).sort();
      expect(outcomes).toEqual([
        LoginAttemptOutcome.INVALID_PASSWORD,
        LoginAttemptOutcome.UNKNOWN_IDENTIFIER,
      ]);
    });

    it('rejects accounts without a password (e.g. basic-phone farmers)', async () => {
      const user = await seedUser(ctx.prisma, {
        roles: [RoleCode.BasicPhoneFarmer],
        password: null,
        email: 'basic@example.rw',
      });

      const res = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: 'Anything123' });

      expect(res.status).toBe(401);
    });

    it.each([UserStatus.PENDING, UserStatus.SUSPENDED, UserStatus.INACTIVE, UserStatus.REJECTED])(
      'forbids %s accounts after a correct password',
      async (status) => {
        const user = await seedUser(ctx.prisma, {
          roles: [RoleCode.SmartphoneFarmer],
          status,
          email: 'jeanne@example.rw',
        });

        const res = await ctx
          .http()
          .post(`${API}/auth/login`)
          .send({ email: user.email, password: DEFAULT_PASSWORD });

        expect(res.status).toBe(403);
        await expect(ctx.prisma.refreshToken.count()).resolves.toBe(0);
      },
    );

    it('locks the account after repeated failures, even for the correct password', async () => {
      const user = await seedUser(ctx.prisma, {
        roles: [RoleCode.SmartphoneFarmer],
        email: 'jeanne@example.rw',
      });
      for (let i = 0; i < 5; i += 1) {
        await ctx
          .http()
          .post(`${API}/auth/login`)
          .send({ email: user.email, password: 'Wrong12345' })
          .expect(401);
      }

      const res = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: DEFAULT_PASSWORD });

      expect(res.status).toBe(423);
      const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.SmartphoneFarmer] });
      const first = await login(ctx, user.phoneNumber);

      const res = await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: first.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.refreshToken).not.toBe(first.refreshToken);
      await ctx
        .http()
        .get(`${API}/auth/me`)
        .set(...bearer(res.body.accessToken))
        .expect(200);

      const tokens = await ctx.prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
      expect(tokens).toHaveLength(2);
      expect(tokens[0]).toMatchObject({
        revokedReason: TokenRevocationReason.ROTATED,
        replacedById: tokens[1].id,
      });
      expect(tokens[1].familyId).toBe(tokens[0].familyId);
    });

    it('detects reuse of a rotated token and revokes the whole session', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.SmartphoneFarmer] });
      const first = await login(ctx, user.phoneNumber);
      const second = await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: first.refreshToken });

      const reuse = await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: first.refreshToken });
      expect(reuse.status).toBe(401);
      expect(reuse.body.message).toMatch(/reuse/);

      const afterReuse = await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: second.body.refreshToken });
      expect(afterReuse.status).toBe(401);
    });

    it('rejects an expired refresh token', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.SmartphoneFarmer] });
      const { refreshToken } = await login(ctx, user.phoneNumber);
      await ctx.prisma.refreshToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await ctx.http().post(`${API}/auth/refresh`).send({ refreshToken });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Refresh token has expired');
    });

    it('rejects an unknown refresh token', async () => {
      const res = await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: 'not-a-real-token' });
      expect(res.status).toBe(401);
    });

    it('stops refreshing once the account is suspended', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.SmartphoneFarmer] });
      const { refreshToken } = await login(ctx, user.phoneNumber);
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { status: UserStatus.SUSPENDED },
      });

      const res = await ctx.http().post(`${API}/auth/refresh`).send({ refreshToken });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the session so its refresh token no longer works', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.SmartphoneFarmer] });
      const session = await login(ctx, user.phoneNumber);

      await ctx
        .http()
        .post(`${API}/auth/logout`)
        .set(...bearer(session.accessToken))
        .send({ refreshToken: session.refreshToken })
        .expect(204);

      const res = await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: session.refreshToken });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Refresh token has been revoked');
    });

    it('can end every session of the user', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.SmartphoneFarmer] });
      const phone = await login(ctx, user.phoneNumber);
      const laptop = await login(ctx, user.phoneNumber);

      await ctx
        .http()
        .post(`${API}/auth/logout`)
        .set(...bearer(phone.accessToken))
        .send({ allDevices: true })
        .expect(204);

      await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: laptop.refreshToken })
        .expect(401);
    });

    it("cannot revoke another user's session", async () => {
      const alice = await seedUser(ctx.prisma, { roles: [RoleCode.SmartphoneFarmer] });
      const bob = await seedUser(ctx.prisma, { roles: [RoleCode.SmartphoneFarmer] });
      const aliceSession = await login(ctx, alice.phoneNumber);
      const bobSession = await login(ctx, bob.phoneNumber);

      await ctx
        .http()
        .post(`${API}/auth/logout`)
        .set(...bearer(aliceSession.accessToken))
        .send({ refreshToken: bobSession.refreshToken })
        .expect(400);
      await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: bobSession.refreshToken })
        .expect(200);
    });

    it('requires authentication', async () => {
      await ctx.http().post(`${API}/auth/logout`).send({ allDevices: true }).expect(401);
    });
  });

  describe('POST /auth/change-password', () => {
    it('changes the password and ends existing sessions', async () => {
      const user = await seedUser(ctx.prisma, {
        roles: [RoleCode.SmartphoneFarmer],
        email: 'jeanne@example.rw',
      });
      const session = await login(ctx, user.email as string);

      await ctx
        .http()
        .post(`${API}/auth/change-password`)
        .set(...bearer(session.accessToken))
        .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'Ibihingwa2027' })
        .expect(204);

      await ctx
        .http()
        .get(`${API}/auth/me`)
        .set(...bearer(session.accessToken))
        .expect(401);
      await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: DEFAULT_PASSWORD })
        .expect(401);

      const fresh = await login(ctx, user.email as string, 'Ibihingwa2027');
      await ctx
        .http()
        .get(`${API}/auth/me`)
        .set(...bearer(fresh.accessToken))
        .expect(200);
    });

    it('rejects an incorrect current password', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.SmartphoneFarmer] });
      const session = await login(ctx, user.phoneNumber);

      const res = await ctx
        .http()
        .post(`${API}/auth/change-password`)
        .set(...bearer(session.accessToken))
        .send({ currentPassword: 'Wrong12345', newPassword: 'Ibihingwa2027' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Current password is incorrect');
    });

    it('enforces the password policy', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.SmartphoneFarmer] });
      const session = await login(ctx, user.phoneNumber);

      await ctx
        .http()
        .post(`${API}/auth/change-password`)
        .set(...bearer(session.accessToken))
        .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'short' })
        .expect(400);
    });
  });

  describe('password reset', () => {
    it('responds identically for unknown accounts and queues nothing', async () => {
      const res = await ctx
        .http()
        .post(`${API}/auth/forgot-password`)
        .send({ identifier: '0799999999' });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ message: expect.stringMatching(/If an active account matches/) });
      expect(notificationsQueue(ctx).add).not.toHaveBeenCalled();
    });

    it('emails the reset link even when the phone number is typed, and resets with the single-use token', async () => {
      const user = await seedUser(ctx.prisma, {
        roles: [RoleCode.SmartphoneFarmer],
        email: 'jeanne@example.rw',
      });
      const session = await login(ctx, user.phoneNumber);
      const second = await login(ctx, 'jeanne@example.rw');

      const forgot = await ctx
        .http()
        .post(`${API}/auth/forgot-password`)
        .send({ identifier: localFormat(user.phoneNumber) });
      expect(forgot.status).toBe(202);
      expect(forgot.body).not.toHaveProperty('resetToken');

      const queue = notificationsQueue(ctx);
      expect(queue.add).toHaveBeenCalledTimes(1);
      const [jobName, job] = queue.add.mock.calls[0];
      expect(jobName).toBe(PASSWORD_RESET_JOB);
      expect(job).toEqual({ deliveryId: expect.any(String) });
      expect(job).not.toHaveProperty('token');
      expect(job).not.toHaveProperty('destination');

      const store = ctx.app.get(PasswordResetDeliveryStoreService);
      const resolved = await store.resolveForWorker(job.deliveryId);
      expect(resolved).toMatchObject({
        userId: user.id,
        channel: 'email',
        destination: 'jeanne@example.rw',
        language: 'rw',
      });
      const resetToken = resolved!.resetToken;

      const stored = await ctx.prisma.passwordResetToken.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(stored.tokenHash).not.toBe(resetToken);

      await ctx
        .http()
        .post(`${API}/auth/reset-password`)
        .send({ token: resetToken, newPassword: 'Ibihingwa2027' })
        .expect(204);

      // Every existing session is revoked, and only the new password works.
      for (const old of [session, second]) {
        await ctx
          .http()
          .post(`${API}/auth/refresh`)
          .send({ refreshToken: old.refreshToken })
          .expect(401);
      }
      await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ identifier: user.phoneNumber, password: DEFAULT_PASSWORD })
        .expect(401);
      await login(ctx, user.phoneNumber, 'Ibihingwa2027');

      const reuse = await ctx
        .http()
        .post(`${API}/auth/reset-password`)
        .send({ token: resetToken, newPassword: 'Another2028' });
      expect(reuse.status).toBe(400);
    });

    it('lets a user without a password (created by an admin) set one', async () => {
      const user = await seedUser(ctx.prisma, {
        roles: [RoleCode.Facilitator],
        password: null,
        email: 'nopass@example.rw',
      });

      await ctx
        .http()
        .post(`${API}/auth/forgot-password`)
        .send({ identifier: 'nopass@example.rw' })
        .expect(202);
      const [, job] = notificationsQueue(ctx).add.mock.calls[0];
      const token = await resetTokenFromJob(ctx, job);

      await ctx
        .http()
        .post(`${API}/auth/reset-password`)
        .send({ token, newPassword: 'Ibihingwa2027' })
        .expect(204);
      await login(ctx, user.phoneNumber, 'Ibihingwa2027');
    });

    it('rejects expired reset tokens', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.SmartphoneFarmer] });
      await ctx
        .http()
        .post(`${API}/auth/forgot-password`)
        .send({ identifier: user.phoneNumber })
        .expect(202);
      const [, job] = notificationsQueue(ctx).add.mock.calls[0];
      const token = await resetTokenFromJob(ctx, job);
      await ctx.prisma.passwordResetToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await ctx
        .http()
        .post(`${API}/auth/reset-password`)
        .send({ token, newPassword: 'Ibihingwa2027' })
        .expect(400);
    });

    it('does not send reset tokens to pending accounts', async () => {
      const user = await seedUser(ctx.prisma, {
        roles: [RoleCode.SmartphoneFarmer],
        status: UserStatus.PENDING,
      });
      await ctx
        .http()
        .post(`${API}/auth/forgot-password`)
        .send({ identifier: user.phoneNumber })
        .expect(202);
      expect(notificationsQueue(ctx).add).not.toHaveBeenCalled();
    });
  });

  describe('GET /auth/me', () => {
    it('returns the current user with permissions', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.Facilitator] });
      const { accessToken } = await login(ctx, user.phoneNumber);

      const res = await ctx
        .http()
        .get(`${API}/auth/me`)
        .set(...bearer(accessToken));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: user.id, roles: [RoleCode.Facilitator] });
      expect(res.body.permissions).toEqual(
        expect.arrayContaining(['farmers:read', 'farmers:update', 'account-requests:create']),
      );
    });

    it('rejects missing and malformed tokens', async () => {
      await ctx.http().get(`${API}/auth/me`).expect(401);
      await ctx
        .http()
        .get(`${API}/auth/me`)
        .set(...bearer('not.a.jwt'))
        .expect(401);
    });

    it('immediately blocks a user who is suspended after signing in', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.SmartphoneFarmer] });
      const { accessToken } = await login(ctx, user.phoneNumber);
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { status: UserStatus.SUSPENDED },
      });

      const res = await ctx
        .http()
        .get(`${API}/auth/me`)
        .set(...bearer(accessToken));

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/suspended/i);
    });
  });
});

describe('Authentication rate limiting (integration)', () => {
  let ctx: TestContext;
  const original = process.env.AUTH_RATE_LIMIT_MAX;

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT_MAX = '3';
    ctx = await createTestContext();
  });

  afterAll(async () => {
    process.env.AUTH_RATE_LIMIT_MAX = original;
    await ctx.close();
  });

  it('returns 429 once the auth limit is exceeded, without affecting other routes', async () => {
    const attempt = () =>
      ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: 'nobody@example.rw', password: 'Wrong12345' });

    for (let i = 0; i < 3; i += 1) await attempt().expect(401);
    const limited = await attempt();

    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ statusCode: 429, path: `${API}/auth/login` });
    await ctx.http().get(`${API}/health/live`).expect(200);
  });
});
