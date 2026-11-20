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

describe('Roles and permissions (integration)', () => {
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

  it('lists the seeded roles and permissions', async () => {
    const roles = await ctx
      .http()
      .get(`${API}/roles`)
      .set(...bearer(admin.accessToken))
      .expect(200);
    expect(roles.body.map((r: { code: string }) => r.code)).toEqual([
      RoleCode.Admin,
      RoleCode.BasicPhoneFarmer,
      RoleCode.Facilitator,
      RoleCode.SmartphoneFarmer,
    ]);
    const facilitator = roles.body.find((r: { code: string }) => r.code === RoleCode.Facilitator);
    expect(facilitator.permissions).toEqual([
      'account-requests:create',
      'ai-assistants:read',
      'ai-conversations:manage',
      'assessments:read',
      'assessments:review',
      'courses:read',
      'crops:read',
      'enrollments:read',
      'farmer-groups:manage',
      'farmer-groups:read',
      'farmers:read',
      'farmers:update',
      'group-courses:assign',
      'knowledge:read',
      'notifications:manage',
      'notifications:read',
      'progress:read',
    ]);

    const permissions = await ctx
      .http()
      .get(`${API}/roles/permissions`)
      .set(...bearer(admin.accessToken))
      .expect(200);
    expect(permissions.body).toHaveLength(56);
  });

  it('changes role permissions with immediate effect', async () => {
    const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
    await ctx
      .http()
      .get(`${API}/farmers`)
      .set(...bearer(facilitator.accessToken))
      .expect(200);

    const res = await ctx
      .http()
      .put(`${API}/roles/${RoleCode.Facilitator}/permissions`)
      .set(...bearer(admin.accessToken))
      .send({ permissions: ['account-requests:create'] });

    expect(res.status).toBe(200);
    expect(res.body.permissions).toEqual(['account-requests:create']);
    await ctx
      .http()
      .get(`${API}/farmers`)
      .set(...bearer(facilitator.accessToken))
      .expect(403);
  });

  it('keeps the ADMIN role immutable', async () => {
    await ctx
      .http()
      .put(`${API}/roles/${RoleCode.Admin}/permissions`)
      .set(...bearer(admin.accessToken))
      .send({ permissions: [] })
      .expect(409);
  });

  it('validates permission codes and role codes', async () => {
    await ctx
      .http()
      .put(`${API}/roles/${RoleCode.Facilitator}/permissions`)
      .set(...bearer(admin.accessToken))
      .send({ permissions: ['everything'] })
      .expect(400);
    await ctx
      .http()
      .put(`${API}/roles/UNKNOWN/permissions`)
      .set(...bearer(admin.accessToken))
      .send({ permissions: [] })
      .expect(404);
  });

  it('forbids non-administrators', async () => {
    const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
    await ctx
      .http()
      .get(`${API}/roles`)
      .set(...bearer(facilitator.accessToken))
      .expect(403);
    await ctx
      .http()
      .put(`${API}/roles/${RoleCode.Facilitator}/permissions`)
      .set(...bearer(facilitator.accessToken))
      .send({ permissions: ['users:assign-roles'] })
      .expect(403);
  });
});
