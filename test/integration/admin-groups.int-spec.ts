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

describe('Administrator targeting groups (integration)', () => {
  let ctx: TestContext;
  let admin: SeededUser & LoginResult;
  let cropId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    admin = await seedAndLogin(ctx, [RoleCode.Admin]);
    cropId = (await ctx.prisma.crop.findUniqueOrThrow({ where: { code: 'TOMATO' } })).id;
  });

  const body = () => ({
    name: 'Musanze tomato growers',
    description: 'Smallholders in Musanze',
    cropId,
    targetAudience: 'ALL_FARMERS',
    location: { province: 'NORTHERN', district: 'musanze', sector: 'Muhoza' },
    estimatedFarmerCount: 1200,
  });

  it('creates, updates and lists a targeting group without any memberships', async () => {
    const before = await ctx.prisma.facilitatorGroupMember.count();

    const created = await ctx
      .http()
      .post(`${API}/admin/groups`)
      .set(...bearer(admin.accessToken))
      .send(body());

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Musanze tomato growers',
      crop: { code: 'TOMATO', nameRw: 'Inyanya' },
      province: 'NORTHERN',
      district: 'Musanze',
      sector: 'Muhoza',
      estimatedFarmerCount: 1200,
      status: 'ACTIVE',
      createdBy: { id: admin.id },
    });
    expect(created.body).not.toHaveProperty('members');
    await expect(ctx.prisma.facilitatorGroupMember.count()).resolves.toBe(before);

    const updated = await ctx
      .http()
      .patch(`${API}/admin/groups/${created.body.id}`)
      .set(...bearer(admin.accessToken))
      .send({
        estimatedFarmerCount: 1500,
        location: { province: 'NORTHERN', district: 'Musanze' },
      });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ estimatedFarmerCount: 1500, sector: null });

    const list = await ctx
      .http()
      .get(`${API}/admin/groups?search=tomato&province=NORTHERN`)
      .set(...bearer(admin.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.map((group: { id: string }) => group.id)).toEqual([created.body.id]);

    const deactivated = await ctx
      .http()
      .delete(`${API}/admin/groups/${created.body.id}`)
      .set(...bearer(admin.accessToken));
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.status).toBe('INACTIVE');
    await expect(ctx.prisma.adminTargetingGroup.count()).resolves.toBe(1);
  });

  it('rejects facilitators, farmers and anonymous callers', async () => {
    const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
    const farmer = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);

    await ctx.http().post(`${API}/admin/groups`).send(body()).expect(401);
    await ctx
      .http()
      .get(`${API}/admin/groups`)
      .set(...bearer(facilitator.accessToken))
      .expect(403);
    await ctx
      .http()
      .post(`${API}/admin/groups`)
      .set(...bearer(farmer.accessToken))
      .send(body())
      .expect(403);
  });

  it('validates the district and the crop', async () => {
    await ctx
      .http()
      .post(`${API}/admin/groups`)
      .set(...bearer(admin.accessToken))
      .send({ ...body(), location: { province: 'SOUTHERN', district: 'Musanze' } })
      .expect(400);

    await ctx
      .http()
      .post(`${API}/admin/groups`)
      .set(...bearer(admin.accessToken))
      .send({ ...body(), cropId: '00000000-0000-4000-8000-000000000000' })
      .expect(400);
  });
});
