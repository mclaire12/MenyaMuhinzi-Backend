import ExcelJS from 'exceljs';
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

describe('Facilitator group members: register, import and search (integration)', () => {
  let ctx: TestContext;
  let admin: SeededUser & LoginResult;
  let facilitator: SeededUser & LoginResult;
  let groupId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.mail.clear();
    admin = await seedAndLogin(ctx, [RoleCode.Admin]);
    facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
    const tomatoId = (await ctx.prisma.crop.findUniqueOrThrow({ where: { code: 'TOMATO' } })).id;
    groupId = (
      await ctx
        .http()
        .post(`${API}/facilitator/groups`)
        .set(...bearer(facilitator.accessToken))
        .send({ name: 'Kinigi growers', cropId: tomatoId, location: { province: 'NORTHERN', district: 'Musanze', sector: 'Kinigi' } })
        .expect(201)
    ).body.id as string;
  });

  const farmer = (overrides: Record<string, unknown> = {}) => ({
    fullName: 'Mukeshimana Vestine',
    phoneNumber: '0788555100',
    email: 'vestine@example.rw',
    farmerType: 'BASIC_PHONE',
    farmerCategory: 'SMALLHOLDER',
    preferredLanguage: 'rw',
    location: { province: 'NORTHERN', district: 'Musanze', sector: 'Kinigi', cell: 'Nyonirima', village: 'Kabwende' },
    ...overrides,
  });

  const members = () =>
    ctx
      .http()
      .get(`${API}/facilitator/groups/${groupId}/members`)
      .set(...bearer(facilitator.accessToken))
      .expect(200)
      .then((res) => (Array.isArray(res.body) ? res.body : res.body.data) as { user?: { id: string }; userId?: string }[]);

  it('registers a new farmer into the group as an active user who receives a verification email', async () => {
    const res = await ctx
      .http()
      .post(`${API}/facilitator/groups/${groupId}/members/register`)
      .set(...bearer(facilitator.accessToken))
      .send(farmer())
      .expect(201);
    expect(res.body).toMatchObject({ fullName: 'Mukeshimana Vestine', email: 'vestine@example.rw', emailSent: true });

    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: res.body.userId },
      include: { roles: { include: { role: true } }, location: true, farmerProfile: true },
    });
    expect(user).toMatchObject({ status: 'ACTIVE', createdById: facilitator.id, emailVerifiedAt: null });
    expect(user.roles.map((link) => link.role.code)).toEqual([RoleCode.BasicPhoneFarmer]);
    expect(user.location).toMatchObject({ cell: 'Nyonirima', village: 'Kabwende' });
    expect(ctx.mail.verificationsFor(user.id)).toEqual([expect.objectContaining({ to: 'vestine@example.rw', context: 'staff-created' })]);
    expect(JSON.stringify(await members())).toContain(user.id);

    // Administrators see the new farmer under Users.
    const users = await ctx.http().get(`${API}/users?search=vestine`).set(...bearer(admin.accessToken)).expect(200);
    expect(users.body.data.map((row: { id: string }) => row.id)).toContain(user.id);
  });

  it('rejects duplicates, invalid data and groups of other facilitators', async () => {
    const register = (token: string, body: object) =>
      ctx.http().post(`${API}/facilitator/groups/${groupId}/members/register`).set(...bearer(token)).send(body);
    await register(facilitator.accessToken, farmer()).expect(201);
    const duplicate = await register(facilitator.accessToken, farmer({ email: 'other@example.rw' }));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toBe('An account with this phone number already exists');
    await register(facilitator.accessToken, farmer({ phoneNumber: '0788555101', email: 'not-an-email' })).expect(400);
    await register(facilitator.accessToken, farmer({ phoneNumber: '0788555102', email: 'x@example.rw', location: { province: 'NORTHERN', district: 'Musanze', sector: 'Kinigi' } })).expect(400);

    const other = await seedAndLogin(ctx, [RoleCode.Facilitator]);
    await register(other.accessToken, farmer({ phoneNumber: '0788555103', email: 'y@example.rw' })).expect(403);
  });

  it('serves the Excel template with the registration columns', async () => {
    const res = await ctx
      .http()
      .get(`${API}/facilitator/groups/member-template`)
      .set(...bearer(facilitator.accessToken))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as unknown as ArrayBuffer);
    const headers: string[] = [];
    workbook.getWorksheet('Farmers')!.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).toEqual([
      'Full name *',
      'Phone number *',
      'Personal email *',
      'Phone type *',
      'Farmer category',
      'Language',
      'Province *',
      'District *',
      'Sector *',
      'Cell *',
      'Village *',
    ]);
    expect(workbook.getWorksheet('Instructions')).toBeDefined();
  });

  it('imports the filled template: creates valid rows, reports the others', async () => {
    await ctx.prisma.user.create({
      data: { fullName: 'Existing', phoneNumber: '+250788555202', email: 'existing@example.rw', status: 'ACTIVE' },
    });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Farmers');
    sheet.addRow(['Full name *', 'Phone number *', 'Personal email *', 'Phone type *', 'Farmer category', 'Language', 'Province *', 'District *', 'Sector *', 'Cell *', 'Village *']);
    sheet.addRow(['Uwase Aline', '0788555201', 'aline@example.rw', 'Smartphone', 'Lead farmer', 'English', 'Northern', 'Musanze', 'Kinigi', 'Nyonirima', 'Kabwende']);
    sheet.addRow([]);
    sheet.addRow(['Duplicate Phone', '0788555202', 'dup@example.rw', 'Basic phone', '', '', 'Northern', 'Musanze', 'Kinigi', 'Nyonirima', 'Kabwende']);
    sheet.addRow(['Bad Email', '0788555203', 'nope', 'Basic phone', '', '', 'Mars', 'Musanze', 'Kinigi', '', 'Kabwende']);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());

    const res = await ctx
      .http()
      .post(`${API}/facilitator/groups/${groupId}/members/import`)
      .set(...bearer(facilitator.accessToken))
      .attach('file', file, 'members.xlsx')
      .expect(201);

    expect(res.body.total).toBe(3);
    expect(res.body.created).toEqual([expect.objectContaining({ row: 2, fullName: 'Uwase Aline', emailSent: true })]);
    expect(res.body.failed).toEqual([
      { row: 4, fullName: 'Duplicate Phone', errors: ['An account with this phone number already exists'] },
      expect.objectContaining({ row: 5, fullName: 'Bad Email' }),
    ]);
    expect(res.body.failed[1].errors.join(' ')).toMatch(/email/);
    expect(res.body.failed[1].errors.join(' ')).toMatch(/location\.province/);
    expect(res.body.failed[1].errors.join(' ')).toMatch(/location\.cell/);

    const created = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'aline@example.rw' },
      include: { farmerProfile: true, roles: { include: { role: true } } },
    });
    expect(created.preferredLanguage).toBe('en');
    expect(created.farmerProfile).toMatchObject({ farmerType: 'SMARTPHONE', farmerCategory: 'LEAD_FARMER' });
    expect(ctx.mail.verificationsFor(created.id)).toHaveLength(1);
    expect(JSON.stringify(await members())).toContain(created.id);
  });

  it('rejects files that are not the template', async () => {
    const upload = (file: Buffer, name: string) =>
      ctx.http().post(`${API}/facilitator/groups/${groupId}/members/import`).set(...bearer(facilitator.accessToken)).attach('file', file, name);
    const notExcel = await upload(Buffer.from('hello'), 'members.xlsx');
    expect(notExcel.status).toBe(400);
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Farmers').addRow(['Name', 'Phone']);
    const wrongColumns = await upload(Buffer.from(await workbook.xlsx.writeBuffer()), 'members.xlsx');
    expect(wrongColumns.status).toBe(400);
    expect(wrongColumns.body.message).toMatch(/Missing columns/);
    await ctx.http().post(`${API}/facilitator/groups/${groupId}/members/import`).set(...bearer(facilitator.accessToken)).expect(400);
  });

  it('finds a farmer already on the platform by email and adds them to the group', async () => {
    const existing = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
    await ctx.prisma.farmerProfile.create({ data: { userId: existing.id, farmerType: 'SMARTPHONE' } });
    const email = (await ctx.prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).email!;
    const search = await ctx
      .http()
      .get(`${API}/farmers?search=${encodeURIComponent(email)}`)
      .set(...bearer(facilitator.accessToken))
      .expect(200);
    expect(search.body.data.map((row: { userId: string }) => row.userId)).toEqual([existing.id]);

    await ctx
      .http()
      .post(`${API}/facilitator/groups/${groupId}/members`)
      .set(...bearer(facilitator.accessToken))
      .send({ userIds: [existing.id] })
      .expect(201);
    expect(JSON.stringify(await members())).toContain(existing.id);
  });
});
