import { RoleCode } from '../../src/modules/roles/rbac.constants';
import {
  API,
  bearer,
  createTestContext,
  resetDatabase,
  seedAndLogin,
  type LoginResult,
  type SeededUser,
  type TestContext,
} from './helpers';

describe('Admin audit logs (integration)', () => {
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

  const list = (token: string, query = '') =>
    ctx
      .http()
      .get(`${API}/admin/audit-logs${query}`)
      .set(...bearer(token));

  it('lists entries newest first with the actor and without details', async () => {
    await ctx.prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: 'course.publish',
        entityType: 'Course',
        entityId: 'c-1',
        details: { secret: 'never returned' },
        createdAt: new Date('2026-11-01T10:00:00.000Z'),
      },
    });
    await ctx.prisma.auditLog.create({
      data: { actorId: null, action: 'system.job', entityType: 'Job', createdAt: new Date('2026-11-02T10:00:00.000Z') },
    });

    const res = await list(admin.accessToken).expect(200);
    const rows = res.body.data.filter((row: { action: string }) => ['course.publish', 'system.job'].includes(row.action));
    expect(rows.map((row: { action: string }) => row.action)).toEqual(['system.job', 'course.publish']);
    expect(rows[1]).toEqual({
      id: expect.any(String),
      action: 'course.publish',
      entityType: 'Course',
      entityId: 'c-1',
      actor: { id: admin.id, fullName: expect.any(String) },
      createdAt: '2026-11-01T10:00:00.000Z',
    });
    expect(JSON.stringify(res.body)).not.toContain('never returned');
    expect(res.body.meta).toMatchObject({ page: 1, limit: 20 });
  });

  it('filters by action, entity type and date range', async () => {
    await ctx.prisma.auditLog.createMany({
      data: [
        { actorId: admin.id, action: 'course.publish', entityType: 'Course', createdAt: new Date('2026-11-01T10:00:00.000Z') },
        { actorId: admin.id, action: 'group.create', entityType: 'AdminTargetingGroup', createdAt: new Date('2026-11-05T10:00:00.000Z') },
      ],
    });
    const byAction = await list(admin.accessToken, '?action=group.create').expect(200);
    expect(byAction.body.data.map((row: { action: string }) => row.action)).toEqual(['group.create']);
    const byType = await list(admin.accessToken, '?entityType=Course').expect(200);
    expect(byType.body.data.every((row: { entityType: string }) => row.entityType === 'Course')).toBe(true);
    const byRange = await list(
      admin.accessToken,
      '?from=2026-11-04T00:00:00.000Z&to=2026-11-06T00:00:00.000Z',
    ).expect(200);
    expect(byRange.body.data.map((row: { action: string }) => row.action)).toEqual(['group.create']);
    await list(admin.accessToken, '?actorId=not-a-uuid').expect(400);
  });

  it('is limited to administrators', async () => {
    const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
    await ctx.http().get(`${API}/admin/audit-logs`).expect(401);
    await list(facilitator.accessToken).expect(403);
  });
});
