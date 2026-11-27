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

describe('Courses, modules and lessons (integration)', () => {
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

  const courseBody = (overrides: Record<string, unknown> = {}) => ({
    title: 'Tomato nursery management',
    shortDescription: 'Raise healthy tomato seedlings.',
    detailedDescription: 'Covers nursery site selection, sowing depth and hardening off.',
    cropId,
    category: 'CROP_PRODUCTION',
    targetAudience: 'ALL_FARMERS',
    difficulty: 'BEGINNER',
    learningObjectives: ['Prepare a nursery bed', 'Transplant at the right stage'],
    estimatedDurationMinutes: 90,
    ...overrides,
  });

  it('creates and updates a draft course owned by the administrator', async () => {
    const created = await createCourseFixture(ctx, admin.id, courseBody());

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      title: 'Tomato nursery management',
      status: 'DRAFT',
      language: 'rw',
      crop: { code: 'TOMATO' },
      createdBy: { id: admin.id },
      publishedAt: null,
    });

    const updated = await ctx
      .http()
      .patch(`${API}/courses/${created.body.id}`)
      .set(...bearer(admin.accessToken))
      .send({ title: 'Raising tomato seedlings', status: 'UNDER_REVIEW', language: 'en' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      title: 'Raising tomato seedlings',
      status: 'UNDER_REVIEW',
      language: 'en',
    });

    const listed = await ctx
      .http()
      .get(`${API}/courses?status=UNDER_REVIEW`)
      .set(...bearer(admin.accessToken));
    expect(listed.body.data).toHaveLength(1);
  });

  it('has no manual course creation and rejects direct publishing through update', async () => {
    // Courses are only created through AI course generation (POST /course-generations).
    await ctx
      .http()
      .post(`${API}/courses`)
      .set(...bearer(admin.accessToken))
      .send(courseBody())
      .expect(404);

    const created = await createCourseFixture(ctx, admin.id, courseBody());
    const published = await ctx
      .http()
      .patch(`${API}/courses/${created.body.id}`)
      .set(...bearer(admin.accessToken))
      .send({ status: 'PUBLISHED' });
    expect(published.status).toBe(400);
  });

  it('adds modules and lessons in display order', async () => {
    const course = await createCourseFixture(ctx, admin.id, courseBody());

    const first = await ctx
      .http()
      .post(`${API}/courses/${course.body.id}/modules`)
      .set(...bearer(admin.accessToken))
      .send({ title: 'Nursery site', learningObjectives: ['Choose a sheltered site'] });
    const second = await ctx
      .http()
      .post(`${API}/courses/${course.body.id}/modules`)
      .set(...bearer(admin.accessToken))
      .send({ title: 'Sowing' });
    expect(first.body.displayOrder).toBe(0);
    expect(second.body.displayOrder).toBe(1);

    const lesson = await ctx
      .http()
      .post(`${API}/modules/${first.body.id}/lessons`)
      .set(...bearer(admin.accessToken))
      .send({
        title: 'Shade and water',
        lessonType: 'TEXT',
        contentRef: 'media/lessons/shade.md',
        estimatedDurationMinutes: 15,
      });
    expect(lesson.status).toBe(201);
    expect(lesson.body).toMatchObject({
      moduleId: first.body.id,
      lessonType: 'TEXT',
      language: 'rw',
      displayOrder: 0,
    });

    const lessons = await ctx
      .http()
      .get(`${API}/modules/${first.body.id}/lessons`)
      .set(...bearer(admin.accessToken));
    expect(lessons.body).toHaveLength(1);

    await ctx
      .http()
      .patch(`${API}/lessons/${lesson.body.id}`)
      .set(...bearer(admin.accessToken))
      .send({ title: 'Shade, water and hardening' })
      .expect(200);
    await ctx
      .http()
      .delete(`${API}/modules/${second.body.id}`)
      .set(...bearer(admin.accessToken))
      .expect(204);

    const modules = await ctx
      .http()
      .get(`${API}/courses/${course.body.id}/modules`)
      .set(...bearer(admin.accessToken));
    expect(modules.body.map((module: { title: string }) => module.title)).toEqual(['Nursery site']);
  });

  it('forbids facilitators and farmers from managing courses', async () => {
    const course = await createCourseFixture(ctx, admin.id, courseBody());
    const facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
    const farmer = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);

    await ctx
      .http()
      .patch(`${API}/courses/${course.body.id}`)
      .set(...bearer(facilitator.accessToken))
      .send({ title: 'Taken over' })
      .expect(403);
    await ctx
      .http()
      .get(`${API}/courses/${course.body.id}`)
      .set(...bearer(facilitator.accessToken))
      .expect(404);
    const catalogue = await ctx
      .http()
      .get(`${API}/courses`)
      .set(...bearer(farmer.accessToken))
      .expect(200);
    expect(catalogue.body.data.map((item: { id: string }) => item.id)).not.toContain(
      course.body.id,
    );

    const stored = await ctx.prisma.course.findUniqueOrThrow({ where: { id: course.body.id } });
    expect(stored.createdById).toBe(admin.id);
    expect(stored.title).toBe('Tomato nursery management');
  });

  it('deletes a draft and refuses to delete a course that was published', async () => {
    const draft = await createCourseFixture(ctx, admin.id, courseBody());
    await ctx
      .http()
      .delete(`${API}/courses/${draft.body.id}`)
      .set(...bearer(admin.accessToken))
      .expect(204);

    const published = await createCourseFixture(ctx, admin.id, courseBody());
    await ctx
      .http()
      .post(`${API}/courses/${published.body.id}/publish`)
      .set(...bearer(admin.accessToken))
      .send({ scope: 'PLATFORM' })
      .expect(200);
    await ctx
      .http()
      .post(`${API}/courses/${published.body.id}/unpublish`)
      .set(...bearer(admin.accessToken))
      .expect(200);

    const removed = await ctx
      .http()
      .delete(`${API}/courses/${published.body.id}`)
      .set(...bearer(admin.accessToken));
    expect(removed.status).toBe(409);
  });
});
