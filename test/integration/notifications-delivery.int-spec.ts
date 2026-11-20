/*
 * Delivery behaviour with a TEST provider registered. The provider only records the messages it is
 * given: nothing is sent to a real recipient and no network request is made. These tests prove the
 * dispatcher, retries and status rules; they do not prove any real SMS, email or push integration.
 */
import { NotificationDeliveryStatus } from '../../src/generated/prisma/client';
import { QueueName } from '../../src/infrastructure/queue/queue.constants';
import { NotificationDispatcher } from '../../src/modules/notifications/delivery/notification-dispatcher.service';
import { NotificationEvent } from '../../src/modules/notifications/events/notification-events';
import { NOTIFICATION_PROVIDERS } from '../../src/modules/notifications/providers/notification-provider.interfaces';
import { NotificationPublisher } from '../../src/modules/notifications/publishing/notification-publisher.service';
import { RoleCode } from '../../src/modules/roles/rbac.constants';
import {
  permanentError,
  retryableError,
  TEST_NOTIFICATION_PROVIDER_ID,
  TestNotificationProvider,
} from '../fixtures/notification-test-doubles';
import {
  API,
  bearer,
  createTestContext,
  drainNotificationQueue,
  login,
  resetDatabase,
  seedAndLogin,
  seedUser,
  skipQueuedNotificationJobs,
  type LoginResult,
  type SeededUser,
  type TestContext,
} from './helpers';

const provider = new TestNotificationProvider();

describe('Notification delivery with a test provider (integration)', () => {
  let ctx: TestContext;
  let publisher: NotificationPublisher;
  let admin: SeededUser & LoginResult;
  let farmer: SeededUser & LoginResult;
  let basicFarmer: SeededUser & LoginResult;

  beforeAll(async () => {
    ctx = await createTestContext({
      overrides: [{ token: NOTIFICATION_PROVIDERS, value: [provider] }],
    });
    publisher = ctx.app.get(NotificationPublisher);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    provider.reset();
    skipQueuedNotificationJobs(ctx);
    admin = await seedAndLogin(ctx, [RoleCode.Admin]);
    farmer = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
    basicFarmer = await seedAndLogin(ctx, [RoleCode.BasicPhoneFarmer]);
  });

  const get = (path: string, token: string) =>
    ctx
      .http()
      .get(`${API}${path}`)
      .set(...bearer(token));
  const post = (path: string, token: string, body: object = {}) =>
    ctx
      .http()
      .post(`${API}${path}`)
      .set(...bearer(token))
      .send(body);
  const patch = (path: string, token: string, body: object) =>
    ctx
      .http()
      .patch(`${API}${path}`)
      .set(...bearer(token))
      .send(body);

  const queue = () => ctx.queues[QueueName.NotificationDelivery];
  const dispatcher = () => ctx.app.get(NotificationDispatcher);

  async function enable(...channels: string[]): Promise<void> {
    for (const channel of channels) {
      await patch(`/admin/notifications/channels/${channel}`, admin.accessToken, {
        isEnabled: true,
      }).expect(200);
    }
  }

  const enrolledNotice = (userId: string) =>
    publisher.notifyEvent(NotificationEvent.CourseEnrolled, userId, {
      courseTitle: 'Tomato basics',
    });

  const deliveryOf = (userId: string, channel: string) =>
    ctx.prisma.notificationDelivery.findFirstOrThrow({
      where: { channel: channel as never, notification: { userId } },
    });

  /** Creates and activates an English template of the same code for each channel. */
  async function createFieldDayTemplates(channels: string[]): Promise<void> {
    for (const channel of channels) {
      const created = await post('/admin/notifications/templates', admin.accessToken, {
        code: 'FIELD_DAY_REMINDER',
        channel,
        language: 'en',
        name: `Field day ${channel}`,
        category: 'GENERAL',
        ...(channel === 'SMS' ? {} : { subject: 'Field day on {{date}}' }),
        body: 'Hello {{fullName}}, the field day is on {{date}}.',
        variables: [
          { name: 'fullName', type: 'string', required: true },
          { name: 'date', type: 'date', required: true },
        ],
      }).expect(201);
      await post(
        `/admin/notifications/templates/${created.body.id}/activate`,
        admin.accessToken,
      ).expect(200);
    }
  }

  const fieldDay = (userId: string, channels: ('SMS' | 'EMAIL' | 'PUSH')[]) =>
    publisher.notify({
      userId,
      category: 'GENERAL',
      templateCode: 'FIELD_DAY_REMINDER',
      channels,
      variables: (recipient) => ({ fullName: recipient.fullName, date: '2026-12-01' }),
    });

  describe('channel availability', () => {
    it('lets administrators enable channels once a provider is registered', async () => {
      const before = await get('/admin/notifications/channels', admin.accessToken).expect(200);
      const sms = before.body.find((c: { channel: string }) => c.channel === 'SMS');
      expect(sms).toMatchObject({
        providerRegistered: true,
        isTestProvider: true,
        providerId: TEST_NOTIFICATION_PROVIDER_ID,
        isEnabled: false,
        isAvailable: false,
      });

      const enabled = await patch('/admin/notifications/channels/SMS', admin.accessToken, {
        isEnabled: true,
      }).expect(200);
      expect(enabled.body).toMatchObject({ isEnabled: true, isAvailable: true });
    });

    it('lets users turn on SMS and USSD only once available, and never unsupported channels', async () => {
      await patch('/notification-preferences', basicFarmer.accessToken, {
        channels: [{ channel: 'USSD', enabled: true }],
      }).expect(400);

      await enable('SMS', 'USSD', 'PUSH');
      const ok = await patch('/notification-preferences', basicFarmer.accessToken, {
        channels: [
          { channel: 'SMS', enabled: true },
          { channel: 'USSD', enabled: true },
        ],
      }).expect(200);
      const byChannel = Object.fromEntries(
        ok.body.channels.map((c: { channel: string }) => [c.channel, c]),
      );
      expect(byChannel.SMS).toMatchObject({ available: true, active: true });
      expect(byChannel.USSD).toMatchObject({ available: true, active: true });
      expect(byChannel.PUSH).toBeUndefined();
      expect(byChannel.EMAIL).toBeUndefined();

      // A basic phone does not support push even though an administrator enabled it.
      await patch('/notification-preferences', basicFarmer.accessToken, {
        channels: [{ channel: 'PUSH', enabled: true }],
      }).expect(400);
    });
  });

  describe('sending', () => {
    it('hands an SMS to the provider and records SENT, not DELIVERED', async () => {
      await enable('SMS');
      await enrolledNotice(farmer.id);

      const sms = await deliveryOf(farmer.id, 'SMS');
      expect(sms.status).toBe(NotificationDeliveryStatus.QUEUED);
      expect(queue().add).toHaveBeenCalledTimes(1);
      expect(queue().add).toHaveBeenCalledWith(
        'deliver',
        { deliveryId: sms.id },
        expect.objectContaining({ jobId: sms.id, attempts: expect.any(Number) }),
      );

      const outcomes = await drainNotificationQueue(ctx);
      expect(outcomes).toEqual([{ deliveryId: sms.id, status: 'SENT', reasonCode: null }]);

      const stored = await deliveryOf(farmer.id, 'SMS');
      expect(stored).toMatchObject({
        status: 'SENT',
        providerId: TEST_NOTIFICATION_PROVIDER_ID,
        providerMessageId: 'test-message-1',
        isTestData: true,
        attempts: 1,
        reasonCode: null,
        deliveredAt: null,
      });
      expect(stored.sentAt).not.toBeNull();

      expect(provider.sent).toHaveLength(1);
      expect(provider.sent[0]).toMatchObject({
        channel: 'SMS',
        recipient: { userId: farmer.id, phoneNumber: farmer.phoneNumber },
      });
      expect(provider.sent[0].body).toContain('Tomato basics');

      // Users see an honest status and no provider identifiers.
      const notification = await ctx.prisma.notification.findFirstOrThrow({
        where: { userId: farmer.id },
      });
      const detail = await get(`/notifications/${notification.id}`, farmer.accessToken).expect(200);
      const smsStatus = detail.body.deliveries.find(
        (d: { channel: string }) => d.channel === 'SMS',
      );
      expect(smsStatus).toMatchObject({ status: 'SENT', isTestData: true });
      expect(smsStatus.note).toMatch(/nothing was sent to a real recipient/);
      expect(JSON.stringify(detail.body)).not.toMatch(/test-message-1/);
    });

    it('sends SMS to basic-phone farmers and skips push they do not support', async () => {
      await enable('SMS', 'PUSH');
      await enrolledNotice(basicFarmer.id);
      await drainNotificationQueue(ctx);

      expect(await deliveryOf(basicFarmer.id, 'SMS')).toMatchObject({ status: 'SENT' });
      expect(await deliveryOf(basicFarmer.id, 'PUSH')).toMatchObject({
        status: 'SKIPPED',
        reasonCode: 'NOTIFICATION_CHANNEL_NOT_SUPPORTED',
      });
      expect(provider.sent.map((m) => m.recipient.phoneNumber)).toEqual([basicFarmer.phoneNumber]);
    });

    it('retries after a retryable provider error and then sends', async () => {
      await enable('SMS');
      provider.failWith(retryableError('temporary outage for 0788000000'), { channel: 'SMS' });
      await enrolledNotice(farmer.id);
      const sms = await deliveryOf(farmer.id, 'SMS');

      const [first] = await drainNotificationQueue(ctx, { attempt: 1 });
      expect(first).toBeInstanceOf(Error);
      // The provider's own message is not passed on.
      expect((first as Error).message).not.toMatch(/0788000000/);
      expect(await deliveryOf(farmer.id, 'SMS')).toMatchObject({
        status: 'QUEUED',
        attempts: 1,
        reasonCode: 'NOTIFICATION_PROVIDER_ERROR',
        sentAt: null,
      });

      const second = await dispatcher().execute(sms.id, { attempt: 2, maxAttempts: 3 });
      expect(second).toMatchObject({ status: 'SENT', reasonCode: null });
      expect(await deliveryOf(farmer.id, 'SMS')).toMatchObject({
        status: 'SENT',
        attempts: 2,
        reasonCode: null,
      });
      expect(provider.sent).toHaveLength(1);
    });

    it('fails permanently on a permanent provider error without storing its message', async () => {
      await enable('SMS');
      provider.failWith(permanentError('rejected number 0788000000'), { channel: 'SMS' });
      await enrolledNotice(farmer.id);

      const [outcome] = await drainNotificationQueue(ctx);
      expect(outcome).toMatchObject({
        status: 'FAILED',
        reasonCode: 'NOTIFICATION_PROVIDER_ERROR',
      });
      const stored = await deliveryOf(farmer.id, 'SMS');
      expect(stored).toMatchObject({ status: 'FAILED', sentAt: null, providerMessageId: null });
      expect(stored.failedAt).not.toBeNull();
      expect(JSON.stringify(stored)).not.toMatch(/rejected number/);
      expect(provider.sent).toHaveLength(0);
    });

    it('fails when a retryable error happens on the last attempt', async () => {
      await enable('SMS');
      provider.failWith(retryableError(), { channel: 'SMS' });
      await enrolledNotice(farmer.id);
      const sms = await deliveryOf(farmer.id, 'SMS');

      const outcome = await dispatcher().execute(sms.id, { attempt: 3, maxAttempts: 3 });
      expect(outcome).toMatchObject({
        status: 'FAILED',
        reasonCode: 'NOTIFICATION_PROVIDER_ERROR',
      });
    });

    it('sends once even when the same job runs twice', async () => {
      await enable('SMS');
      await enrolledNotice(farmer.id);
      const sms = await deliveryOf(farmer.id, 'SMS');

      await drainNotificationQueue(ctx);
      const again = await dispatcher().execute(sms.id, { attempt: 1, maxAttempts: 3 });
      expect(again).toMatchObject({ status: 'SENT', skipped: true });
      expect(provider.sent).toHaveLength(1);
      expect((await deliveryOf(farmer.id, 'SMS')).attempts).toBe(1);
    });

    it('keeps channels independent: one failing channel does not affect the others', async () => {
      await enable('SMS', 'EMAIL');
      await createFieldDayTemplates(['IN_APP', 'SMS', 'EMAIL']);
      const withEmail = await seedUser(ctx.prisma, {
        roles: [RoleCode.SmartphoneFarmer],
        email: 'emma@example.com',
      });
      const emailSession = await login(ctx, withEmail.phoneNumber);

      // No address on file: email is skipped at planning time; SMS still goes out.
      await ctx.prisma.user.update({ where: { id: farmer.id }, data: { email: null } });
      const noAddress = await fieldDay(farmer.id, ['SMS', 'EMAIL']);
      expect(noAddress).toMatchObject({
        status: 'CREATED',
        deliveries: [
          { channel: 'IN_APP', status: 'DELIVERED' },
          { channel: 'SMS', status: 'QUEUED' },
          { channel: 'EMAIL', status: 'SKIPPED', reasonCode: 'NOTIFICATION_NO_ADDRESS' },
        ],
      });

      await drainNotificationQueue(ctx);
      expect(await deliveryOf(farmer.id, 'SMS')).toMatchObject({ status: 'SENT' });

      provider.failWith(permanentError(), { channel: 'SMS' });
      await fieldDay(withEmail.id, ['SMS', 'EMAIL']);
      await drainNotificationQueue(ctx);

      expect(await deliveryOf(withEmail.id, 'IN_APP')).toMatchObject({ status: 'DELIVERED' });
      expect(await deliveryOf(withEmail.id, 'EMAIL')).toMatchObject({
        status: 'SENT',
        isTestData: true,
      });
      expect(await deliveryOf(withEmail.id, 'SMS')).toMatchObject({ status: 'FAILED' });
      const email = provider.sent.find((m) => m.channel === 'EMAIL');
      expect(email).toMatchObject({
        subject: 'Field day on 2026-12-01',
        recipient: { email: 'emma@example.com' },
      });
      // The notification stays in the inbox regardless.
      const inbox = await get('/notifications', emailSession.accessToken).expect(200);
      expect(inbox.body.meta.total).toBe(1);
    });

    it('skips channels without an active template without blocking the others', async () => {
      await enable('SMS', 'PUSH');
      await enrolledNotice(farmer.id);
      expect(await deliveryOf(farmer.id, 'PUSH')).toMatchObject({
        status: 'SKIPPED',
        reasonCode: 'NOTIFICATION_TEMPLATE_MISSING',
      });
      expect(await deliveryOf(farmer.id, 'SMS')).toMatchObject({ status: 'QUEUED' });
    });
  });

  describe('policy at delivery time', () => {
    it("respects a user's channel opt-out", async () => {
      await enable('SMS');
      await patch('/notification-preferences', farmer.accessToken, {
        channels: [{ channel: 'SMS', enabled: false }],
      }).expect(200);
      await enrolledNotice(farmer.id);

      expect(await deliveryOf(farmer.id, 'SMS')).toMatchObject({
        status: 'SKIPPED',
        reasonCode: 'NOTIFICATION_CHANNEL_DISABLED_BY_USER',
      });
      expect(queue().add).not.toHaveBeenCalled();
      expect(provider.sent).toHaveLength(0);
    });

    it('skips a queued delivery when an administrator disables the channel', async () => {
      await enable('SMS');
      await enrolledNotice(farmer.id);
      await patch('/admin/notifications/channels/SMS', admin.accessToken, {
        isEnabled: false,
      }).expect(200);

      const [outcome] = await drainNotificationQueue(ctx);
      expect(outcome).toMatchObject({
        status: 'SKIPPED',
        reasonCode: 'NOTIFICATION_CHANNEL_DISABLED',
      });
      expect(provider.sent).toHaveLength(0);
    });

    it('skips channels a category does not allow', async () => {
      await enable('SMS');
      await patch('/admin/notifications/categories/COURSE', admin.accessToken, {
        allowedChannels: ['IN_APP', 'PUSH'],
      }).expect(200);
      await enrolledNotice(farmer.id);

      expect(await deliveryOf(farmer.id, 'SMS')).toMatchObject({
        status: 'SKIPPED',
        reasonCode: 'NOTIFICATION_CHANNEL_NOT_ALLOWED_FOR_CATEGORY',
      });
      expect(queue().add).not.toHaveBeenCalled();
    });

    it('delays non-essential messages during quiet hours but not essential ones', async () => {
      await enable('SMS');
      // A two-hour window around the current time in Africa/Kigali (UTC+2, no daylight saving).
      const kigali = new Date(Date.now() + 2 * 3_600_000);
      const hour = kigali.getUTCHours();
      const minute = String(kigali.getUTCMinutes()).padStart(2, '0');
      const at = (h: number) => `${String((h + 24) % 24).padStart(2, '0')}:${minute}`;
      await patch('/notification-preferences', farmer.accessToken, {
        timeZone: 'Africa/Kigali',
        quietHours: { enabled: true, start: at(hour - 1), end: at(hour + 1) },
      }).expect(200);

      await enrolledNotice(farmer.id);
      const routine = await deliveryOf(farmer.id, 'SMS');
      const routineOptions = queue().add.mock.calls[0][2] as { delay?: number };
      expect(routineOptions.delay).toBeGreaterThan(0);
      expect(routineOptions.delay).toBeLessThanOrEqual(3_600_000 + 60_000);
      expect(routine.scheduledFor).not.toBeNull();

      queue().add.mockClear();
      await publisher.notifyEvent(NotificationEvent.PasswordChanged, farmer.id);
      const essential = await ctx.prisma.notificationDelivery.findFirstOrThrow({
        where: { channel: 'SMS', notification: { userId: farmer.id, category: 'SECURITY' } },
      });
      expect(essential.scheduledFor).toBeNull();
      expect(queue().add).toHaveBeenCalledTimes(1);
      expect(queue().add.mock.calls[0][2]).not.toHaveProperty('delay');
    });

    it('keeps the notification when the queue is unavailable and marks the delivery failed', async () => {
      await enable('SMS');
      queue().add.mockRejectedValueOnce(new Error('redis is down'));

      const result = await publisher.notify({
        userId: farmer.id,
        category: 'COURSE',
        templateCode: 'COURSE_ENROLLED',
        channels: ['SMS'],
        variables: { fullName: 'Test', courseTitle: 'Tomato basics' },
      });
      expect(result).toMatchObject({
        status: 'CREATED',
        deliveries: [
          { channel: 'IN_APP', status: 'DELIVERED' },
          { channel: 'SMS', status: 'FAILED', reasonCode: 'NOTIFICATION_QUEUE_UNAVAILABLE' },
        ],
      });
      expect(await deliveryOf(farmer.id, 'SMS')).toMatchObject({
        status: 'FAILED',
        reasonCode: 'NOTIFICATION_QUEUE_UNAVAILABLE',
      });
      const inbox = await get('/notifications', farmer.accessToken).expect(200);
      expect(inbox.body.meta.total).toBe(1);
    });
  });

  describe('administrator view', () => {
    it('separates test-provider deliveries and never shows a real delivery without a provider', async () => {
      await enable('SMS');
      await enrolledNotice(farmer.id);
      await drainNotificationQueue(ctx);

      const test = await get(
        '/admin/notifications/deliveries?isTestData=true',
        admin.accessToken,
      ).expect(200);
      expect(test.body.meta.total).toBe(1);
      expect(test.body.data[0]).toMatchObject({
        channel: 'SMS',
        status: 'SENT',
        providerId: TEST_NOTIFICATION_PROVIDER_ID,
        isTestData: true,
      });
      const real = await get(
        '/admin/notifications/deliveries?isTestData=false',
        admin.accessToken,
      ).expect(200);
      expect(real.body.data.every((d: { channel: string }) => d.channel !== 'SMS')).toBe(true);

      // Only the in-app inbox is ever DELIVERED: external channels stop at SENT.
      expect(
        await ctx.prisma.notificationDelivery.count({
          where: { status: 'DELIVERED', channel: { not: 'IN_APP' } },
        }),
      ).toBe(0);
    });
  });
});
