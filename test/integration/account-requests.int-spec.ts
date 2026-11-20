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
  location: {
    province: 'EASTERN',
    district: 'Nyagatare',
    sector: 'Karangazi',
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
  });

  async function register(
    phoneNumber = localFormat(nextPhone()),
  ): Promise<{ userId: string; requestId: string }> {
    const res = await ctx
      .http()
      .post(`${API}/auth/register`)
      .send({
        accountType: RoleCode.SmartphoneFarmer,
        fullName: 'Uwimana Jeanne',
        phoneNumber,
        password: DEFAULT_PASSWORD,
        location: { province: 'NORTHERN', district: 'Musanze', sector: 'Muhoza' },
      })
      .expect(201);
    return { userId: res.body.user.id, requestId: res.body.accountRequestId };
  }

  describe('POST /accounts/requests', () => {
    it('lets a facilitator submit a basic-phone farmer without email or password', async () => {
      const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);

      const res = await ctx
        .http()
        .post(`${API}/accounts/requests`)
        .set(...bearer(facilitator.accessToken))
        .send(farmerRequest());

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: AccountRequestStatus.PENDING,
        requestedRole: RoleCode.BasicPhoneFarmer,
        notes: 'Registered during a field visit',
        submittedBy: { id: facilitator.id },
        decision: null,
        applicant: {
          status: UserStatus.PENDING,
          email: null,
          roles: [RoleCode.BasicPhoneFarmer],
          farmerProfile: { farmerType: 'BASIC_PHONE', farmerCategory: 'COOPERATIVE_MEMBER' },
          location: {
            province: 'EASTERN',
            district: 'Nyagatare',
            sector: 'Karangazi',
            village: 'Rwisirabo',
          },
        },
      });

      const user = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: res.body.applicant.id },
      });
      expect(user.passwordHash).toBeNull();
      expect(user.createdById).toBe(facilitator.id);
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
    it('approves a request, records the decision and activates the account', async () => {
      const { userId, requestId } = await register();

      const res = await ctx
        .http()
        .post(`${API}/accounts/requests/${requestId}/approve`)
        .set(...bearer(admin.accessToken))
        .send({ note: 'Identity confirmed' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: AccountRequestStatus.APPROVED,
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

      await login(ctx, user.phoneNumber);
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
        .post(`${API}/auth/forgot-password`)
        .send({ identifier: created.body.applicant.phoneNumber })
        .expect(202);
      const [, job] = notificationsQueue(ctx).add.mock.calls.at(-1) as [string, { token: string }];
      await ctx
        .http()
        .post(`${API}/auth/reset-password`)
        .send({ token: job.token, newPassword: 'Ibihingwa2027' })
        .expect(204);
      await login(ctx, created.body.applicant.phoneNumber, 'Ibihingwa2027');
    });

    it('rejects a request with a reason and blocks sign-in', async () => {
      const { userId, requestId } = await register();

      const res = await ctx
        .http()
        .post(`${API}/accounts/requests/${requestId}/reject`)
        .set(...bearer(admin.accessToken))
        .send({ reason: 'Phone number could not be verified' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: AccountRequestStatus.REJECTED,
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

      const user = await ctx.prisma.user.update({
        where: { id: userId },
        data: { email: 'jeanne@example.rw' },
      });
      const signIn = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: DEFAULT_PASSWORD });
      expect(signIn.status).toBe(403);
      expect(signIn.body.message).toMatch(/rejected/i);
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

      const again = await register(phoneNumber);

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
