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

describe('Platform settings (integration)', () => {
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

  const get = (token: string) => ctx.http().get(`${API}/settings`).set(...bearer(token));
  const patch = (token: string, body: object) =>
    ctx.http().patch(`${API}/settings`).set(...bearer(token)).send(body);

  it('returns defaults before anything is saved', async () => {
    const res = await get(admin.accessToken).expect(200);
    expect(res.body).toEqual({
      platform: { name: 'MenyaMuhinzi', tagline: expect.any(String), supportEmail: '', supportPhone: '' },
      defaultLanguage: 'rw',
      defaultPublicationScope: 'PLATFORM',
      adminNotifications: { accountRequests: true, aiFailures: true, coursePublished: false, weeklySummary: false },
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('saves only the sections sent, records who changed them and audits the change', async () => {
    await patch(admin.accessToken, {
      platform: { name: 'MenyaMuhinzi Rwanda', tagline: 'Iga', supportEmail: 'help@menyamuhinzi.rw', supportPhone: '0788123456' },
    }).expect(200);
    const res = await patch(admin.accessToken, { defaultPublicationScope: 'TARGETED' }).expect(200);

    expect(res.body.platform).toEqual({
      name: 'MenyaMuhinzi Rwanda',
      tagline: 'Iga',
      supportEmail: 'help@menyamuhinzi.rw',
      supportPhone: expect.stringMatching(/788123456$/),
    });
    expect(res.body.defaultPublicationScope).toBe('TARGETED');
    expect(res.body.defaultLanguage).toBe('rw');
    expect(res.body.updatedBy).toEqual(expect.any(String));
    await expect(
      ctx.prisma.auditLog.count({ where: { action: 'platform-settings.update', actorId: admin.id } }),
    ).resolves.toBe(2);

    const reread = await get(admin.accessToken).expect(200);
    expect(reread.body.platform.name).toBe('MenyaMuhinzi Rwanda');
  });

  it('allows clearing the support contacts but rejects invalid values and unknown fields', async () => {
    await patch(admin.accessToken, {
      platform: { name: 'MenyaMuhinzi', tagline: '', supportEmail: '', supportPhone: '' },
    }).expect(200);
    await patch(admin.accessToken, {
      platform: { name: 'MenyaMuhinzi', tagline: '', supportEmail: 'not-an-email', supportPhone: '' },
    }).expect(400);
    await patch(admin.accessToken, { defaultLanguage: 'fr' }).expect(400);
    await patch(admin.accessToken, { defaultPublicationScope: 'EVERYONE' }).expect(400);
    await patch(admin.accessToken, { apiKey: 'x' }).expect(400);
  });

  it('is limited to administrators', async () => {
    const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
    await ctx.http().get(`${API}/settings`).expect(401);
    await get(facilitator.accessToken).expect(403);
    await patch(facilitator.accessToken, { defaultLanguage: 'en' }).expect(403);
  });
});
