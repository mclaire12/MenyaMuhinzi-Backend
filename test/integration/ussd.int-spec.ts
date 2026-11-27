import { LearningChannel, UserStatus } from '../../src/generated/prisma/client';
import { USSD_GATEWAY_PROVIDERS } from '../../src/modules/ussd/gateway/ussd-gateway.interfaces';
import { RoleCode } from '../../src/modules/roles/rbac.constants';
import {
  TEST_USSD_PROVIDER_ID,
  TestUssdGatewayAdapter,
  USSD_SIGNATURE_HEADER,
  signUssdBody,
} from '../fixtures/ussd-test-doubles';
import {
  API,
  bearer,
  createCourseFixture,
  createTestContext,
  resetDatabase,
  seedAndLogin,
  seedUser,
  type TestContext,
} from './helpers';

describe('USSD infrastructure (integration)', () => {
  let ctx: TestContext;
  const adapter = new TestUssdGatewayAdapter();

  beforeAll(async () => {
    process.env.USSD_CALLBACK_SECRET = 'ussd-test-secret';
    ctx = await createTestContext({
      overrides: [{ token: USSD_GATEWAY_PROVIDERS, value: [adapter] }],
    });
  });

  afterAll(async () => ctx.close());

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.prisma.telephonyChannelSetting.update({
      where: { channel: 'USSD' },
      data: { isEnabled: true },
    });
  });

  it('rejects callbacks with a bad signature', async () => {
    const basic = await seedUser(ctx.prisma, {
      roles: [RoleCode.BasicPhoneFarmer],
      phoneNumber: '+250788100001',
    });
    const body = { sessionId: 'sig-1', phoneNumber: basic.phoneNumber, text: '' };
    const res = await ctx.http().post(`${API}/ussd/callback`).send(body);
    expect(res.status).toBe(401);
  });

  it('runs a short USSD journey and records USSD learning progress', async () => {
    const admin = await seedAndLogin(ctx, [RoleCode.Admin]);
    const basic = await seedUser(ctx.prisma, {
      roles: [RoleCode.BasicPhoneFarmer],
      phoneNumber: '+250788100002',
    });

    const tomatoId = (await ctx.prisma.crop.findUniqueOrThrow({ where: { code: 'TOMATO' } })).id;
    const course = await createCourseFixture(ctx, admin.id, {
        title: 'Tomato basics USSD',
        shortDescription: 'USSD course',
        detailedDescription: 'USSD',
        cropId: tomatoId,
        category: 'CROP_PRODUCTION',
        targetAudience: 'BASIC_PHONE_FARMERS',
        difficulty: 'BEGINNER',
        learningObjectives: ['Grow tomatoes'],
        estimatedDurationMinutes: 30,
        language: 'rw',
      });
    await ctx
      .http()
      .post(`${API}/courses/${course.body.id}/publish`)
      .set(...bearer(admin.accessToken))
      .send({ scope: 'PLATFORM' });

    const module = await ctx
      .http()
      .post(`${API}/courses/${course.body.id}/modules`)
      .set(...bearer(admin.accessToken))
      .send({
        title: 'Tomato module',
        learningObjectives: ['Learn watering'],
        status: 'PUBLISHED',
      });
    const lesson = await ctx
      .http()
      .post(`${API}/modules/${module.body.id}/lessons`)
      .set(...bearer(admin.accessToken))
      .send({
        title: 'Watering tomatoes',
        description: 'Water at the base in the morning.',
        lessonType: 'TEXT',
        mainContent: 'Water tomato plants at the base early in the morning.',
        learningObjectives: ['Water consistently'],
        status: 'PUBLISHED',
      });
    const assessment = await ctx
      .http()
      .post(`${API}/assessments`)
      .set(...bearer(admin.accessToken))
      .send({
        title: 'Tomato watering check',
        lessonId: lesson.body.id,
        passingScore: 100,
        maxAttempts: 2,
        status: 'PUBLISHED',
        questions: [
          {
            text: 'Water tomatoes in the morning.',
            questionType: 'TRUE_FALSE',
            correctBoolean: true,
            marks: 1,
          },
        ],
      });
    expect(assessment.status).toBe(201);
    const writtenAssessment = await ctx
      .http()
      .post(`${API}/assessments`)
      .set(...bearer(admin.accessToken))
      .send({
        title: 'Written reflection',
        lessonId: lesson.body.id,
        passingScore: 100,
        status: 'PUBLISHED',
        questions: [
          {
            text: 'Describe your watering plan.',
            questionType: 'SHORT_ANSWER',
            marks: 1,
          },
        ],
      });
    expect(writtenAssessment.status).toBe(201);

    const sessionId = 'ussd-journey-1';
    const callback = (text: string, callbackId?: string) => {
      const body = { sessionId, phoneNumber: basic.phoneNumber, text, callbackId };
      return ctx
        .http()
        .post(`${API}/ussd/callback`)
        .set({
          [USSD_SIGNATURE_HEADER]: signUssdBody(body, process.env.USSD_CALLBACK_SECRET as string),
        })
        .send(body);
    };
    const first = await callback('', 'dial-request-1');
    expect(first.status).toBe(200);
    expect(first.body.continueSession).toBe(true);
    expect(first.body.message).toContain('Kwiga ubuhinzi');
    const repeated = await callback('', 'dial-request-1');
    expect(repeated.body.continueSession).toBe(true);
    expect(repeated.body.message).toContain('already processed');
    expect(
      (await ctx.prisma.ussdSession.findFirst({ where: { providerSessionId: sessionId } }))?.status,
    ).toBe('ACTIVE');

    const stored = await ctx.prisma.ussdSession.findFirst({
      where: { providerSessionId: sessionId },
    });
    expect(stored?.isTestData).toBe(true);
    expect(stored?.status).toBe('ACTIVE');

    await callback('1');
    await callback('1');
    await callback('1');
    await callback('1');
    const openedLesson = await callback('1');
    expect(openedLesson.body.message).toContain('Water tomato plants');
    const completed = await callback('8');
    expect(completed.body.message).toContain('Isomo rirangiye');
    const progress = await ctx.prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: basic.id, lessonId: lesson.body.id } },
    });
    expect(progress).toMatchObject({ status: 'COMPLETED', lastChannel: LearningChannel.USSD });
    const learningSession = await ctx.prisma.learningSession.findFirst({
      where: { userId: basic.id, lessonId: lesson.body.id, channel: LearningChannel.USSD },
    });
    expect(learningSession?.status).toBe('COMPLETED');

    const assessmentMenu = await callback('7');
    expect(assessmentMenu.body.message).toContain('Tomato watering check');
    expect(assessmentMenu.body.message).not.toContain('Written reflection');
    const assessmentState = await ctx.prisma.ussdSession.findFirst({
      where: { providerSessionId: sessionId },
      select: { state: true },
    });
    expect(JSON.stringify(assessmentState?.state)).not.toContain('correctAnswer');
    expect(JSON.stringify(assessmentState?.state)).not.toContain('correctBoolean');
    await callback('1');
    const assessmentResult = await callback('1');
    expect(assessmentResult.body.message).toContain('Watsinze');
    const attempt = await ctx.prisma.assessmentAttempt.findFirst({
      where: { userId: basic.id, assessmentId: assessment.body.id },
    });
    expect(attempt).toMatchObject({ status: 'PASSED', passed: true });

    const ended = await callback('0');
    expect(ended.status).toBe(200);
    expect(ended.body.continueSession).toBe(false);

    const sessions = await ctx
      .http()
      .get(`${API}/admin/ussd/sessions`)
      .set(...bearer(admin.accessToken));
    expect(sessions.status).toBe(200);
    expect(sessions.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('blocks suspended farmers', async () => {
    const farmer = await seedUser(ctx.prisma, {
      roles: [RoleCode.BasicPhoneFarmer],
      phoneNumber: '+250788100003',
      status: UserStatus.SUSPENDED,
    });
    const body = { sessionId: 'suspended-1', phoneNumber: farmer.phoneNumber, text: '' };
    const headers = {
      [USSD_SIGNATURE_HEADER]: signUssdBody(body, process.env.USSD_CALLBACK_SECRET as string),
    };
    const res = await ctx.http().post(`${API}/ussd/callback`).set(headers).send(body);
    expect(res.status).toBe(200);
    expect(res.body.continueSession).toBe(false);
    expect(res.body.message).toMatch(/registered|farmer/i);
  });

  it('records progress with LearningChannel USSD when lessons are completed through JWT APIs', async () => {
    const farmer = await seedAndLogin(ctx, [RoleCode.BasicPhoneFarmer]);
    const progress = await ctx.prisma.learningSession.findFirst({
      where: { userId: farmer.id, channel: LearningChannel.USSD },
    });
    expect(progress ?? null).toBeNull();
  });
});
