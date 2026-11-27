import { LearningChannel } from '../../src/generated/prisma/client';
import { IVR_GATEWAY_PROVIDERS } from '../../src/modules/ivr/gateway/ivr-gateway.interfaces';
import { RoleCode } from '../../src/modules/roles/rbac.constants';
import {
  IVR_SIGNATURE_HEADER,
  TestIvrGatewayAdapter,
  signIvrBody,
} from '../fixtures/ivr-test-doubles';
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

describe('IVR infrastructure (integration)', () => {
  let ctx: TestContext;
  const adapter = new TestIvrGatewayAdapter();

  beforeAll(async () => {
    process.env.IVR_CALLBACK_SECRET = 'ivr-test-secret';
    ctx = await createTestContext({
      overrides: [{ token: IVR_GATEWAY_PROVIDERS, value: [adapter] }],
    });
  });

  afterAll(async () => ctx.close());

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.prisma.telephonyChannelSetting.update({
      where: { channel: 'IVR' },
      data: { isEnabled: true },
    });
  });

  it('returns a clear audio-unavailable response when no audio provider is registered', async () => {
    const admin = await seedAndLogin(ctx, [RoleCode.Admin]);
    const farmer = await seedUser(ctx.prisma, {
      roles: [RoleCode.BasicPhoneFarmer],
      phoneNumber: '+250788200001',
    });
    const tomatoId = (await ctx.prisma.crop.findUniqueOrThrow({ where: { code: 'TOMATO' } })).id;
    const course = await createCourseFixture(ctx, admin.id, {
        title: 'Tomato basics IVR',
        shortDescription: 'IVR course',
        detailedDescription: 'Tomato learning for basic phones.',
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
    await ctx
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

    const callback = (digits: string) => {
      const body = { sessionId: 'ivr-audio-1', phoneNumber: farmer.phoneNumber, digits };
      return ctx
        .http()
        .post(`${API}/ivr/callback`)
        .set({
          [IVR_SIGNATURE_HEADER]: signIvrBody(body, process.env.IVR_CALLBACK_SECRET as string),
        })
        .send(body);
    };
    expect((await callback('')).body.message).toContain('Kinyarwanda');
    await callback('2');
    await callback('1');
    await callback('1');
    await callback('1');
    await callback('1');
    const unavailable = await callback('1');
    expect(unavailable.status).toBe(200);
    expect(unavailable.body.audioUnavailable).toBe(true);
    expect(unavailable.body.message).toMatch(/Audio is unavailable|Amajwi ntabwo aboneka/);
    expect(
      await ctx.prisma.learningSession.count({
        where: { userId: farmer.id, channel: LearningChannel.IVR },
      }),
    ).toBe(0);
  });
});
