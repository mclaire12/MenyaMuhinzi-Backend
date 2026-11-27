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

describe('AI course generation (integration)', () => {
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

  const outline = (overrides: Record<string, unknown> = {}) => ({
    title: 'Tomato nursery management',
    shortDescription: 'Raise healthy tomato seedlings.',
    brief: 'Smallholders in Musanze. Low-cost practices, local varieties.',
    cropId: tomatoId,
    category: 'CROP_PRODUCTION',
    targetAudience: 'ALL_FARMERS',
    difficulty: 'BEGINNER',
    learningObjectives: ['Prepare a nursery bed'],
    estimatedDurationMinutes: 120,
    contentFormats: ['AUDIO', 'VIDEO'],
    chapters: [
      {
        title: 'Preparing the nursery',
        description: 'Site and soil',
        subChapters: [{ title: 'Choosing the site' }, { title: 'Preparing the soil', description: 'Compost and drainage' }],
      },
      { title: 'Sowing', subChapters: [{ title: 'Sowing depth' }] },
    ],
    ...overrides,
  });

  const generate = (token: string, body: object) =>
    ctx.http().post(`${API}/course-generations`).set(...bearer(token)).send(body);

  async function approvedSource(title: string, includeInTraining = true) {
    const source = await ctx.prisma.knowledgeSource.create({
      data: {
        title,
        sourceType: 'PDF',
        createdById: admin.id,
        includeInTraining,
        status: 'APPROVED',
        latestVersionNumber: 1,
        approvedAt: new Date(),
        versions: {
          create: {
            versionNumber: 1,
            storageKind: 'STORAGE_REFERENCE',
            storageRef: `uploads/2026/11/${title.length}abc.pdf`,
            status: 'APPROVED',
            createdById: admin.id,
          },
        },
      },
      include: { versions: true },
    });
    await ctx.prisma.knowledgeSource.update({
      where: { id: source.id },
      data: { approvedVersionId: source.versions[0]!.id },
    });
    return source.id;
  }

  async function facilitatorGroup(cropId = tomatoId) {
    const res = await ctx
      .http()
      .post(`${API}/facilitator/groups`)
      .set(...bearer(facilitator.accessToken))
      .send({ name: 'Kinigi growers', cropId, location: { province: 'NORTHERN', district: 'Musanze', sector: 'Kinigi' } })
      .expect(201);
    return res.body.id as string;
  }

  it('saves the outline as a draft course with chapters and sub-chapters, waiting for the model', async () => {
    const sourceId = await approvedSource('RAB tomato guide');
    const res = await generate(admin.accessToken, outline({ knowledgeSourceIds: [sourceId] })).expect(201);

    expect(res.body).toMatchObject({
      scope: 'PLATFORM',
      status: 'PENDING',
      statusMessage: expect.stringMatching(/Waiting for the course-generation model/),
      contentFormats: ['TEXT', 'AUDIO', 'VIDEO'],
      knowledgeSources: [{ id: sourceId, title: 'RAB tomato guide' }],
      course: { title: 'Tomato nursery management', status: 'DRAFT' },
      requestedBy: { id: admin.id },
    });
    expect(res.body.chapters).toEqual([
      { title: 'Preparing the nursery', description: 'Site and soil', subChapters: [{ title: 'Choosing the site' }, { title: 'Preparing the soil', description: 'Compost and drainage' }] },
      { title: 'Sowing', subChapters: [{ title: 'Sowing depth' }] },
    ]);

    const courseId = res.body.course.id as string;
    const modules = await ctx.prisma.courseModule.findMany({
      where: { courseId },
      orderBy: { displayOrder: 'asc' },
      include: { lessons: { orderBy: { displayOrder: 'asc' } } },
    });
    expect(modules.map((module) => module.title)).toEqual(['Preparing the nursery', 'Sowing']);
    expect(modules[0]!.lessons.map((lesson) => lesson.title)).toEqual(['Choosing the site', 'Preparing the soil']);
    expect(modules[0]!.lessons.every((lesson) => lesson.lessonType === 'MIXED' && lesson.status === 'DRAFT')).toBe(true);
    expect(modules[0]!.lessons[0]!.estimatedDurationMinutes).toBe(40);

    const course = await ctx.http().get(`${API}/courses/${courseId}`).set(...bearer(admin.accessToken)).expect(200);
    expect(course.body.generation).toEqual({ id: res.body.id, status: 'PENDING' });
    expect(course.body.facilitatorOwner).toBeNull();
    expect(course.body.sharedWithGroups).toEqual([]);
    await expect(
      ctx.prisma.auditLog.count({ where: { action: 'course-generation.request', entityId: res.body.id } }),
    ).resolves.toBe(1);
  });

  it('validates the outline and the knowledge sources', async () => {
    await generate(admin.accessToken, outline({ chapters: [] })).expect(400);
    await generate(admin.accessToken, outline({ chapters: [{ title: 'Empty', subChapters: [] }] })).expect(400);
    await generate(admin.accessToken, outline({ contentFormats: ['SLIDES'] })).expect(400);
    await generate(admin.accessToken, outline({ brief: '' })).expect(400);

    const unapproved = await ctx.prisma.knowledgeSource.create({
      data: { title: 'Draft guide', sourceType: 'PDF', createdById: admin.id },
    });
    const res = await generate(admin.accessToken, outline({ knowledgeSourceIds: [unapproved.id] }));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Only approved, active Knowledge Base sources can be used');

    // Groups are chosen when publishing, not when generating.
    await generate(admin.accessToken, outline({ facilitatorGroupId: '7c3d8b3e-0000-4000-8000-000000000000' })).expect(400);
    await expect(ctx.prisma.course.count()).resolves.toBe(0);
  });

  it('blocks publishing until generation finishes and lets a pending request be cancelled', async () => {
    const res = await generate(admin.accessToken, outline()).expect(201);
    const courseId = res.body.course.id as string;

    const early = await ctx
      .http()
      .post(`${API}/courses/${courseId}/publish`)
      .set(...bearer(admin.accessToken))
      .send({ scope: 'PLATFORM' });
    expect(early.status).toBe(409);
    expect(early.body.message).toBe('The AI has not finished writing this course yet');

    const cancelled = await ctx
      .http()
      .post(`${API}/course-generations/${res.body.id}/cancel`)
      .set(...bearer(admin.accessToken))
      .expect(201);
    expect(cancelled.body.status).toBe('CANCELLED');
    await ctx.http().post(`${API}/course-generations/${res.body.id}/cancel`).set(...bearer(admin.accessToken)).expect(409);

    // The draft course and its structure are kept after cancelling.
    await expect(ctx.prisma.lesson.count({ where: { module: { courseId } } })).resolves.toBe(3);

    const listed = await ctx
      .http()
      .get(`${API}/course-generations?status=CANCELLED`)
      .set(...bearer(admin.accessToken))
      .expect(200);
    expect(listed.body.meta.total).toBe(1);
  });

  it('lets a facilitator generate a course without choosing a group', async () => {
    const other = await seedAndLogin(ctx, [RoleCode.Facilitator]);
    const res = await generate(facilitator.accessToken, outline({ cropId: cabbageId })).expect(201);
    expect(res.body).toMatchObject({ scope: 'GROUP', status: 'PENDING' });

    const course = await ctx.http().get(`${API}/courses/${res.body.course.id}`).set(...bearer(facilitator.accessToken)).expect(200);
    expect(course.body).toMatchObject({ facilitatorOwner: { id: facilitator.id }, sharedWithGroups: [], status: 'DRAFT' });

    const mine = await ctx.http().get(`${API}/course-generations`).set(...bearer(facilitator.accessToken)).expect(200);
    expect(mine.body.meta.total).toBe(1);
    const theirs = await ctx.http().get(`${API}/course-generations`).set(...bearer(other.accessToken)).expect(200);
    expect(theirs.body.meta.total).toBe(0);
    await ctx.http().get(`${API}/course-generations/${res.body.id}`).set(...bearer(other.accessToken)).expect(404);

    const farmer = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
    await generate(farmer.accessToken, outline()).expect(403);
  });

  it('publishes a finished facilitator course to one or many of their groups, never platform-wide', async () => {
    const groupA = await facilitatorGroup();
    const groupB = await facilitatorGroup(cabbageId);
    const memberA = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
    const memberB = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
    const outsider = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
    await ctx.prisma.facilitatorGroupMember.createMany({
      data: [
        { groupId: groupA, userId: memberA.id, addedById: facilitator.id },
        { groupId: groupB, userId: memberB.id, addedById: facilitator.id },
      ],
    });
    const other = await seedAndLogin(ctx, [RoleCode.Facilitator]);
    const otherGroup = (
      await ctx
        .http()
        .post(`${API}/facilitator/groups`)
        .set(...bearer(other.accessToken))
        .send({ name: 'Other group', cropId: tomatoId, location: { province: 'NORTHERN', district: 'Musanze', sector: 'Muhoza' } })
        .expect(201)
    ).body.id as string;

    const res = await generate(facilitator.accessToken, outline()).expect(201);
    const courseId = res.body.course.id as string;
    const publish = (token: string, groupIds: string[]) =>
      ctx.http().put(`${API}/courses/${courseId}/groups`).set(...bearer(token)).send({ groupIds });

    // The owner sees the draft; other facilitators do not.
    await ctx.http().get(`${API}/courses/${courseId}`).set(...bearer(other.accessToken)).expect(404);

    // Facilitators can list their own courses (drafts included) and filter them.
    const groupList = await ctx.http().get(`${API}/courses?ownership=GROUP&status=DRAFT`).set(...bearer(facilitator.accessToken)).expect(200);
    expect(groupList.body.data.map((c: { id: string }) => c.id)).toEqual([courseId]);
    const platformList = await ctx.http().get(`${API}/courses?ownership=PLATFORM`).set(...bearer(facilitator.accessToken)).expect(200);
    expect(platformList.body.data.map((c: { id: string }) => c.id)).not.toContain(courseId);
    const otherList = await ctx.http().get(`${API}/courses?ownership=GROUP`).set(...bearer(other.accessToken)).expect(200);
    expect(otherList.body.meta.total).toBe(0);

    await publish(facilitator.accessToken, [groupA]).expect(409); // generation still pending
    await ctx.prisma.courseGenerationRequest.update({ where: { id: res.body.id }, data: { status: 'COMPLETED' } });

    const adminPublish = await ctx.http().post(`${API}/courses/${courseId}/publish`).set(...bearer(admin.accessToken)).send({ scope: 'PLATFORM' });
    expect(adminPublish.status).toBe(400);
    await publish(facilitator.accessToken, []).expect(400);
    await publish(facilitator.accessToken, [groupA, otherGroup]).expect(400); // not their group
    await publish(other.accessToken, [otherGroup]).expect(404); // not their course

    const published = await publish(facilitator.accessToken, [groupA, groupB]).expect(200);
    expect(published.body.status).toBe('PUBLISHED');
    expect(published.body.sharedWithGroups.map((g: { id: string }) => g.id).sort()).toEqual([groupA, groupB].sort());

    const catalogue = (token: string) =>
      ctx.http().get(`${API}/courses`).set(...bearer(token)).expect(200).then((r) => r.body.data.map((c: { id: string }) => c.id));
    await expect(catalogue(memberA.accessToken)).resolves.toContain(courseId);
    await expect(catalogue(memberB.accessToken)).resolves.toContain(courseId);
    await expect(catalogue(outsider.accessToken)).resolves.not.toContain(courseId);
    await ctx.http().get(`${API}/courses/${courseId}`).set(...bearer(outsider.accessToken)).expect(404);
    const farmerView = await ctx.http().get(`${API}/courses/${courseId}`).set(...bearer(memberA.accessToken)).expect(200);
    expect(farmerView.body.sharedWithGroups).toEqual([]); // group names are not shown to farmers

    // Publishing again replaces the groups.
    await publish(facilitator.accessToken, [groupB]).expect(200);
    await expect(catalogue(memberA.accessToken)).resolves.not.toContain(courseId);
    await expect(catalogue(memberB.accessToken)).resolves.toContain(courseId);

    await ctx.http().delete(`${API}/courses/${courseId}/groups`).set(...bearer(facilitator.accessToken)).expect(200);
    await expect(catalogue(memberB.accessToken)).resolves.not.toContain(courseId);
    const draft = await ctx.http().get(`${API}/courses/${courseId}`).set(...bearer(facilitator.accessToken)).expect(200);
    expect(draft.body).toMatchObject({ status: 'DRAFT', sharedWithGroups: [] });
  });

  it('lists approved sources marked for training as the retraining corpus', async () => {
    const included = await approvedSource('Included guide');
    await approvedSource('Excluded guide', false);
    await ctx.prisma.knowledgeSource.create({ data: { title: 'Not approved', sourceType: 'PDF', createdById: admin.id } });

    const res = await ctx.http().get(`${API}/knowledge/training-corpus`).set(...bearer(admin.accessToken)).expect(200);
    expect(res.body.data.map((row: { sourceId: string }) => row.sourceId)).toEqual([included]);
    expect(res.body.data[0]).toMatchObject({ title: 'Included guide', version: { versionNumber: 1, status: 'APPROVED' } });
    await ctx.http().get(`${API}/knowledge/training-corpus`).set(...bearer(facilitator.accessToken)).expect(403);

    const toggled = await ctx
      .http()
      .patch(`${API}/knowledge/sources/${included}`)
      .set(...bearer(admin.accessToken))
      .send({ includeInTraining: false })
      .expect(200);
    expect(toggled.body.includeInTraining).toBe(false);
  });
});
