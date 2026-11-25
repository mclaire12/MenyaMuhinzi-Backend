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
    ctx.mail.clear();
  });

  /** Opens the verification link from the account's latest email, as the user would. */
  async function verifyEmailOf(userId: string): Promise<void> {
    await ctx
      .http()
      .post(`${API}/auth/verify-email`)
      .send(ctx.mail.latestVerification(userId))
      .expect(204);
  }

  const createFarmer = (body: Record<string, unknown>) =>
    ctx
      .http()
      .post(`${API}/farmers`)
      .set(...bearer(admin.accessToken))
      .send(body);

  describe('farmers', () => {
    it('creates a basic-phone farmer with a mandatory personal email who verifies it before signing in', async () => {
      const res = await createFarmer({
        fullName: 'Habimana Jean Bosco',
        phoneNumber: '0722123456',
        email: 'Habimana@Example.rw',
        password: DEFAULT_PASSWORD,
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
        email: 'habimana@example.rw',
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

      // Verification email goes to the personal address; sign-in waits for it.
      expect(ctx.mail.verificationsFor(res.body.userId)).toEqual([
        expect.objectContaining({ to: 'habimana@example.rw', context: 'staff-created' }),
      ]);
      const early = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ identifier: '0722123456', password: DEFAULT_PASSWORD });
      expect(early.status).toBe(403);
      expect(early.body.message).toBe('Email verification is required before login');

      await verifyEmailOf(res.body.userId);
      const session = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ identifier: '0722123456', password: DEFAULT_PASSWORD });
      expect(session.status).toBe(200);
      expect(session.body.user.roles).toEqual([RoleCode.BasicPhoneFarmer]);

      // The basic-phone role cannot reach staff-only endpoints.
      await ctx
        .http()
        .get(`${API}/farmers`)
        .set(...bearer(session.body.accessToken))
        .expect(403);
      await ctx
        .http()
        .get(`${API}/accounts/requests`)
        .set(...bearer(session.body.accessToken))
        .expect(403);
    });

    it('requires a personal email and the full address for every farmer', async () => {
      const base = {
        fullName: 'No Email',
        phoneNumber: nextPhone(),
        farmerType: 'BASIC_PHONE',
        location: {
          province: 'WESTERN',
          district: 'Rubavu',
          sector: 'Gisenyi',
          cell: 'Umuganda',
          village: 'Isangano',
        },
      };
      const noEmail = await createFarmer(base);
      expect(noEmail.status).toBe(400);
      expect(noEmail.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/^email/)]),
      );

      const noCell = await createFarmer({
        ...base,
        email: 'nocell@example.rw',
        location: {
          province: 'WESTERN',
          district: 'Rubavu',
          sector: 'Gisenyi',
          village: 'Isangano',
        },
      });
      expect(noCell.status).toBe(400);
      expect(noCell.body.message).toEqual(expect.arrayContaining([expect.stringMatching(/cell/)]));

      const noVillage = await createFarmer({
        ...base,
        email: 'novillage@example.rw',
        location: { province: 'WESTERN', district: 'Rubavu', sector: 'Gisenyi', cell: 'Umuganda' },
      });
      expect(noVillage.status).toBe(400);
      expect(noVillage.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/village/)]),
      );
    });

    it('denies basic-phone farmer creation to anyone without the permission', async () => {
      const body = {
        fullName: 'Not Allowed',
        phoneNumber: nextPhone(),
        email: 'not.allowed@example.rw',
        farmerType: 'BASIC_PHONE',
        location: {
          province: 'SOUTHERN',
          district: 'Huye',
          sector: 'Tumba',
          cell: 'Cyarwa',
          village: 'Kabutare',
        },
      };
      for (const role of [
        RoleCode.SmartphoneFarmer,
        RoleCode.BasicPhoneFarmer,
        RoleCode.Facilitator,
      ]) {
        const user = await seedAndLogin(ctx, [role]);
        await ctx
          .http()
          .post(`${API}/farmers`)
          .set(...bearer(user.accessToken))
          .send(body)
          .expect(403);
      }
      await ctx.http().post(`${API}/farmers`).send(body).expect(401);
      await expect(
        ctx.prisma.user.count({ where: { email: 'not.allowed@example.rw' } }),
      ).resolves.toBe(0);
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
        location: {
          province: 'KIGALI_CITY',
          district: 'Gasabo',
          sector: 'Kimironko',
          cell: 'Bibare',
          village: 'Imena',
        },
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        farmerType: 'SMARTPHONE',
        farmerCategory: 'LEAD_FARMER',
        preferredLanguage: 'en',
        email: 'diane@example.rw',
      });
      await verifyEmailOf(res.body.userId);
      const session = await login(ctx, '0788765432');
      const me = await ctx
        .http()
        .get(`${API}/auth/me`)
        .set(...bearer(session.accessToken))
        .expect(200);
      expect(me.body.roles).toEqual([RoleCode.SmartphoneFarmer]);
    });

    it('validates the phone number and location', async () => {
      const base = { fullName: 'X', farmerType: 'BASIC_PHONE', email: 'x@example.rw' };
      const address = { sector: 'Gisenyi', cell: 'Umuganda', village: 'Isangano' };
      await createFarmer({
        ...base,
        phoneNumber: '12345',
        location: { province: 'WESTERN', district: 'Rubavu', ...address },
      }).expect(400);
      await createFarmer({
        ...base,
        phoneNumber: nextPhone(),
        location: { province: 'WESTERN', district: 'Gasabo', ...address },
      }).expect(400);
      await createFarmer({ ...base, phoneNumber: nextPhone() }).expect(400);
      await createFarmer({
        ...base,
        phoneNumber: nextPhone(),
        preferredLanguage: 'fr',
        location: { province: 'WESTERN', district: 'Rubavu', ...address },
      }).expect(400);
    });

    it('lets facilitators list, view and update farmers but not create them', async () => {
      const created = await createFarmer({
        fullName: 'Nshimiyimana Paul',
        phoneNumber: nextPhone(),
        email: 'paul@example.rw',
        farmerType: 'BASIC_PHONE',
        location: {
          province: 'SOUTHERN',
          district: 'Huye',
          sector: 'Tumba',
          cell: 'Cyarwa',
          village: 'Kabutare',
        },
      }).expect(201);
      await createFarmer({
        fullName: 'Ingabire Grace',
        phoneNumber: nextPhone(),
        email: 'grace@example.rw',
        farmerType: 'SMARTPHONE',
        location: {
          province: 'NORTHERN',
          district: 'Musanze',
          sector: 'Kinigi',
          cell: 'Nyabigoma',
          village: 'Kaguhu',
        },
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
          location: {
            province: 'SOUTHERN',
            district: 'Huye',
            sector: 'Ngoma',
            cell: 'Butare',
            village: 'Kaburemera',
          },
        });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({
        farmerCategory: 'COOPERATIVE_MEMBER',
        preferredLanguage: 'en',
        location: { sector: 'Ngoma', cell: 'Butare', village: 'Kaburemera' },
      });

      await ctx
        .http()
        .post(`${API}/farmers`)
        .set(...bearer(facilitator.accessToken))
        .send({
          fullName: 'Not Allowed',
          phoneNumber: nextPhone(),
          email: 'not.allowed@example.rw',
          farmerType: 'BASIC_PHONE',
          location: {
            province: 'SOUTHERN',
            district: 'Huye',
            sector: 'Tumba',
            cell: 'Cyarwa',
            village: 'Kabutare',
          },
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

      await verifyEmailOf(res.body.userId);
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
