import { UserStatus } from '../../src/generated/prisma/client';
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
  type LoginResult,
  type SeededUser,
  type TestContext,
} from './helpers';

describe('Farmer and facilitator profiles (integration)', () => {
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

  const createFarmer = (body: Record<string, unknown>) =>
    ctx
      .http()
      .post(`${API}/farmers`)
      .set(...bearer(admin.accessToken))
      .send(body);

  describe('farmers', () => {
    it('creates a basic-phone farmer without email or password', async () => {
      const res = await createFarmer({
        fullName: 'Habimana Jean Bosco',
        phoneNumber: '0722123456',
        farmerType: 'BASIC_PHONE',
        location: {
          province: 'WESTERN',
          district: 'rubavu',
          sector: 'Gisenyi',
          cell: 'Umuganda',
          village: 'Isangano',
        },
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        fullName: 'Habimana Jean Bosco',
        phoneNumber: '+250722123456',
        email: null,
        preferredLanguage: 'rw',
        status: UserStatus.ACTIVE,
        farmerType: 'BASIC_PHONE',
        farmerCategory: 'SMALLHOLDER',
        registeredAt: expect.any(String),
        location: {
          province: 'WESTERN',
          district: 'Rubavu',
          sector: 'Gisenyi',
          cell: 'Umuganda',
          village: 'Isangano',
        },
      });

      const roles = await ctx.prisma.userRole.findMany({
        where: { userId: res.body.userId },
        include: { role: true },
      });
      expect(roles.map((r) => r.role.code)).toEqual([RoleCode.BasicPhoneFarmer]);
    });

    it('creates a smartphone farmer who can sign in', async () => {
      const res = await createFarmer({
        fullName: 'Uwase Diane',
        phoneNumber: '0788765432',
        email: 'diane@example.rw',
        password: DEFAULT_PASSWORD,
        farmerType: 'SMARTPHONE',
        farmerCategory: 'LEAD_FARMER',
        preferredLanguage: 'en',
        location: { province: 'KIGALI_CITY', district: 'Gasabo', sector: 'Kimironko' },
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        farmerType: 'SMARTPHONE',
        farmerCategory: 'LEAD_FARMER',
        preferredLanguage: 'en',
        email: 'diane@example.rw',
      });
      const session = await login(ctx, '0788765432');
      const me = await ctx
        .http()
        .get(`${API}/auth/me`)
        .set(...bearer(session.accessToken))
        .expect(200);
      expect(me.body.roles).toEqual([RoleCode.SmartphoneFarmer]);
    });

    it('validates the phone number and location', async () => {
      const base = { fullName: 'X', farmerType: 'BASIC_PHONE' };
      await createFarmer({
        ...base,
        phoneNumber: '12345',
        location: { province: 'WESTERN', district: 'Rubavu', sector: 'Gisenyi' },
      }).expect(400);
      await createFarmer({
        ...base,
        phoneNumber: nextPhone(),
        location: { province: 'WESTERN', district: 'Gasabo', sector: 'Gisenyi' },
      }).expect(400);
      await createFarmer({ ...base, phoneNumber: nextPhone() }).expect(400);
      await createFarmer({
        ...base,
        phoneNumber: nextPhone(),
        preferredLanguage: 'fr',
        location: { province: 'WESTERN', district: 'Rubavu', sector: 'Gisenyi' },
      }).expect(400);
    });

    it('lets facilitators list, view and update farmers but not create them', async () => {
      const created = await createFarmer({
        fullName: 'Nshimiyimana Paul',
        phoneNumber: nextPhone(),
        farmerType: 'BASIC_PHONE',
        location: { province: 'SOUTHERN', district: 'Huye', sector: 'Tumba' },
      }).expect(201);
      await createFarmer({
        fullName: 'Ingabire Grace',
        phoneNumber: nextPhone(),
        farmerType: 'SMARTPHONE',
        location: { province: 'NORTHERN', district: 'Musanze', sector: 'Kinigi' },
      }).expect(201);
      const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);

      const list = await ctx
        .http()
        .get(`${API}/farmers`)
        .set(...bearer(facilitator.accessToken));
      expect(list.status).toBe(200);
      expect(list.body.meta.total).toBe(2);

      const filtered = await ctx
        .http()
        .get(`${API}/farmers?province=SOUTHERN&district=huye&farmerType=BASIC_PHONE`)
        .set(...bearer(facilitator.accessToken));
      expect(filtered.body.data.map((f: { fullName: string }) => f.fullName)).toEqual([
        'Nshimiyimana Paul',
      ]);

      await ctx
        .http()
        .get(`${API}/farmers/${created.body.userId}`)
        .set(...bearer(facilitator.accessToken))
        .expect(200);

      const updated = await ctx
        .http()
        .patch(`${API}/farmers/${created.body.userId}`)
        .set(...bearer(facilitator.accessToken))
        .send({
          farmerCategory: 'COOPERATIVE_MEMBER',
          preferredLanguage: 'en',
          location: { province: 'SOUTHERN', district: 'Huye', sector: 'Ngoma', village: 'Butare' },
        });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({
        farmerCategory: 'COOPERATIVE_MEMBER',
        preferredLanguage: 'en',
        location: { sector: 'Ngoma', village: 'Butare', cell: null },
      });

      await ctx
        .http()
        .post(`${API}/farmers`)
        .set(...bearer(facilitator.accessToken))
        .send({
          fullName: 'Not Allowed',
          phoneNumber: nextPhone(),
          farmerType: 'BASIC_PHONE',
          location: { province: 'SOUTHERN', district: 'Huye', sector: 'Tumba' },
        })
        .expect(403);
    });

    it('does not expose non-farmers through /farmers', async () => {
      await ctx
        .http()
        .get(`${API}/farmers/${admin.id}`)
        .set(...bearer(admin.accessToken))
        .expect(404);
    });

    it('forbids farmers from listing other farmers', async () => {
      const farmer = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
      await ctx
        .http()
        .get(`${API}/farmers`)
        .set(...bearer(farmer.accessToken))
        .expect(403);
    });
  });

  describe('facilitators', () => {
    const facilitatorBody = () => ({
      fullName: 'Niyonsaba Claudine',
      phoneNumber: nextPhone(),
      email: 'claudine@rab.gov.rw',
      password: DEFAULT_PASSWORD,
      professionalTitle: 'Agronomist',
      organization: 'Rwanda Agriculture Board',
      contactPhone: '0788000111',
      location: { province: 'SOUTHERN', district: 'Huye' },
    });

    it('creates a facilitator profile who can sign in with facilitator permissions', async () => {
      const body = facilitatorBody();
      const res = await ctx
        .http()
        .post(`${API}/facilitators`)
        .set(...bearer(admin.accessToken))
        .send(body);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: UserStatus.ACTIVE,
        professionalTitle: 'Agronomist',
        organization: 'Rwanda Agriculture Board',
        contactPhone: '+250788000111',
        contactEmail: null,
        location: { province: 'SOUTHERN', district: 'Huye', sector: null },
      });

      const session = await login(ctx, body.phoneNumber);
      await ctx
        .http()
        .get(`${API}/farmers`)
        .set(...bearer(session.accessToken))
        .expect(200);
    });

    it('requires an email and the professional details', async () => {
      const { email: _email, organization: _organization, ...incomplete } = facilitatorBody();
      const res = await ctx
        .http()
        .post(`${API}/facilitators`)
        .set(...bearer(admin.accessToken))
        .send(incomplete);
      expect(res.status).toBe(400);
    });

    it('lists, filters and updates facilitators', async () => {
      const created = await ctx
        .http()
        .post(`${API}/facilitators`)
        .set(...bearer(admin.accessToken))
        .send(facilitatorBody())
        .expect(201);

      const list = await ctx
        .http()
        .get(`${API}/facilitators?organization=agriculture&province=SOUTHERN`)
        .set(...bearer(admin.accessToken));
      expect(list.body.meta.total).toBe(1);

      const updated = await ctx
        .http()
        .patch(`${API}/facilitators/${created.body.userId}`)
        .set(...bearer(admin.accessToken))
        .send({ professionalTitle: 'Senior Agronomist', contactPhone: null });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({
        professionalTitle: 'Senior Agronomist',
        contactPhone: null,
      });
    });

    it('is restricted to administrators', async () => {
      const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
      await ctx
        .http()
        .get(`${API}/facilitators`)
        .set(...bearer(facilitator.accessToken))
        .expect(403);
      await ctx
        .http()
        .post(`${API}/facilitators`)
        .set(...bearer(facilitator.accessToken))
        .send(facilitatorBody())
        .expect(403);
    });
  });
});
