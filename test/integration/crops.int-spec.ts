import { INITIAL_CROPS } from '../../prisma/seed-crops';
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

describe('Crops (integration)', () => {
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

  it('seeds tomatoes, cabbages and carrots', async () => {
    const res = await ctx
      .http()
      .get(`${API}/crops`)
      .set(...bearer(admin.accessToken));

    expect(res.status).toBe(200);
    expect(
      res.body.map((crop: { code: string; nameEn: string; nameRw: string }) => ({
        code: crop.code,
        nameEn: crop.nameEn,
        nameRw: crop.nameRw,
      })),
    ).toEqual(
      [...INITIAL_CROPS]
        .map(({ code, nameEn, nameRw }) => ({ code, nameEn, nameRw }))
        .sort((a, b) => a.nameEn.localeCompare(b.nameEn)),
    );
  });

  it('lets an administrator create, update and deactivate a crop', async () => {
    const created = await ctx
      .http()
      .post(`${API}/crops`)
      .set(...bearer(admin.accessToken))
      .send({
        code: 'ONION',
        nameEn: 'Onions',
        nameRw: 'Ibitunguru',
        description: 'Onion production.',
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: 'ONION', status: 'ACTIVE' });

    const updated = await ctx
      .http()
      .patch(`${API}/crops/${created.body.id}`)
      .set(...bearer(admin.accessToken))
      .send({ description: 'Onion production, from nursery to curing.' });
    expect(updated.body.description).toMatch(/curing/);

    const deactivated = await ctx
      .http()
      .delete(`${API}/crops/${created.body.id}`)
      .set(...bearer(admin.accessToken));
    expect(deactivated.body.status).toBe('INACTIVE');

    const active = await ctx
      .http()
      .get(`${API}/crops?status=ACTIVE`)
      .set(...bearer(admin.accessToken));
    expect(active.body.map((crop: { code: string }) => crop.code)).not.toContain('ONION');
  });

  it('rejects a duplicate name and forbids facilitators from managing crops', async () => {
    await ctx
      .http()
      .post(`${API}/crops`)
      .set(...bearer(admin.accessToken))
      .send({ code: 'TOMATO_2', nameEn: 'Tomatoes', nameRw: 'Inyanya zindi' })
      .expect(409);

    const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
    await ctx
      .http()
      .get(`${API}/crops`)
      .set(...bearer(facilitator.accessToken))
      .expect(200);
    await ctx
      .http()
      .post(`${API}/crops`)
      .set(...bearer(facilitator.accessToken))
      .send({ code: 'ONION', nameEn: 'Onions', nameRw: 'Ibitunguru' })
      .expect(403);
  });
});
