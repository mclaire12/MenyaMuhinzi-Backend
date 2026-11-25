import { AccountRequestStatus, UserStatus } from '../../src/generated/prisma/client';
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
  seedAndLogin,
  type LoginResult,
  type SeededUser,
  type TestContext,
} from './helpers';

const farmerRequest = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Mukamana Alice',
  phoneNumber: localFormat(nextPhone()),
  farmerType: 'BASIC_PHONE',
  farmerCategory: 'COOPERATIVE_MEMBER',
  email: `alice.${Math.random().toString(36).slice(2, 10)}@example.rw`,
  location: {
    province: 'EASTERN',
    district: 'Nyagatare',
    sector: 'Karangazi',
    cell: 'Rwimiyaga',
    village: 'Rwisirabo',
  },
  notes: 'Registered during a field visit',
  ...overrides,
});

describe('Account approval workflow (integration)', () => {
  let ctx: TestContext;
  let admin: SeededUser & LoginResult;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    admin = await seedAndLogin(ctx, [RoleCode.Admin]);
    ctx.mail.clear();
  });

  /** Self-registers a facilitator, which always goes to the approval queue. */
  async function register(
    phoneNumber = localFormat(nextPhone()),
    email = `facilitator.${phoneNumber.replace(/\D/g, '')}@example.rw`,
  ): Promise<{ userId: string; requestId: string; email: string }> {
    const res = await ctx
      .http()
      .post(`${API}/auth/register`)
      .send({
        accountType: RoleCode.Facilitator,
        fullName: 'Niyonsaba Claudine',
        phoneNumber,
        email,
        password: DEFAULT_PASSWORD,
        location: { province: 'SOUTHERN', district: 'Huye' },
        facilitator: { professionalTitle: 'Agronomist', organization: 'Rwanda Agriculture Board' },
      })
      .expect(201);
    expect(res.body).toMatchObject({ requiresApproval: true, verificationEmailSent: false });
    return { userId: res.body.user.id, requestId: res.body.accountRequestId, email };
  }

  function signIn(identifier: string, password = DEFAULT_PASSWORD) {
    return ctx.http().post(`${API}/auth/login`).send({ identifier, password });
  }

  describe('POST /accounts/requests', () => {
    it('lets a facilitator submit a basic-phone farmer with a personal email but no password', async () => {
      const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);

      const res = await ctx
        .http()
        .post(`${API}/accounts/requests`)
        .set(...bearer(facilitator.accessToken))
        .send(farmerRequest({ email: 'Alice@Example.rw' }));

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: AccountRequestStatus.PENDING,
        requestedRole: RoleCode.BasicPhoneFarmer,
        notes: 'Registered during a field visit',
        submittedBy: { id: facilitator.id },
        decision: null,
        applicant: {
          status: UserStatus.PENDING,
          email: 'alice@example.rw',
          roles: [RoleCode.BasicPhoneFarmer],
          farmerProfile: { farmerType: 'BASIC_PHONE', farmerCategory: 'COOPERATIVE_MEMBER' },
          location: {
            province: 'EASTERN',
            district: 'Nyagatare',
            sector: 'Karangazi',
            cell: 'Rwimiyaga',
            village: 'Rwisirabo',
          },
        },
      });
      // Nothing is emailed before an administrator approves the request.
      expect(ctx.mail.sent).toHaveLength(0);

      const user = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: res.body.applicant.id },
      });
      expect(user.passwordHash).toBeNull();
      expect(user.createdById).toBe(facilitator.id);
    });

    it('requires a personal email for basic-phone farmers', async () => {
      const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
      const { email: _omit, ...withoutEmail } = farmerRequest();
      const res = await ctx
        .http()
        .post(`${API}/accounts/requests`)
        .set(...bearer(facilitator.accessToken))
        .send(withoutEmail);
      expect(res.status).toBe(400);
      expect(res.body.message).toEqual(expect.arrayContaining([expect.stringMatching(/^email/)]));
    });

    it('forbids farmers from submitting requests', async () => {
      const farmer = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
      await ctx
        .http()
        .post(`${API}/accounts/requests`)
        .set(...bearer(farmer.accessToken))
        .send(farmerRequest())
        .expect(403);
    });

    it('prevents duplicate pending requests for the same phone number', async () => {
      const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
      const phoneNumber = localFormat(nextPhone());
      await ctx
        .http()
        .post(`${API}/accounts/requests`)
        .set(...bearer(facilitator.accessToken))
        .send(farmerRequest({ phoneNumber }))
        .expect(201);

      const res = await ctx
        .http()
        .post(`${API}/accounts/requests`)
        .set(...bearer(admin.accessToken))
        .send(farmerRequest({ phoneNumber }));

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already pending/);
    });
  });

  describe('GET /accounts/requests', () => {
    it('lists pending requests oldest first and filters by role and status', async () => {
      const first = await register();
      const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
      await ctx
        .http()
        .post(`${API}/accounts/requests`)
        .set(...bearer(facilitator.accessToken))
        .send(farmerRequest())
        .expect(201);

      const pending = await ctx
        .http()
        .get(`${API}/accounts/requests`)
        .set(...bearer(admin.accessToken));
      expect(pending.status).toBe(200);
      expect(pending.body.meta.total).toBe(2);
      expect(pending.body.data[0].id).toBe(first.requestId);

      const basic = await ctx
        .http()
        .get(`${API}/accounts/requests?requestedRole=BASIC_PHONE_FARMER`)
        .set(...bearer(admin.accessToken));
      expect(basic.body.data).toHaveLength(1);
      const facilitators = await ctx
        .http()
        .get(`${API}/accounts/requests?requestedRole=FACILITATOR`)
        .set(...bearer(admin.accessToken));
      expect(facilitators.body.data).toHaveLength(1);

      const approved = await ctx
        .http()
        .get(`${API}/accounts/requests?status=APPROVED`)
        .set(...bearer(admin.accessToken));
      expect(approved.body.data).toHaveLength(0);
    });

    it('is restricted to administrators', async () => {
      const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
      await ctx
        .http()
        .get(`${API}/accounts/requests`)
        .set(...bearer(facilitator.accessToken))
        .expect(403);
    });
  });

  describe('approval', () => {
    it('approves a facilitator, then requires email verification before sign-in', async () => {
      const { userId, requestId, email } = await register();

      const pending = await signIn(email);
      expect(pending.status).toBe(403);
      expect(pending.body.message).toMatch(/awaiting administrator approval/);

      const res = await ctx
        .http()
        .post(`${API}/accounts/requests/${requestId}/approve`)
        .set(...bearer(admin.accessToken))
        .send({ note: 'Identity confirmed' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: AccountRequestStatus.APPROVED,
        emailSent: true,
        applicant: { id: userId, status: UserStatus.ACTIVE },
        decision: {
          decision: 'APPROVED',
          reason: 'Identity confirmed',
          decidedBy: { id: admin.id },
          decidedAt: expect.any(String),
        },
      });

      const approval = await ctx.prisma.accountApproval.findUniqueOrThrow({
        where: { accountRequestId: requestId },
      });
      expect(approval.decidedById).toBe(admin.id);
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.statusChangedById).toBe(admin.id);
      expect(user.emailVerifiedAt).toBeNull();

      // Approved but not yet verified: still refused.
      const unverified = await signIn(email);
      expect(unverified.status).toBe(403);
      expect(unverified.body.message).toBe('Email verification is required before login');

      const [mail] = ctx.mail.verificationsFor(userId);
      expect(mail).toMatchObject({ to: email, context: 'approval' });
      await ctx.http().post(`${API}/auth/verify-email`).send({ token: mail!.token, code: mail!.code }).expect(204);

      // Approved and verified: signs in with email or phone and gets facilitator access.
      const byEmail = await signIn(email);
      expect(byEmail.status).toBe(200);
      expect(byEmail.body.user.roles).toEqual([RoleCode.Facilitator]);
      await signIn(localFormat(user.phoneNumber)).expect(200);
    });

    it('reports when the verification email could not be delivered', async () => {
      const { requestId } = await register();
      ctx.mail.failNext = true;
      const res = await ctx
        .http()
        .post(`${API}/accounts/requests/${requestId}/approve`)
        .set(...bearer(admin.accessToken))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.emailSent).toBe(false);
    });

    it('lets an approved, password-less farmer set a password', async () => {
      const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
      const created = await ctx
        .http()
        .post(`${API}/accounts/requests`)
        .set(...bearer(facilitator.accessToken))
        .send(farmerRequest({ farmerType: 'SMARTPHONE' }))
        .expect(201);
      await ctx
        .http()
        .post(`${API}/accounts/requests/${created.body.id}/approve`)
        .set(...bearer(admin.accessToken))
        .expect(200);
      await ctx
        .http()
        .post(`${API}/auth/verify-email`)
        .send(ctx.mail.latestVerification(created.body.applicant.id))
        .expect(204);

      await ctx
        .http()
        .post(`${API}/auth/forgot-password`)
        .send({ identifier: created.body.applicant.phoneNumber })
        .expect(202);
      const [, job] = notificationsQueue(ctx).add.mock.calls.at(-1) as [
        string,
        { deliveryId: string },
      ];
      const token = await resetTokenFromJob(ctx, job);
      await ctx
        .http()
        .post(`${API}/auth/reset-password`)
        .send({ token, newPassword: 'Ibihingwa2027' })
        .expect(204);
      await login(ctx, created.body.applicant.phoneNumber, 'Ibihingwa2027');
    });

    it('rejects a facilitator with a reason, emails the outcome and blocks sign-in', async () => {
      const { userId, requestId, email } = await register();

      const res = await ctx
        .http()
        .post(`${API}/accounts/requests/${requestId}/reject`)
        .set(...bearer(admin.accessToken))
        .send({ reason: 'Phone number could not be verified' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: AccountRequestStatus.REJECTED,
        emailSent: true,
        applicant: {
          status: UserStatus.REJECTED,
          statusReason: 'Phone number could not be verified',
        },
        decision: {
          decision: 'REJECTED',
          reason: 'Phone number could not be verified',
          decidedBy: { id: admin.id },
        },
      });

      // The rejection is emailed with its reason; no verification link is ever issued.
      expect(ctx.mail.sent).toEqual([
        expect.objectContaining({
          kind: 'rejection',
          userId,
          to: email,
          reason: 'Phone number could not be verified',
        }),
      ]);
      await expect(ctx.prisma.emailVerificationToken.count({ where: { userId } })).resolves.toBe(0);

      const denied = await signIn(email);
      expect(denied.status).toBe(403);
      expect(denied.body.message).toMatch(/rejected/i);

      // Asking for a verification link does not help a rejected applicant.
      await ctx
        .http()
        .post(`${API}/auth/resend-verification`)
        .send({ identifier: email })
        .expect(202);
      expect(ctx.mail.verificationsFor(userId)).toHaveLength(0);
    });

    it('requires a rejection reason', async () => {
      const { requestId } = await register();
      await ctx
        .http()
        .post(`${API}/accounts/requests/${requestId}/reject`)
        .set(...bearer(admin.accessToken))
        .send({})
        .expect(400);
    });

    it('lets a rejected applicant apply again', async () => {
      const phoneNumber = localFormat(nextPhone());
      const { userId, requestId } = await register(phoneNumber);
      await ctx
        .http()
        .post(`${API}/accounts/requests/${requestId}/reject`)
        .set(...bearer(admin.accessToken))
        .send({ reason: 'Incomplete information' })
        .expect(200);

      const again = await register(phoneNumber, `again.${Date.now()}@example.rw`);

      expect(again.userId).toBe(userId);
      expect(again.requestId).not.toBe(requestId);
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.status).toBe(UserStatus.PENDING);
      await expect(ctx.prisma.accountRequest.count({ where: { userId } })).resolves.toBe(2);
    });

    it.each(['approve', 'reject'])(
      'refuses to %s a request that was already decided',
      async (action) => {
        const { requestId } = await register();
        await ctx
          .http()
          .post(`${API}/accounts/requests/${requestId}/approve`)
          .set(...bearer(admin.accessToken))
          .expect(200);

        const res = await ctx
          .http()
          .post(`${API}/accounts/requests/${requestId}/${action}`)
          .set(...bearer(admin.accessToken))
          .send(
            action === 'reject'
              ? { reason: 'Second decision attempt' }
              : { note: 'Second decision attempt' },
          );

        expect(res.status).toBe(409);
        expect(res.body.message).toBe('This account request has already been approved');
        await expect(ctx.prisma.accountApproval.count()).resolves.toBe(1);
      },
    );

    it('returns 404 for unknown requests', async () => {
      await ctx
        .http()
        .post(`${API}/accounts/requests/00000000-0000-4000-8000-000000000000/approve`)
        .set(...bearer(admin.accessToken))
        .expect(404);
    });

    it('forbids facilitators from deciding', async () => {
      const { requestId } = await register();
      const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);

      await ctx
        .http()
        .post(`${API}/accounts/requests/${requestId}/approve`)
        .set(...bearer(facilitator.accessToken))
        .expect(403);
      const request = await ctx.prisma.accountRequest.findUniqueOrThrow({
        where: { id: requestId },
      });
      expect(request.status).toBe(AccountRequestStatus.PENDING);
    });
  });
});
