import { RoleCode } from '../../src/modules/roles/rbac.constants';
import {
  API,
  bearer,
  createTestContext,
  resetDatabase,
  seedAndLogin,
  seedUser,
  type LoginResult,
  type SeededUser,
  type TestContext,
} from './helpers';

describe('Reports and analytics (integration)', () => {
  let ctx: TestContext;
  let admin: SeededUser & LoginResult;
  let facilitator: SeededUser & LoginResult;
  let farmer: SeededUser & LoginResult;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    admin = await seedAndLogin(ctx, [RoleCode.Admin]);
    facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
    farmer = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
  });

  const get = (path: string, token: string, query = '') =>
    ctx
      .http()
      .get(`${API}${path}${query}`)
      .set(...bearer(token));

  describe('authorization', () => {
    it('requires authentication and blocks cross-role access', async () => {
      await ctx.http().get(`${API}/admin/reports/dashboard`).expect(401);
      await get('/admin/reports/dashboard', farmer.accessToken).expect(403);
      await get('/admin/reports/dashboard', facilitator.accessToken).expect(403);
      await get('/facilitator/reports/dashboard', farmer.accessToken).expect(403);
      await get('/farmer/reports/dashboard', facilitator.accessToken).expect(403);
    });

    it('rejects inverted date ranges and invalid enums', async () => {
      await get(
        '/admin/reports/dashboard',
        admin.accessToken,
        '?startDate=2026-02-01T00:00:00.000Z&endDate=2026-01-01T00:00:00.000Z',
      ).expect(400);
      await get('/admin/reports/learning', admin.accessToken, '?channel=TELEGRAM').expect(400);
      await get('/admin/reports/registrations', admin.accessToken, '?province=MARS').expect(400);
    });
  });

  describe('admin reports', () => {
    it('returns an institutional dashboard from empty and seeded data', async () => {
      const empty = await get('/admin/reports/dashboard', admin.accessToken).expect(200);
      expect(empty.body.users.total).toBeGreaterThanOrEqual(3);
      expect(empty.body.dateRange.startInclusive).toBe(true);
      expect(empty.body.dateRange.endExclusive).toBe(true);
      expect(empty.body.notifications.note).toMatch(/DELIVERED/);

      await ctx.prisma.user.update({
        where: { id: farmer.id },
        data: { createdAt: new Date('2026-01-15T12:00:00.000Z') },
      });
      const filtered = await get(
        '/admin/reports/dashboard',
        admin.accessToken,
        '?startDate=2026-01-01T00:00:00.000Z&endDate=2026-02-01T00:00:00.000Z',
      ).expect(200);
      expect(filtered.body.users.total).toBeGreaterThanOrEqual(1);
    });

    it('aggregates users and registrations without contact details', async () => {
      const users = await get('/admin/reports/users', admin.accessToken).expect(200);
      expect(users.body.byStatus.length).toBeGreaterThan(0);
      expect(JSON.stringify(users.body)).not.toMatch(/@|phoneNumber|\+250/);

      const registrations = await get('/admin/reports/registrations', admin.accessToken).expect(
        200,
      );
      expect(registrations.body).toEqual(
        expect.objectContaining({
          byFarmerType: expect.any(Array),
          registrationsOverTime: expect.any(Array),
          pendingAccountRequests: expect.any(Number),
        }),
      );
    });

    it('exports registration CSV without formulas or secrets', async () => {
      const csvFarmer = await seedUser(ctx.prisma, {
        roles: [RoleCode.SmartphoneFarmer],
        email: 'csv-farmer@example.rw',
      });
      await ctx.prisma.userLocation.create({
        data: {
          userId: csvFarmer.id,
          province: 'NORTHERN',
          district: '=CMD',
          sector: 'Muhoza',
        },
      });
      await ctx.prisma.farmerProfile.create({
        data: {
          userId: csvFarmer.id,
          farmerType: 'SMARTPHONE',
          farmerCategory: 'SMALLHOLDER',
        },
      });
      const res = await get(
        '/admin/reports/registrations',
        admin.accessToken,
        '?format=csv',
      ).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/registrations-report\.csv/);
      expect(res.text).toContain('userId,status,createdAt');
      expect(res.text).toContain("'=CMD");
      expect(res.text).not.toMatch(/csv-farmer@example\.rw|\+250/);
    });

    it('covers learning, assessments, ai, knowledge, notifications and system', async () => {
      for (const path of [
        '/admin/reports/learning',
        '/admin/reports/courses',
        '/admin/reports/assessments',
        '/admin/reports/facilitators',
        '/admin/reports/groups',
        '/admin/reports/ai',
        '/admin/reports/knowledge',
        '/admin/reports/notifications',
        '/admin/reports/system',
      ]) {
        const res = await get(path, admin.accessToken).expect(200);
        expect(res.body).toBeDefined();
      }
      expect(
        (await get('/admin/reports/learning', admin.accessToken)).body.learners.definition,
      ).toMatch(/Active =/);
      expect((await get('/admin/reports/ai', admin.accessToken)).body.usage.note).toMatch(
        /NOT_AVAILABLE/,
      );
      expect(
        (await get('/admin/reports/system', admin.accessToken)).body.queueSnapshots.source,
      ).toBe('database');
    });
  });

  describe('facilitator and farmer scope', () => {
    it('limits facilitator reports to own groups', async () => {
      const crop = await ctx.prisma.crop.findFirstOrThrow({ select: { id: true } });
      const own = await ctx.prisma.facilitatorGroup.create({
        data: {
          name: 'Own group',
          facilitatorId: facilitator.id,
          createdById: facilitator.id,
          cropId: crop.id,
          province: 'NORTHERN',
          district: 'Musanze',
          sector: 'Muhoza',
        },
      });
      await ctx.prisma.facilitatorGroupMember.create({
        data: { groupId: own.id, userId: farmer.id, addedById: facilitator.id },
      });

      const otherFacilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
      const other = await ctx.prisma.facilitatorGroup.create({
        data: {
          name: 'Other group',
          facilitatorId: otherFacilitator.id,
          createdById: otherFacilitator.id,
          cropId: crop.id,
          province: 'SOUTHERN',
          district: 'Huye',
          sector: 'Tumba',
        },
      });

      const dashboard = await get('/facilitator/reports/dashboard', facilitator.accessToken).expect(
        200,
      );
      expect(dashboard.body.farmersInScope).toBe(1);
      expect(dashboard.body.groups.map((g: { id: string }) => g.id)).toEqual([own.id]);

      await get(`/facilitator/reports/groups?groupId=${other.id}`, facilitator.accessToken).expect(
        404,
      );

      const learning = await get('/facilitator/reports/learning', facilitator.accessToken).expect(
        200,
      );
      expect(learning.body.farmersInScope).toBe(1);
      await get('/facilitator/reports/assessments', facilitator.accessToken).expect(200);
    });

    it('returns only the farmer’s own progress', async () => {
      const other = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
      const mine = await get('/farmer/reports/dashboard', farmer.accessToken).expect(200);
      const theirs = await get('/farmer/reports/dashboard', other.accessToken).expect(200);
      expect(mine.body).toEqual(
        expect.objectContaining({
          enrollmentsByStatus: expect.any(Array),
          unreadNotifications: expect.any(Number),
        }),
      );
      expect(theirs.body.unreadNotifications).toBe(0);

      const progress = await get('/farmer/reports/progress', farmer.accessToken).expect(200);
      expect(progress.body.enrollments).toEqual([]);
      expect(JSON.stringify(progress.body)).not.toMatch(other.id);
    });
  });
});
