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

describe('Facilitator farmer groups (integration)', () => {
  let ctx: TestContext;
  let admin: SeededUser & LoginResult;
  let facilitator: SeededUser & LoginResult;
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
    facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
    cropId = (await ctx.prisma.crop.findUniqueOrThrow({ where: { code: 'TOMATO' } })).id;
  });

  const body = (overrides: Record<string, unknown> = {}) => ({
    name: 'Kinigi tomato group',
    description: 'Weekly follow-up',
    cropId,
    location: {
      province: 'NORTHERN',
      district: 'Musanze',
      sector: 'Kinigi',
      cell: 'Cyuve',
      village: 'Rwebeya',
    },
    ...overrides,
  });

  async function createGroup(token = facilitator.accessToken) {
    const res = await ctx
      .http()
      .post(`${API}/facilitator/groups`)
      .set(...bearer(token))
      .send(body());
    expect(res.status).toBe(201);
    return res.body as {
      id: string;
      facilitator: { id: string };
      location: { district: string; village: string };
    };
  }

  it('creates a group for the authenticated facilitator and lets an administrator see it', async () => {
    const created = await createGroup();
    expect(created.facilitator.id).toBe(facilitator.id);
    expect(created.location).toMatchObject({ district: 'Musanze', village: 'Rwebeya' });

    const own = await ctx
      .http()
      .get(`${API}/facilitator/groups`)
      .set(...bearer(facilitator.accessToken));
    expect(own.body.data).toHaveLength(1);

    const all = await ctx
      .http()
      .get(`${API}/facilitator/groups`)
      .set(...bearer(admin.accessToken));
    expect(all.body.meta.total).toBe(1);

    const updated = await ctx
      .http()
      .patch(`${API}/facilitator/groups/${created.id}`)
      .set(...bearer(facilitator.accessToken))
      .send({ name: 'Kinigi potato and tomato group' });
    expect(updated.body.name).toBe('Kinigi potato and tomato group');
  });

  it('adds smartphone and basic-phone farmers, filters them, and removes one', async () => {
    const group = await createGroup();
    const smartphone = await seedUser(ctx.prisma, {
      roles: [RoleCode.SmartphoneFarmer],
      fullName: 'Uwimana Jeanne',
    });
    const basic = await seedUser(ctx.prisma, {
      roles: [RoleCode.BasicPhoneFarmer],
      fullName: 'Habimana Eric',
      phoneNumber: '+250722111222',
    });

    const added = await ctx
      .http()
      .post(`${API}/facilitator/groups/${group.id}/members`)
      .set(...bearer(facilitator.accessToken))
      .send({ userIds: [smartphone.id, basic.id] });

    expect(added.status).toBe(201);
    expect(added.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: smartphone.id, farmerType: 'SMARTPHONE', email: null }),
        expect.objectContaining({ userId: basic.id, farmerType: 'BASIC_PHONE' }),
      ]),
    );
    await expect(ctx.prisma.user.count()).resolves.toBe(4);
    // Each added member gets one in-app notification, including basic-phone farmers.
    const notices = await ctx.prisma.notification.findMany({
      where: { templateCode: 'GROUP_MEMBER_ADDED' },
      select: { userId: true, category: true },
    });
    expect(notices.map((notice) => notice.userId).sort()).toEqual([smartphone.id, basic.id].sort());
    expect(notices.every((notice) => notice.category === 'GROUP')).toBe(true);

    const filtered = await ctx
      .http()
      .get(`${API}/facilitator/groups/${group.id}/members?search=0722111222&farmerType=BASIC_PHONE`)
      .set(...bearer(facilitator.accessToken));
    expect(filtered.body.data.map((member: { fullName: string }) => member.fullName)).toEqual([
      'Habimana Eric',
    ]);

    await ctx
      .http()
      .delete(`${API}/facilitator/groups/${group.id}/members/${basic.id}`)
      .set(...bearer(facilitator.accessToken))
      .expect(204);
    const remaining = await ctx.prisma.facilitatorGroupMember.findMany({
      where: { groupId: group.id },
    });
    expect(remaining.map((member) => member.userId)).toEqual([smartphone.id]);
    await expect(ctx.prisma.user.findUnique({ where: { id: basic.id } })).resolves.toMatchObject({
      id: basic.id,
    });
  });

  it('rejects a duplicate membership', async () => {
    const group = await createGroup();
    const farmer = await seedUser(ctx.prisma, { roles: [RoleCode.SmartphoneFarmer] });
    const add = () =>
      ctx
        .http()
        .post(`${API}/facilitator/groups/${group.id}/members`)
        .set(...bearer(facilitator.accessToken))
        .send({ userIds: [farmer.id] });

    await add().expect(201);
    const duplicate = await add();
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toMatch(/already members/);
  });

  it('rejects unknown users, facilitators, administrators and inactive farmers', async () => {
    const group = await createGroup();
    const cases = [
      { userIds: ['00000000-0000-4000-8000-000000000000'] },
      { userIds: [facilitator.id] },
      { userIds: [admin.id] },
      {
        userIds: [
          (await seedUser(ctx.prisma, { roles: [RoleCode.Facilitator, RoleCode.SmartphoneFarmer] }))
            .id,
        ],
      },
      {
        userIds: [
          (
            await seedUser(ctx.prisma, {
              roles: [RoleCode.SmartphoneFarmer],
              status: 'PENDING' as const,
            })
          ).id,
        ],
      },
    ];
    for (const payload of cases) {
      const res = await ctx
        .http()
        .post(`${API}/facilitator/groups/${group.id}/members`)
        .set(...bearer(facilitator.accessToken))
        .send(payload);
      expect(res.status).toBe(400);
    }
    await expect(ctx.prisma.facilitatorGroupMember.count()).resolves.toBe(0);
  });

  it("hides another facilitator's group", async () => {
    const group = await createGroup();
    const other = await seedAndLogin(ctx, [RoleCode.Facilitator]);

    await ctx
      .http()
      .get(`${API}/facilitator/groups`)
      .set(...bearer(other.accessToken))
      .expect(200);
    const list = await ctx
      .http()
      .get(`${API}/facilitator/groups`)
      .set(...bearer(other.accessToken));
    expect(list.body.data).toHaveLength(0);

    const forbidden = await ctx
      .http()
      .get(`${API}/facilitator/groups/${group.id}`)
      .set(...bearer(other.accessToken));
    expect(forbidden.status).toBe(403);

    await ctx
      .http()
      .post(`${API}/facilitator/groups/${group.id}/members`)
      .set(...bearer(other.accessToken))
      .send({ userIds: [admin.id] })
      .expect(403);

    await ctx
      .http()
      .get(`${API}/facilitator/groups/${group.id}`)
      .set(...bearer(admin.accessToken))
      .expect(200);
  });

  it('forbids farmers from creating groups', async () => {
    const farmer = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
    await ctx
      .http()
      .post(`${API}/facilitator/groups`)
      .set(...bearer(farmer.accessToken))
      .send(body())
      .expect(403);
    await ctx.http().get(`${API}/facilitator/groups`).expect(401);
  });

  it('lets an administrator assign the group to a facilitator', async () => {
    const res = await ctx
      .http()
      .post(`${API}/facilitator/groups`)
      .set(...bearer(admin.accessToken))
      .send(body({ facilitatorId: facilitator.id }));
    expect(res.status).toBe(201);
    expect(res.body.facilitator.id).toBe(facilitator.id);

    await ctx
      .http()
      .post(`${API}/facilitator/groups`)
      .set(...bearer(admin.accessToken))
      .send(body())
      .expect(400);
  });
});
