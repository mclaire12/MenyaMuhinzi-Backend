import { TokenRevocationReason, UserStatus } from '../../src/generated/prisma/client';
import { RoleCode } from '../../src/modules/roles/rbac.constants';
import {
  API,
  bearer,
  createTestContext,
  DEFAULT_PASSWORD,
  login,
  nextPhone,
  resetDatabase,
  seedAndLogin,
  seedUser,
  type SeededUser,
  type TestContext,
  type LoginResult,
} from './helpers';

describe('User management (integration)', () => {
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

  describe('authorization', () => {
    it('requires authentication', async () => {
      const res = await ctx.http().get(`${API}/users`);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Authentication required');
    });

    it.each([RoleCode.Facilitator, RoleCode.SmartphoneFarmer, RoleCode.BasicPhoneFarmer])(
      'forbids %s users',
      async (role) => {
        const user = await seedAndLogin(ctx, [role]);
        await ctx
          .http()
          .get(`${API}/users`)
          .set(...bearer(user.accessToken))
          .expect(403);
        await ctx
          .http()
          .post(`${API}/users`)
          .set(...bearer(user.accessToken))
          .send({ fullName: 'X', phoneNumber: nextPhone(), roles: [RoleCode.Admin] })
          .expect(403);
      },
    );

    it('stops an admin who lost a permission, without a new sign-in', async () => {
      await ctx
        .http()
        .get(`${API}/users`)
        .set(...bearer(admin.accessToken))
        .expect(200);
      await ctx.prisma.rolePermission.deleteMany({
        where: { role: { code: RoleCode.Admin }, permission: { code: 'users:read' } },
      });

      const res = await ctx
        .http()
        .get(`${API}/users`)
        .set(...bearer(admin.accessToken));

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You do not have permission to perform this action');
    });
  });

  describe('GET /users', () => {
    it('paginates, filters and searches without exposing credentials', async () => {
      await seedUser(ctx.prisma, { roles: [RoleCode.Facilitator], fullName: 'Niyonsaba Claudine' });
      await seedUser(ctx.prisma, {
        roles: [RoleCode.SmartphoneFarmer],
        fullName: 'Uwimana Jeanne',
      });
      await seedUser(ctx.prisma, {
        roles: [RoleCode.BasicPhoneFarmer],
        fullName: 'Habimana Eric',
        phoneNumber: '+250722987654',
        status: UserStatus.SUSPENDED,
      });

      const page = await ctx
        .http()
        .get(`${API}/users?page=1&limit=2`)
        .set(...bearer(admin.accessToken))
        .expect(200);
      expect(page.body.data).toHaveLength(2);
      expect(page.body.meta).toEqual({ page: 1, limit: 2, total: 4, totalPages: 2 });
      expect(JSON.stringify(page.body)).not.toMatch(/passwordHash|tokenHash|failedLoginAttempts/);

      const byRole = await ctx
        .http()
        .get(`${API}/users?role=FACILITATOR`)
        .set(...bearer(admin.accessToken));
      expect(byRole.body.data.map((u: { fullName: string }) => u.fullName)).toEqual([
        'Niyonsaba Claudine',
      ]);

      const byStatus = await ctx
        .http()
        .get(`${API}/users?status=SUSPENDED`)
        .set(...bearer(admin.accessToken));
      expect(byStatus.body.meta.total).toBe(1);

      const byName = await ctx
        .http()
        .get(`${API}/users?search=uwiMANA`)
        .set(...bearer(admin.accessToken));
      expect(byName.body.data).toHaveLength(1);

      const byLocalPhone = await ctx
        .http()
        .get(`${API}/users?search=0722987654`)
        .set(...bearer(admin.accessToken));
      expect(byLocalPhone.body.data.map((u: { fullName: string }) => u.fullName)).toEqual([
        'Habimana Eric',
      ]);
    });

    it('validates query parameters', async () => {
      await ctx
        .http()
        .get(`${API}/users?limit=1000`)
        .set(...bearer(admin.accessToken))
        .expect(400);
      await ctx
        .http()
        .get(`${API}/users?role=SUPERUSER`)
        .set(...bearer(admin.accessToken))
        .expect(400);
    });
  });

  describe('GET /users/:id', () => {
    it('returns details and 404 for unknown users', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.Facilitator] });

      const res = await ctx
        .http()
        .get(`${API}/users/${user.id}`)
        .set(...bearer(admin.accessToken));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: user.id,
        roles: [RoleCode.Facilitator],
        location: null,
      });

      await ctx
        .http()
        .get(`${API}/users/00000000-0000-4000-8000-000000000000`)
        .set(...bearer(admin.accessToken))
        .expect(404);
      await ctx
        .http()
        .get(`${API}/users/not-a-uuid`)
        .set(...bearer(admin.accessToken))
        .expect(400);
    });
  });

  describe('POST /users', () => {
    it('creates an active user who can sign in', async () => {
      const res = await ctx
        .http()
        .post(`${API}/users`)
        .set(...bearer(admin.accessToken))
        .send({
          fullName: 'Second Admin',
          phoneNumber: '0788999000',
          email: 'second@menyamuhinzi.rw',
          password: DEFAULT_PASSWORD,
          roles: [RoleCode.Admin],
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: UserStatus.ACTIVE, roles: [RoleCode.Admin] });
      await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ identifier: 'second@menyamuhinzi.rw', password: DEFAULT_PASSWORD })
        .expect(403);
      await ctx
        .http()
        .post(`${API}/auth/verify-email`)
        .send(ctx.mail.latestVerification(res.body.id))
        .expect(204);
      await login(ctx, 'second@menyamuhinzi.rw');
    });

    it('rejects incompatible farmer roles and duplicates', async () => {
      await ctx
        .http()
        .post(`${API}/users`)
        .set(...bearer(admin.accessToken))
        .send({
          fullName: 'Both',
          phoneNumber: nextPhone(),
          email: 'both@example.rw',
          roles: [RoleCode.SmartphoneFarmer, RoleCode.BasicPhoneFarmer],
        })
        .expect(400);

      await ctx
        .http()
        .post(`${API}/users`)
        .set(...bearer(admin.accessToken))
        .send({
          fullName: 'Dup',
          phoneNumber: admin.phoneNumber,
          email: 'dup@example.rw',
          roles: [RoleCode.Facilitator],
        })
        .expect(409);
      await ctx
        .http()
        .post(`${API}/users`)
        .set(...bearer(admin.accessToken))
        .send({ fullName: 'No Email', phoneNumber: nextPhone(), roles: [RoleCode.Facilitator] })
        .expect(400);
    });
  });

  describe('PATCH /users/:id', () => {
    it('updates details, refuses to remove the email and re-verifies a changed email', async () => {
      const user = await seedUser(ctx.prisma, {
        roles: [RoleCode.Facilitator],
        email: 'old@example.rw',
      });

      await ctx
        .http()
        .patch(`${API}/users/${user.id}`)
        .set(...bearer(admin.accessToken))
        .send({ email: null })
        .expect(400);

      const res = await ctx
        .http()
        .patch(`${API}/users/${user.id}`)
        .set(...bearer(admin.accessToken))
        .send({ fullName: 'Renamed User', preferredLanguage: 'en', email: 'New@Example.rw' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        fullName: 'Renamed User',
        preferredLanguage: 'en',
        email: 'new@example.rw',
      });
      const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.emailVerifiedAt).toBeNull();
      expect(ctx.mail.verificationsFor(user.id)).toEqual([
        expect.objectContaining({ to: 'new@example.rw' }),
      ]);
    });

    it('rejects a phone number that belongs to someone else', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.Facilitator] });

      const res = await ctx
        .http()
        .patch(`${API}/users/${user.id}`)
        .set(...bearer(admin.accessToken))
        .send({ phoneNumber: admin.phoneNumber });

      expect(res.status).toBe(409);
    });
  });

  describe('PATCH /users/:id/status', () => {
    it('suspends a user, ends their sessions, and reactivates them', async () => {
      const farmer = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);

      const suspended = await ctx
        .http()
        .patch(`${API}/users/${farmer.id}/status`)
        .set(...bearer(admin.accessToken))
        .send({ status: UserStatus.SUSPENDED, reason: 'Repeated misleading advice' });
      expect(suspended.status).toBe(200);
      expect(suspended.body).toMatchObject({
        status: UserStatus.SUSPENDED,
        statusReason: 'Repeated misleading advice',
      });

      await ctx
        .http()
        .get(`${API}/auth/me`)
        .set(...bearer(farmer.accessToken))
        .expect(403);
      await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: farmer.refreshToken })
        .expect(401);
      const tokens = await ctx.prisma.refreshToken.findMany({ where: { userId: farmer.id } });
      expect(tokens.every((t) => t.revokedReason === TokenRevocationReason.ACCOUNT_DISABLED)).toBe(
        true,
      );
      await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: farmer.email, password: DEFAULT_PASSWORD })
        .expect(403);

      const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { id: farmer.id } });
      expect(stored.statusChangedById).toBe(admin.id);

      const reactivated = await ctx
        .http()
        .patch(`${API}/users/${farmer.id}/status`)
        .set(...bearer(admin.accessToken))
        .send({ status: UserStatus.ACTIVE });
      expect(reactivated.status).toBe(200);
      expect(reactivated.body).toMatchObject({ status: UserStatus.ACTIVE, statusReason: null });
      await login(ctx, farmer.phoneNumber);
    });

    it('deactivates and activates accounts', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.Facilitator] });

      await ctx
        .http()
        .patch(`${API}/users/${user.id}/status`)
        .set(...bearer(admin.accessToken))
        .send({ status: UserStatus.INACTIVE })
        .expect(200);
      await ctx
        .http()
        .patch(`${API}/users/${user.id}/status`)
        .set(...bearer(admin.accessToken))
        .send({ status: UserStatus.ACTIVE })
        .expect(200);
    });

    it('requires a reason to suspend', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.Facilitator] });
      await ctx
        .http()
        .patch(`${API}/users/${user.id}/status`)
        .set(...bearer(admin.accessToken))
        .send({ status: UserStatus.SUSPENDED })
        .expect(400);
    });

    it('rejects invalid transitions', async () => {
      const pending = await seedUser(ctx.prisma, {
        roles: [RoleCode.Facilitator],
        status: UserStatus.PENDING,
      });
      const active = await seedUser(ctx.prisma, { roles: [RoleCode.Facilitator] });

      const fromPending = await ctx
        .http()
        .patch(`${API}/users/${pending.id}/status`)
        .set(...bearer(admin.accessToken))
        .send({ status: UserStatus.ACTIVE });
      expect(fromPending.status).toBe(409);

      await ctx
        .http()
        .patch(`${API}/users/${active.id}/status`)
        .set(...bearer(admin.accessToken))
        .send({ status: UserStatus.ACTIVE })
        .expect(409);
      await ctx
        .http()
        .patch(`${API}/users/${active.id}/status`)
        .set(...bearer(admin.accessToken))
        .send({ status: UserStatus.PENDING })
        .expect(400);
    });

    it('prevents administrators from changing their own status', async () => {
      await ctx
        .http()
        .patch(`${API}/users/${admin.id}/status`)
        .set(...bearer(admin.accessToken))
        .send({ status: UserStatus.INACTIVE })
        .expect(403);
    });
  });

  describe('PATCH /users/:id/roles', () => {
    it('replaces roles and applies the new permissions immediately', async () => {
      const user = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
      await ctx
        .http()
        .get(`${API}/farmers`)
        .set(...bearer(user.accessToken))
        .expect(403);

      const res = await ctx
        .http()
        .patch(`${API}/users/${user.id}/roles`)
        .set(...bearer(admin.accessToken))
        .send({ roles: [RoleCode.Facilitator, RoleCode.SmartphoneFarmer] });

      expect(res.status).toBe(200);
      expect(res.body.roles.sort()).toEqual(
        [RoleCode.Facilitator, RoleCode.SmartphoneFarmer].sort(),
      );
      await ctx
        .http()
        .get(`${API}/farmers`)
        .set(...bearer(user.accessToken))
        .expect(200);

      const assignment = await ctx.prisma.userRole.findFirstOrThrow({ where: { userId: user.id } });
      expect(assignment.assignedById).toBe(admin.id);
    });

    it('prevents administrators from changing their own roles', async () => {
      const res = await ctx
        .http()
        .patch(`${API}/users/${admin.id}/roles`)
        .set(...bearer(admin.accessToken))
        .send({ roles: [RoleCode.Facilitator] });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You cannot change your own roles');
    });

    it('prevents non-administrators from assigning roles, including to themselves', async () => {
      const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);

      await ctx
        .http()
        .patch(`${API}/users/${facilitator.id}/roles`)
        .set(...bearer(facilitator.accessToken))
        .send({ roles: [RoleCode.Admin] })
        .expect(403);

      const roles = await ctx.prisma.userRole.findMany({
        where: { userId: facilitator.id },
        include: { role: true },
      });
      expect(roles.map((r) => r.role.code)).toEqual([RoleCode.Facilitator]);
    });

    it('rejects empty and unknown roles', async () => {
      const user = await seedUser(ctx.prisma, { roles: [RoleCode.Facilitator] });
      for (const roles of [[], ['SUPERUSER']]) {
        await ctx
          .http()
          .patch(`${API}/users/${user.id}/roles`)
          .set(...bearer(admin.accessToken))
          .send({ roles })
          .expect(400);
      }
    });
  });
});
