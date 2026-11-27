import { RoleCode } from '../../src/modules/roles/rbac.constants';
import {
  API,
  bearer,
  createCourseFixture,
  createTestContext,
  resetDatabase,
  seedAndLogin,
  type LoginResult,
  type SeededUser,
  type TestContext,
} from './helpers';

describe('Course publication (integration)', () => {
  let ctx: TestContext;
  let admin: SeededUser & LoginResult;
  let facilitator: SeededUser & LoginResult;
  let tomatoId: string;
  let cabbageId: string;

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
    tomatoId = (await ctx.prisma.crop.findUniqueOrThrow({ where: { code: 'TOMATO' } })).id;
    cabbageId = (await ctx.prisma.crop.findUniqueOrThrow({ where: { code: 'CABBAGE' } })).id;
  });

  async function createCourse(cropId = tomatoId) {
    const res = await createCourseFixture(ctx, admin.id, {
        title: 'Tomato nursery management',
        shortDescription: 'Raise healthy tomato seedlings.',
        detailedDescription: 'Covers nursery site selection, sowing depth and hardening off.',
        cropId,
        category: 'CROP_PRODUCTION',
        targetAudience: 'SMARTPHONE_FARMERS',
        difficulty: 'BEGINNER',
        learningObjectives: ['Prepare a nursery bed'],
        estimatedDurationMinutes: 45,
      });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function targetingGroup(cropId: string, sector?: string) {
    const res = await ctx
      .http()
      .post(`${API}/admin/groups`)
      .set(...bearer(admin.accessToken))
      .send({
        name: `Target ${cropId.slice(0, 4)} ${sector ?? 'district'}`,
        cropId,
        targetAudience: 'ALL_FARMERS',
        location: { province: 'NORTHERN', district: 'Musanze', ...(sector ? { sector } : {}) },
        estimatedFarmerCount: 100,
      });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function farmerGroup(cropId: string, sector = 'Kinigi') {
    const res = await ctx
      .http()
      .post(`${API}/facilitator/groups`)
      .set(...bearer(facilitator.accessToken))
      .send({
        name: `Group ${sector}`,
        cropId,
        location: { province: 'NORTHERN', district: 'Musanze', sector },
      });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it('publishes platform-wide, records the administrator, and rejects a second publication', async () => {
    const courseId = await createCourse();

    const published = await ctx
      .http()
      .post(`${API}/courses/${courseId}/publish`)
      .set(...bearer(admin.accessToken))
      .send({ scope: 'PLATFORM' });

    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({
      courseId,
      scope: 'PLATFORM',
      isCurrent: true,
      publishedBy: { id: admin.id },
      targetingGroups: [],
    });
    const course = await ctx.prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(course.status).toBe('PUBLISHED');
    expect(course.publishedAt).not.toBeNull();

    const again = await ctx
      .http()
      .post(`${API}/courses/${courseId}/publish`)
      .set(...bearer(admin.accessToken))
      .send({ scope: 'PLATFORM' });
    expect(again.status).toBe(409);
    expect(again.body.message).toBe('Course is already published');
  });

  it('publishes to selected targeting groups and keeps history after unpublishing', async () => {
    const courseId = await createCourse();
    const musanze = await targetingGroup(tomatoId);
    const kinigi = await targetingGroup(tomatoId, 'Kinigi');

    const published = await ctx
      .http()
      .post(`${API}/courses/${courseId}/publish`)
      .set(...bearer(admin.accessToken))
      .send({ scope: 'TARGETED', targetingGroupIds: [musanze, kinigi] });
    expect(published.status).toBe(200);
    expect(published.body.targetingGroups.map((group: { id: string }) => group.id).sort()).toEqual(
      [musanze, kinigi].sort(),
    );

    const duplicate = await ctx
      .http()
      .post(`${API}/courses/${courseId}/publish`)
      .set(...bearer(admin.accessToken))
      .send({ scope: 'TARGETED', targetingGroupIds: [musanze, musanze] });
    expect(duplicate.status).toBe(400);

    // The group page lists the course while the targeted publication is current.
    const groupCourses = await ctx
      .http()
      .get(`${API}/admin/groups/${musanze}/courses`)
      .set(...bearer(admin.accessToken))
      .expect(200);
    expect(groupCourses.body).toEqual([
      expect.objectContaining({
        courseId,
        status: 'PUBLISHED',
        publishedBy: { id: admin.id, fullName: expect.any(String) },
      }),
    ]);

    const unpublished = await ctx
      .http()
      .post(`${API}/courses/${courseId}/unpublish`)
      .set(...bearer(admin.accessToken))
      .send({});
    expect(unpublished.status).toBe(200);
    expect(unpublished.body).toMatchObject({ isCurrent: false, unpublishedBy: { id: admin.id } });
    const afterUnpublish = await ctx
      .http()
      .get(`${API}/admin/groups/${musanze}/courses`)
      .set(...bearer(admin.accessToken))
      .expect(200);
    expect(afterUnpublish.body).toEqual([]);

    const history = await ctx
      .http()
      .get(`${API}/courses/${courseId}/publications`)
      .set(...bearer(admin.accessToken));
    expect(history.body).toHaveLength(1);
    expect(history.body[0].isCurrent).toBe(false);
    await expect(
      ctx.prisma.course.findUniqueOrThrow({ where: { id: courseId } }),
    ).resolves.toMatchObject({
      status: 'DRAFT',
      publishedAt: null,
    });
  });

  it('stops facilitators from publishing and from assigning unpublished courses', async () => {
    const courseId = await createCourse();
    const groupId = await farmerGroup(tomatoId);

    await ctx
      .http()
      .post(`${API}/courses/${courseId}/publish`)
      .set(...bearer(facilitator.accessToken))
      .send({ scope: 'PLATFORM' })
      .expect(403);

    const assigned = await ctx
      .http()
      .post(`${API}/facilitator/groups/${groupId}/courses`)
      .set(...bearer(facilitator.accessToken))
      .send({ courseId });
    expect(assigned.status).toBe(409);
    expect(assigned.body.message).toMatch(/published course/);
  });

  it('assigns a platform-wide course once, and a targeted course only to a matching group', async () => {
    const platformCourse = await createCourse();
    await ctx
      .http()
      .post(`${API}/courses/${platformCourse}/publish`)
      .set(...bearer(admin.accessToken))
      .send({ scope: 'PLATFORM' })
      .expect(200);
    const groupId = await farmerGroup(tomatoId);

    const assigned = await ctx
      .http()
      .post(`${API}/facilitator/groups/${groupId}/courses`)
      .set(...bearer(facilitator.accessToken))
      .send({ courseId: platformCourse });
    expect(assigned.status).toBe(201);
    expect(assigned.body.course).toMatchObject({ id: platformCourse, status: 'PUBLISHED' });
    expect(assigned.body.assignedBy.id).toBe(facilitator.id);

    const duplicate = await ctx
      .http()
      .post(`${API}/facilitator/groups/${groupId}/courses`)
      .set(...bearer(facilitator.accessToken))
      .send({ courseId: platformCourse });
    expect(duplicate.status).toBe(409);

    const targeted = await createCourse();
    const targetId = await targetingGroup(tomatoId, 'Muhoza');
    await ctx
      .http()
      .post(`${API}/courses/${targeted}/publish`)
      .set(...bearer(admin.accessToken))
      .send({ scope: 'TARGETED', targetingGroupIds: [targetId] })
      .expect(200);

    const outside = await ctx
      .http()
      .post(`${API}/facilitator/groups/${groupId}/courses`)
      .set(...bearer(facilitator.accessToken))
      .send({ courseId: targeted });
    expect(outside.status).toBe(409);
    expect(outside.body.message).toMatch(/crop and location/);

    const matchingGroup = await farmerGroup(tomatoId, 'Muhoza');
    await ctx
      .http()
      .post(`${API}/facilitator/groups/${matchingGroup}/courses`)
      .set(...bearer(facilitator.accessToken))
      .send({ courseId: targeted })
      .expect(201);

    const otherCrop = await farmerGroup(cabbageId, 'Muhoza');
    await ctx
      .http()
      .post(`${API}/facilitator/groups/${otherCrop}/courses`)
      .set(...bearer(facilitator.accessToken))
      .send({ courseId: targeted })
      .expect(409);

    const visible = await ctx
      .http()
      .get(`${API}/courses`)
      .set(...bearer(facilitator.accessToken));
    const ids = visible.body.data.map((course: { id: string }) => course.id).sort();
    expect(ids).toEqual([platformCourse, targeted].sort());

    const assignedCourses = await ctx
      .http()
      .get(`${API}/facilitator/groups/${matchingGroup}/courses`)
      .set(...bearer(facilitator.accessToken));
    expect(assignedCourses.body).toHaveLength(1);
  });
});
