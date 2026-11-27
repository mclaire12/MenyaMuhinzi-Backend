import { Province } from '../../src/generated/prisma/client';
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

describe('Learning catalogue, enrollment, progress and assessments (integration)', () => {
  let ctx: TestContext;
  let admin: SeededUser & LoginResult;
  let facilitator: SeededUser & LoginResult;
  let smartphone: SeededUser & LoginResult;
  let basic: SeededUser & LoginResult;
  let tomatoId: string;

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
    smartphone = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
    basic = await seedAndLogin(ctx, [RoleCode.BasicPhoneFarmer]);
    tomatoId = (await ctx.prisma.crop.findUniqueOrThrow({ where: { code: 'TOMATO' } })).id;
    await ctx.prisma.userLocation.create({
      data: {
        userId: smartphone.id,
        province: Province.NORTHERN,
        district: 'Musanze',
        sector: 'Muhoza',
      },
    });
  });

  async function createCourse(targetAudience: string, title = 'Tomato nursery management') {
    const res = await createCourseFixture(ctx, admin.id, {
        title,
        shortDescription: 'Raise healthy tomato seedlings.',
        detailedDescription: 'Covers nursery site selection, sowing depth and hardening off.',
        cropId: tomatoId,
        category: 'CROP_PRODUCTION',
        targetAudience,
        difficulty: 'BEGINNER',
        learningObjectives: ['Prepare a nursery bed'],
        estimatedDurationMinutes: 45,
        language: 'rw',
      });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function publish(courseId: string, body: Record<string, unknown> = { scope: 'PLATFORM' }) {
    const res = await ctx
      .http()
      .post(`${API}/courses/${courseId}/publish`)
      .set(...bearer(admin.accessToken))
      .send(body);
    expect(res.status).toBe(200);
  }

  async function addLesson(courseId: string) {
    const module = await ctx
      .http()
      .post(`${API}/courses/${courseId}/modules`)
      .set(...bearer(admin.accessToken))
      .send({ title: 'Nursery', learningObjectives: ['Choose a site'], status: 'PUBLISHED' });
    expect(module.status).toBe(201);
    const lesson = await ctx
      .http()
      .post(`${API}/modules/${module.body.id}/lessons`)
      .set(...bearer(admin.accessToken))
      .send({
        title: 'Shade and water',
        description: 'How to water seedlings',
        lessonType: 'MIXED',
        mainContent: 'Water in the morning.',
        learningObjectives: ['Water evenly'],
        estimatedDurationMinutes: 15,
        status: 'PUBLISHED',
      });
    expect(lesson.status).toBe(201);
    const resource = await ctx
      .http()
      .post(`${API}/lessons/${lesson.body.id}/resources`)
      .set(...bearer(admin.accessToken))
      .send({
        resourceType: 'VIDEO',
        contentRef: 'https://cdn.example/nursery.mp4',
        title: 'Nursery walkthrough',
        mimeType: 'video/mp4',
        fileSizeBytes: 1200,
      });
    expect(resource.status).toBe(201);
    return { moduleId: module.body.id as string, lessonId: lesson.body.id as string };
  }

  it('shows farmers only published courses that match their phone type', async () => {
    const shared = await createCourse('ALL_FARMERS', 'For everyone');
    const phone = await createCourse('SMARTPHONE_FARMERS', 'Smartphone only');
    const ussd = await createCourse('BASIC_PHONE_FARMERS', 'Basic phone only');
    const draft = await createCourse('ALL_FARMERS', 'Still a draft');
    await publish(shared);
    await publish(phone);
    await publish(ussd);

    const seenByPhone = await ctx
      .http()
      .get(`${API}/courses`)
      .set(...bearer(smartphone.accessToken))
      .expect(200);
    const phoneTitles = seenByPhone.body.data.map((course: { title: string }) => course.title);
    expect(phoneTitles).toEqual(expect.arrayContaining(['For everyone', 'Smartphone only']));
    expect(phoneTitles).not.toContain('Basic phone only');
    expect(phoneTitles).not.toContain('Still a draft');

    const seenByBasic = await ctx
      .http()
      .get(`${API}/courses`)
      .set(...bearer(basic.accessToken))
      .expect(200);
    const basicTitles = seenByBasic.body.data.map((course: { title: string }) => course.title);
    expect(basicTitles).toContain('For everyone');
    expect(basicTitles).toContain('Basic phone only');
    expect(basicTitles).not.toContain('Smartphone only');

    const filtered = await ctx
      .http()
      .get(`${API}/courses`)
      .query({
        search: 'Smartphone',
        cropId: tomatoId,
        category: 'CROP_PRODUCTION',
        difficulty: 'BEGINNER',
        language: 'rw',
      })
      .set(...bearer(smartphone.accessToken))
      .expect(200);
    expect(filtered.body.data).toHaveLength(1);

    const detail = await ctx
      .http()
      .get(`${API}/courses/${shared}`)
      .set(...bearer(smartphone.accessToken))
      .expect(200);
    expect(detail.body.learningObjectives).toEqual(['Prepare a nursery bed']);
    expect(detail.body.estimatedDurationMinutes).toBe(45);
    await ctx
      .http()
      .get(`${API}/courses/${draft}`)
      .set(...bearer(smartphone.accessToken))
      .expect(404);
    await ctx
      .http()
      .get(`${API}/courses/${ussd}`)
      .set(...bearer(smartphone.accessToken))
      .expect(404);
  });

  it('respects targeting and facilitator-group assignment', async () => {
    const courseId = await createCourse('ALL_FARMERS', 'Musanze tomatoes');
    const target = await ctx
      .http()
      .post(`${API}/admin/groups`)
      .set(...bearer(admin.accessToken))
      .send({
        name: 'Musanze tomatoes',
        cropId: tomatoId,
        targetAudience: 'ALL_FARMERS',
        location: { province: 'NORTHERN', district: 'Musanze', sector: 'Muhoza' },
        estimatedFarmerCount: 20,
      });
    expect(target.status).toBe(201);
    await publish(courseId, { scope: 'TARGETED', targetingGroupIds: [target.body.id] });

    const outsider = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
    await ctx
      .http()
      .get(`${API}/courses/${courseId}`)
      .set(...bearer(outsider.accessToken))
      .expect(404);

    const group = await ctx
      .http()
      .post(`${API}/facilitator/groups`)
      .set(...bearer(facilitator.accessToken))
      .send({
        name: 'Muhoza growers',
        cropId: tomatoId,
        location: { province: 'NORTHERN', district: 'Musanze', sector: 'Muhoza' },
      });
    expect(group.status).toBe(201);
    await ctx
      .http()
      .post(`${API}/facilitator/groups/${group.body.id}/members`)
      .set(...bearer(facilitator.accessToken))
      .send({ userIds: [smartphone.id] })
      .expect(201);

    await ctx
      .http()
      .get(`${API}/courses/${courseId}`)
      .set(...bearer(smartphone.accessToken))
      .expect(200);

    const elsewhere = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
    await ctx.prisma.userLocation.create({
      data: {
        userId: elsewhere.id,
        province: Province.SOUTHERN,
        district: 'Huye',
        sector: 'Tumba',
      },
    });
    await ctx
      .http()
      .post(`${API}/facilitator/groups/${group.body.id}/members`)
      .set(...bearer(facilitator.accessToken))
      .send({ userIds: [elsewhere.id] })
      .expect(201);
    await ctx
      .http()
      .get(`${API}/courses/${courseId}`)
      .set(...bearer(elsewhere.accessToken))
      .expect(404);
    await ctx
      .http()
      .post(`${API}/facilitator/groups/${group.body.id}/courses`)
      .set(...bearer(facilitator.accessToken))
      .send({ courseId })
      .expect(201);
    await ctx
      .http()
      .get(`${API}/courses/${courseId}`)
      .set(...bearer(elsewhere.accessToken))
      .expect(200);
  });

  it('enrolls a farmer once, tracks progress, and keeps history', async () => {
    const courseId = await createCourse('ALL_FARMERS');
    await publish(courseId);
    const { moduleId, lessonId } = await addLesson(courseId);

    const modules = await ctx
      .http()
      .get(`${API}/courses/${courseId}/modules`)
      .set(...bearer(smartphone.accessToken))
      .expect(200);
    expect(modules.body[0].learningObjectives).toEqual(['Choose a site']);
    const lessons = await ctx
      .http()
      .get(`${API}/modules/${moduleId}/lessons`)
      .set(...bearer(smartphone.accessToken))
      .expect(200);
    expect(lessons.body[0].mainContent).toBeUndefined();
    await ctx
      .http()
      .get(`${API}/lessons/${lessonId}/content`)
      .set(...bearer(smartphone.accessToken))
      .expect(404);

    const enrollment = await ctx
      .http()
      .post(`${API}/courses/${courseId}/enrollments`)
      .set(...bearer(smartphone.accessToken))
      .expect(201);
    expect(enrollment.body.status).toBe('ACTIVE');
    await ctx
      .http()
      .post(`${API}/courses/${courseId}/enrollments`)
      .set(...bearer(smartphone.accessToken))
      .expect(409);
    // Enrolling notifies the learner once; the rejected duplicate does not.
    expect(
      await ctx.prisma.notification.count({
        where: { userId: smartphone.id, templateCode: 'COURSE_ENROLLED' },
      }),
    ).toBe(1);
    await ctx
      .http()
      .post(`${API}/courses/${courseId}/enrollments`)
      .set(...bearer(basic.accessToken))
      .expect(201);

    const content = await ctx
      .http()
      .get(`${API}/lessons/${lessonId}/content`)
      .set(...bearer(smartphone.accessToken))
      .expect(200);
    expect(content.body.mainContent).toBe('Water in the morning.');
    expect(content.body.resources[0].contentRef).toBe('https://cdn.example/nursery.mp4');
    expect(content.body.resources[0].mimeType).toBe('video/mp4');

    await ctx
      .http()
      .put(`${API}/lessons/${lessonId}/progress`)
      .set(...bearer(smartphone.accessToken))
      .send({ progressPercentage: 40, status: 'COMPLETED' })
      .expect(400);
    await ctx
      .http()
      .put(`${API}/lessons/${lessonId}/progress`)
      .set(...bearer(smartphone.accessToken))
      .send({ progressPercentage: 40, channel: 'WEB' })
      .expect(200);
    await ctx
      .http()
      .put(`${API}/lessons/${lessonId}/progress`)
      .set(...bearer(smartphone.accessToken))
      .send({ progressPercentage: 10 })
      .expect(400);

    const session = await ctx
      .http()
      .post(`${API}/learning-sessions`)
      .set(...bearer(smartphone.accessToken))
      .send({ lessonId, channel: 'USSD' })
      .expect(201);
    await ctx
      .http()
      .post(`${API}/learning-sessions`)
      .set(...bearer(smartphone.accessToken))
      .send({ lessonId, channel: 'MOBILE' })
      .expect(409);
    const closed = await ctx
      .http()
      .post(`${API}/learning-sessions/${session.body.id}/complete`)
      .set(...bearer(smartphone.accessToken))
      .expect(200);
    expect(closed.body.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(closed.body.channel).toBe('USSD');

    const done = await ctx
      .http()
      .put(`${API}/lessons/${lessonId}/progress`)
      .set(...bearer(smartphone.accessToken))
      .send({ progressPercentage: 100, channel: 'IVR' })
      .expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.lastChannel).toBe('IVR');
    expect(done.body.timeSpentSeconds).toBe(closed.body.durationSeconds);

    const progress = await ctx
      .http()
      .get(`${API}/enrollments/${enrollment.body.id}/progress`)
      .set(...bearer(smartphone.accessToken))
      .expect(200);
    expect(progress.body).toMatchObject({
      totalLessons: 1,
      completedLessons: 1,
      overallCompletionPercentage: 100,
      completedModules: 1,
      courseCompletionStatus: 'COMPLETED',
    });

    const completed = await ctx
      .http()
      .get(`${API}/enrollments/${enrollment.body.id}`)
      .set(...bearer(smartphone.accessToken))
      .expect(200);
    expect(completed.body.status).toBe('COMPLETED');
    expect(completed.body.completedAt).toEqual(expect.any(String));
    expect(completed.body.events.map((event: { toStatus: string }) => event.toStatus)).toEqual([
      'ACTIVE',
      'COMPLETED',
    ]);

    await ctx
      .http()
      .get(`${API}/enrollments/${enrollment.body.id}`)
      .set(...bearer(basic.accessToken))
      .expect(404);
    const facilitatorView = await ctx
      .http()
      .get(`${API}/enrollments`)
      .set(...bearer(facilitator.accessToken))
      .expect(200);
    expect(facilitatorView.body.data).toHaveLength(0);

    const group = await ctx
      .http()
      .post(`${API}/facilitator/groups`)
      .set(...bearer(facilitator.accessToken))
      .send({
        name: 'Progress group',
        cropId: tomatoId,
        location: { province: 'NORTHERN', district: 'Musanze', sector: 'Muhoza' },
      });
    await ctx
      .http()
      .post(`${API}/facilitator/groups/${group.body.id}/members`)
      .set(...bearer(facilitator.accessToken))
      .send({ userIds: [smartphone.id] })
      .expect(201);
    const visible = await ctx
      .http()
      .get(`${API}/enrollments`)
      .set(...bearer(facilitator.accessToken))
      .expect(200);
    expect(visible.body.data.map((row: { userId: string }) => row.userId)).toContain(smartphone.id);

    const suspended = await ctx
      .http()
      .patch(`${API}/enrollments/${enrollment.body.id}/status`)
      .set(...bearer(admin.accessToken))
      .send({ status: 'SUSPENDED', reason: 'Review' })
      .expect(200);
    expect(suspended.body.status).toBe('SUSPENDED');
    await ctx
      .http()
      .get(`${API}/lessons/${lessonId}/content`)
      .set(...bearer(smartphone.accessToken))
      .expect(403);
  });

  it('grades closed questions, holds short answers, and enforces attempts', async () => {
    const courseId = await createCourse('ALL_FARMERS');
    await publish(courseId);
    const { lessonId } = await addLesson(courseId);
    const enrollment = await ctx
      .http()
      .post(`${API}/courses/${courseId}/enrollments`)
      .set(...bearer(smartphone.accessToken))
      .expect(201);

    const assessment = await ctx
      .http()
      .post(`${API}/assessments`)
      .set(...bearer(admin.accessToken))
      .send({
        title: 'Nursery check',
        lessonId,
        passingScore: 50,
        maxAttempts: 2,
        status: 'PUBLISHED',
        questions: [
          {
            text: 'Water in the morning?',
            questionType: 'TRUE_FALSE',
            correctBoolean: true,
            marks: 1,
          },
          {
            text: 'Best mulch?',
            questionType: 'MULTIPLE_CHOICE',
            options: ['Stones', 'Dry grass'],
            correctOptionIndex: 1,
            marks: 1,
          },
          { text: 'Why mulch?', questionType: 'SHORT_ANSWER', marks: 2 },
        ],
      });
    expect(assessment.status).toBe(201);

    const hidden = await ctx
      .http()
      .get(`${API}/assessments/${assessment.body.id}`)
      .set(...bearer(smartphone.accessToken))
      .expect(200);
    expect(hidden.body.questions[0].correctAnswer).toBeUndefined();
    expect(hidden.body.questions[1].options).toHaveLength(2);
    expect(JSON.stringify(hidden.body)).not.toContain('Dry grass is correct');

    const optionId = hidden.body.questions[1].options.find(
      (option: { text: string }) => option.text === 'Dry grass',
    ).id as string;
    const attempt = await ctx
      .http()
      .post(`${API}/assessments/${assessment.body.id}/attempts`)
      .set(...bearer(smartphone.accessToken))
      .expect(201);
    await ctx
      .http()
      .post(`${API}/assessments/${assessment.body.id}/attempts`)
      .set(...bearer(smartphone.accessToken))
      .expect(409);

    const submitted = await ctx
      .http()
      .post(`${API}/assessment-attempts/${attempt.body.id}/submit`)
      .set(...bearer(smartphone.accessToken))
      .send({
        answers: [
          { questionId: hidden.body.questions[0].id, booleanAnswer: true },
          { questionId: hidden.body.questions[1].id, selectedOptionId: optionId },
          { questionId: hidden.body.questions[2].id, textAnswer: 'It keeps the soil moist' },
        ],
      })
      .expect(200);
    expect(submitted.body.status).toBe('PENDING_REVIEW');
    expect(submitted.body.passed).toBeNull();
    expect(submitted.body.score).toBe(2);
    expect(submitted.body.answers[2].awardedMarks).toBeNull();
    expect(submitted.body.answers[0].correctAnswer).toBe(true);

    const group = await ctx
      .http()
      .post(`${API}/facilitator/groups`)
      .set(...bearer(facilitator.accessToken))
      .send({
        name: 'Review group',
        cropId: tomatoId,
        location: { province: 'NORTHERN', district: 'Musanze', sector: 'Muhoza' },
      });
    await ctx
      .http()
      .post(`${API}/facilitator/groups/${group.body.id}/members`)
      .set(...bearer(facilitator.accessToken))
      .send({ userIds: [smartphone.id] })
      .expect(201);
    const reviewed = await ctx
      .http()
      .post(`${API}/assessment-attempts/${attempt.body.id}/review`)
      .set(...bearer(facilitator.accessToken))
      .send({ grades: [{ questionId: hidden.body.questions[2].id, awardedMarks: 2 }] })
      .expect(200);
    expect(reviewed.body.status).toBe('PASSED');
    expect(reviewed.body.percentage).toBe(100);

    // Business events reach the learner's inbox (the group membership happened above).
    const inbox = await ctx.prisma.notification.findMany({
      where: { userId: smartphone.id },
      select: { category: true, templateCode: true },
    });
    expect(inbox).toEqual(
      expect.arrayContaining([
        { category: 'GROUP', templateCode: 'GROUP_MEMBER_ADDED' },
        { category: 'ASSESSMENT', templateCode: 'ASSESSMENT_REVIEWED' },
      ]),
    );

    const second = await ctx
      .http()
      .post(`${API}/assessments/${assessment.body.id}/attempts`)
      .set(...bearer(smartphone.accessToken))
      .expect(201);
    await ctx
      .http()
      .post(`${API}/assessment-attempts/${second.body.id}/submit`)
      .set(...bearer(smartphone.accessToken))
      .send({
        answers: [
          { questionId: hidden.body.questions[0].id, booleanAnswer: false },
          {
            questionId: hidden.body.questions[1].id,
            selectedOptionId: hidden.body.questions[1].options[0].id,
          },
          { questionId: hidden.body.questions[2].id, textAnswer: 'unsure' },
        ],
      })
      .expect(200);
    await ctx
      .http()
      .post(`${API}/assessments/${assessment.body.id}/attempts`)
      .set(...bearer(smartphone.accessToken))
      .expect(409);

    const withdrawn = await ctx
      .http()
      .post(`${API}/enrollments/${enrollment.body.id}/withdraw`)
      .set(...bearer(smartphone.accessToken))
      .expect(200);
    expect(withdrawn.body.status).toBe('WITHDRAWN');
    const again = await ctx
      .http()
      .post(`${API}/courses/${courseId}/enrollments`)
      .set(...bearer(smartphone.accessToken))
      .expect(201);
    expect(again.body.status).toBe('ACTIVE');
    expect(again.body.events.map((event: { toStatus: string }) => event.toStatus)).toContain(
      'WITHDRAWN',
    );
  });
});
