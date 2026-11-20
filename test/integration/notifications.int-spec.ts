import {
  NotificationCategory,
  NotificationChannel,
  NotificationDeliveryStatus,
  UserStatus,
} from '../../src/generated/prisma/client';
import { QueueName } from '../../src/infrastructure/queue/queue.constants';
import { NotificationDispatcher } from '../../src/modules/notifications/delivery/notification-dispatcher.service';
import { NotificationEvent } from '../../src/modules/notifications/events/notification-events';
import { NotificationAuditAction } from '../../src/modules/notifications/notifications.constants';
import { NotificationPublisher } from '../../src/modules/notifications/publishing/notification-publisher.service';
import { NotificationProviderRegistry } from '../../src/modules/notifications/providers/notification-provider.registry';
import { RoleCode } from '../../src/modules/roles/rbac.constants';
import {
  API,
  bearer,
  createTestContext,
  DEFAULT_PASSWORD,
  localFormat,
  login,
  nextPhone,
  resetDatabase,
  seedAndLogin,
  type LoginResult,
  type SeededUser,
  type TestContext,
} from './helpers';

const ADMIN = `${API}/admin/notifications`;

const smsTemplate = (overrides: Record<string, unknown> = {}) => ({
  code: 'FIELD_DAY_REMINDER',
  channel: 'SMS',
  language: 'en',
  name: 'Field day reminder',
  category: 'GENERAL',
  body: 'Hello {{fullName}}, the field day is on {{date}}.',
  variables: [
    { name: 'fullName', type: 'string', required: true },
    { name: 'date', type: 'date', required: true },
  ],
  ...overrides,
});

const inAppTemplate = (overrides: Record<string, unknown> = {}) => ({
  code: 'FIELD_DAY_REMINDER',
  channel: 'IN_APP',
  language: 'en',
  name: 'Field day reminder (in-app)',
  category: 'GENERAL',
  subject: 'Field day on {{date}}',
  body: 'Hello {{fullName}}, the field day is on {{date}}.',
  variables: [
    { name: 'fullName', type: 'string', required: true },
    { name: 'date', type: 'date', required: true },
  ],
  ...overrides,
});

describe('Notifications foundation without a provider (integration)', () => {
  let ctx: TestContext;
  let admin: SeededUser & LoginResult;
  let facilitator: SeededUser & LoginResult;
  let farmer: SeededUser & LoginResult;
  let basicFarmer: SeededUser & LoginResult;
  let publisher: NotificationPublisher;

  beforeAll(async () => {
    ctx = await createTestContext();
    publisher = ctx.app.get(NotificationPublisher);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.queues[QueueName.NotificationDelivery].add.mockClear();
    admin = await seedAndLogin(ctx, [RoleCode.Admin]);
    facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
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

  /** Publishes a built-in course event to a user. */
  const enrolledNotice = (userId: string, dedupeKey?: string) =>
    publisher.notifyEvent(
      NotificationEvent.CourseEnrolled,
      userId,
      { courseTitle: 'Tomato basics' },
      { dedupeKey },
    );

  const deliveryQueue = () => ctx.queues[QueueName.NotificationDelivery];

  describe('seeded policy', () => {
    it('seeds ten categories with account, approval and security locked as essential', async () => {
      const res = await get('/admin/notifications/categories', admin.accessToken).expect(200);
      expect(res.body.map((c: { category: string }) => c.category).sort()).toEqual(
        Object.values(NotificationCategory).sort(),
      );
      for (const category of ['ACCOUNT', 'ACCOUNT_APPROVAL', 'SECURITY']) {
        expect(res.body.find((c: { category: string }) => c.category === category)).toMatchObject({
          isEssential: true,
          isLocked: true,
          isActive: true,
        });
      }
      expect(res.body.find((c: { category: string }) => c.category === 'COURSE')).toMatchObject({
        isEssential: false,
        isLocked: false,
      });
    });

    it('reports that no provider exists: only the in-app inbox can deliver', async () => {
      const res = await get('/admin/notifications/channels', admin.accessToken).expect(200);
      expect(res.body).toHaveLength(6);
      expect(res.body.find((c: { channel: string }) => c.channel === 'IN_APP')).toMatchObject({
        isEnabled: true,
        isAvailable: true,
        providerRequired: false,
      });
      for (const channel of ['SMS', 'EMAIL', 'PUSH', 'USSD', 'IVR']) {
        expect(res.body.find((c: { channel: string }) => c.channel === channel)).toMatchObject({
          isEnabled: false,
          isAvailable: false,
          providerRequired: true,
          providerRegistered: false,
          providerId: null,
          isTestProvider: false,
        });
      }
      expect(ctx.app.get(NotificationProviderRegistry).canDeliver(NotificationChannel.SMS)).toBe(
        false,
      );
    });

    it('seeds English templates as active and Kinyarwanda drafts that need review', async () => {
      const res = await get(
        '/admin/notifications/templates?q=COURSE_ENROLLED',
        admin.accessToken,
      ).expect(200);
      expect(res.body.meta.total).toBe(4);
      for (const template of res.body.data) {
        expect(template.isSystem).toBe(true);
        expect(template.status).toBe(template.language === 'en' ? 'ACTIVE' : 'DRAFT');
        expect(template.currentVersion.versionNumber).toBe(1);
      }
      const rw = res.body.data.find((t: { language: string }) => t.language === 'rw');
      expect(rw.description).toMatch(/needs review by a Kinyarwanda speaker/);
    });
  });

  describe('access control', () => {
    it('requires authentication', async () => {
      await ctx.http().get(`${API}/notifications`).expect(401);
      await ctx.http().get(`${API}/notification-preferences`).expect(401);
      await ctx.http().get(`${ADMIN}/templates`).expect(401);
    });

    it('keeps administration for administrators', async () => {
      for (const user of [facilitator, farmer, basicFarmer]) {
        await get('/admin/notifications/templates', user.accessToken).expect(403);
        await get('/admin/notifications/categories', user.accessToken).expect(403);
        await get('/admin/notifications/channels', user.accessToken).expect(403);
        await get('/admin/notifications/deliveries', user.accessToken).expect(403);
        await post('/admin/notifications/templates', user.accessToken, smsTemplate()).expect(403);
      }
    });

    it('lets every role read its own notifications and preferences', async () => {
      for (const user of [admin, facilitator, farmer, basicFarmer]) {
        await get('/notifications', user.accessToken).expect(200);
        await get('/notifications/unread-count', user.accessToken).expect(200);
        await get('/notification-preferences', user.accessToken).expect(200);
      }
    });
  });

  describe('creating notifications from business events', () => {
    it('notifies an applicant when an account request is approved', async () => {
      const registered = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({
          accountType: RoleCode.SmartphoneFarmer,
          fullName: 'Uwimana Jeanne',
          phoneNumber: localFormat(nextPhone()),
          password: DEFAULT_PASSWORD,
          location: { province: 'NORTHERN', district: 'Musanze', sector: 'Muhoza' },
        })
        .expect(201);
      await post(
        `/accounts/requests/${registered.body.accountRequestId}/approve`,
        admin.accessToken,
      ).expect(200);

      const notifications = await ctx.prisma.notification.findMany({
        where: { userId: registered.body.user.id },
        include: { deliveries: true },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({
        category: 'ACCOUNT_APPROVAL',
        templateCode: 'ACCOUNT_APPROVED',
        isEssential: true,
        entityType: 'account-request',
        title: 'Your account has been approved',
        // The account language is Kinyarwanda but only the English template is active; the language used is recorded.
        language: 'en',
      });
      expect(notifications[0].body).toContain('Uwimana Jeanne');
    });

    it('records each channel separately and never reports external delivery without a provider', async () => {
      await enrolledNotice(farmer.id);
      const [notification] = await ctx.prisma.notification.findMany({
        where: { userId: farmer.id },
        include: { deliveries: true },
      });
      const byChannel = Object.fromEntries(notification.deliveries.map((d) => [d.channel, d]));
      expect(Object.keys(byChannel).sort()).toEqual(['IN_APP', 'PUSH', 'SMS']);
      expect(byChannel.IN_APP).toMatchObject({ status: 'DELIVERED', providerId: 'in-app' });
      for (const channel of ['SMS', 'PUSH']) {
        expect(byChannel[channel]).toMatchObject({
          status: 'SKIPPED',
          reasonCode: 'NOTIFICATION_CHANNEL_DISABLED',
          providerId: null,
          sentAt: null,
          deliveredAt: null,
        });
      }
      expect(deliveryQueue().add).not.toHaveBeenCalled();
      expect(
        await ctx.prisma.notificationDelivery.count({
          where: { status: { in: ['SENT', 'DELIVERED'] }, channel: { not: 'IN_APP' } },
        }),
      ).toBe(0);
    });

    it('does not offer email or push to basic-phone farmers', async () => {
      await publisher.notifyEvent(NotificationEvent.PasswordChanged, basicFarmer.id);
      const deliveries = await ctx.prisma.notificationDelivery.findMany({
        where: { notification: { userId: basicFarmer.id } },
      });
      const byChannel = Object.fromEntries(deliveries.map((d) => [d.channel, d.reasonCode]));
      expect(byChannel).toMatchObject({
        SMS: 'NOTIFICATION_CHANNEL_DISABLED',
        EMAIL: 'NOTIFICATION_CHANNEL_NOT_SUPPORTED',
        PUSH: 'NOTIFICATION_CHANNEL_NOT_SUPPORTED',
      });
    });

    it('notifies about a password change without exposing the password', async () => {
      await post('/auth/change-password', farmer.accessToken, {
        currentPassword: DEFAULT_PASSWORD,
        newPassword: 'Ibihingwa2027',
      }).expect(204);
      const session = await login(ctx, farmer.phoneNumber, 'Ibihingwa2027');

      const list = await get('/notifications', session.accessToken).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({
        category: 'SECURITY',
        isEssential: true,
        isRead: false,
      });
      expect(JSON.stringify(list.body)).not.toMatch(/Ibihingwa2027|Umuhinzi2026/);
      const stored = await ctx.prisma.notificationDelivery.findMany({
        where: { notification: { userId: farmer.id } },
      });
      expect(JSON.stringify(stored)).not.toMatch(/Ibihingwa2027|Umuhinzi2026/);
    });

    it('notifies about account status changes', async () => {
      await patch(`/users/${farmer.id}/status`, admin.accessToken, {
        status: UserStatus.SUSPENDED,
        reason: 'Repeated misleading advice',
      }).expect(200);
      await patch(`/users/${farmer.id}/status`, admin.accessToken, {
        status: UserStatus.ACTIVE,
      }).expect(200);
      const codes = (
        await ctx.prisma.notification.findMany({
          where: { userId: farmer.id },
          orderBy: { createdAt: 'asc' },
        })
      ).map((n) => n.templateCode);
      expect(codes).toEqual(['ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED']);
    });

    it('is idempotent for a repeated dedupe key', async () => {
      const first = await publisher.notify({
        userId: farmer.id,
        category: 'COURSE',
        templateCode: NotificationEvent.CourseEnrolled.code,
        variables: { courseTitle: 'Tomato basics' },
        dedupeKey: 'enrollment:1',
      });
      const second = await publisher.notify({
        userId: farmer.id,
        category: 'COURSE',
        templateCode: NotificationEvent.CourseEnrolled.code,
        variables: { courseTitle: 'Tomato basics' },
        dedupeKey: 'enrollment:1',
      });
      expect(first.status).toBe('CREATED');
      expect(second).toEqual({
        status: 'DUPLICATE',
        notificationId: (first as { notificationId: string }).notificationId,
      });
      expect(await ctx.prisma.notification.count({ where: { userId: farmer.id } })).toBe(1);
    });

    it('suppresses instead of failing for unknown users, missing templates and invalid variables', async () => {
      expect(
        await publisher.notify({
          userId: '00000000-0000-4000-8000-000000000000',
          category: 'COURSE',
          templateCode: 'COURSE_ENROLLED',
        }),
      ).toEqual({ status: 'SUPPRESSED', reason: 'USER_NOT_FOUND' });
      expect(
        await publisher.notify({
          userId: farmer.id,
          category: 'COURSE',
          templateCode: 'NO_SUCH_TEMPLATE',
        }),
      ).toEqual({ status: 'SUPPRESSED', reason: 'TEMPLATE_MISSING' });
      expect(
        await publisher.notify({
          userId: farmer.id,
          category: 'COURSE',
          templateCode: 'COURSE_ENROLLED',
          variables: { courseTitle: 42 as unknown as string },
        }),
      ).toEqual({ status: 'SUPPRESSED', reason: 'TEMPLATE_VARIABLES_INVALID' });
      expect(await ctx.prisma.notification.count()).toBe(0);
    });

    it('never throws from notifyEvent, so a business operation cannot fail because of a notification', async () => {
      await expect(
        publisher.notifyEvent(
          NotificationEvent.CourseEnrolled,
          '00000000-0000-4000-8000-000000000000',
        ),
      ).resolves.toBeUndefined();
      await expect(
        publisher.notifyEvent(NotificationEvent.CourseEnrolled, 'not-a-uuid'),
      ).resolves.toBeUndefined();
    });
  });

  describe('my notifications', () => {
    it('lists, reads and counts notifications, newest first', async () => {
      await enrolledNotice(farmer.id);
      await publisher.notifyEvent(NotificationEvent.GroupMemberAdded, farmer.id, {
        groupName: 'Kinigi group',
      });
      await publisher.notifyEvent(NotificationEvent.PasswordChanged, farmer.id);

      const list = await get('/notifications', farmer.accessToken).expect(200);
      expect(list.body.meta.total).toBe(3);
      expect(list.body.data.map((n: { category: string }) => n.category)).toEqual([
        'SECURITY',
        'GROUP',
        'COURSE',
      ]);

      const count = await get('/notifications/unread-count', farmer.accessToken).expect(200);
      expect(count.body.total).toBe(3);
      expect(count.body.byCategory).toEqual(
        expect.arrayContaining([
          { category: 'SECURITY', count: 1 },
          { category: 'GROUP', count: 1 },
          { category: 'COURSE', count: 1 },
        ]),
      );

      const onlyCourse = await get('/notifications?category=COURSE', farmer.accessToken).expect(
        200,
      );
      expect(onlyCourse.body.data).toHaveLength(1);

      const page = await get('/notifications?limit=2&page=2', farmer.accessToken).expect(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta).toMatchObject({ total: 3, totalPages: 2 });
    });

    it('marks one notification read and unread', async () => {
      await enrolledNotice(farmer.id);
      const id = (await get('/notifications', farmer.accessToken)).body.data[0].id;

      const read = await post(`/notifications/${id}/read`, farmer.accessToken).expect(200);
      expect(read.body.isRead).toBe(true);
      const readAt = read.body.readAt;
      expect((await get('/notifications/unread-count', farmer.accessToken)).body.total).toBe(0);
      expect((await get('/notifications?read=false', farmer.accessToken)).body.data).toHaveLength(
        0,
      );
      expect((await get('/notifications?read=true', farmer.accessToken)).body.data).toHaveLength(1);

      const again = await post(`/notifications/${id}/read`, farmer.accessToken).expect(200);
      expect(again.body.readAt).toBe(readAt);

      const unread = await post(`/notifications/${id}/unread`, farmer.accessToken).expect(200);
      expect(unread.body).toMatchObject({ isRead: false, readAt: null });
      expect((await get('/notifications/unread-count', farmer.accessToken)).body.total).toBe(1);
    });

    it('marks everything read, optionally for one category', async () => {
      await enrolledNotice(farmer.id);
      await publisher.notifyEvent(NotificationEvent.GroupMemberAdded, farmer.id, {
        groupName: 'G',
      });
      await publisher.notifyEvent(NotificationEvent.GroupMemberAdded, farmer.id, {
        groupName: 'H',
      });

      const some = await post('/notifications/read-all', farmer.accessToken, {
        category: 'GROUP',
      }).expect(200);
      expect(some.body.updated).toBe(2);
      expect((await get('/notifications/unread-count', farmer.accessToken)).body.total).toBe(1);

      const rest = await post('/notifications/read-all', farmer.accessToken).expect(200);
      expect(rest.body.updated).toBe(1);
      expect((await post('/notifications/read-all', farmer.accessToken)).body.updated).toBe(0);
      await post('/notifications/read-all', farmer.accessToken, { category: 'NOPE' }).expect(400);
    });

    it('archives notifications out of the inbox and the unread count without deleting them', async () => {
      await enrolledNotice(farmer.id);
      const id = (await get('/notifications', farmer.accessToken)).body.data[0].id;
      const archived = await post(`/notifications/${id}/archive`, farmer.accessToken).expect(200);
      expect(archived.body.archivedAt).not.toBeNull();

      expect((await get('/notifications', farmer.accessToken)).body.data).toHaveLength(0);
      expect((await get('/notifications/unread-count', farmer.accessToken)).body.total).toBe(0);
      const list = await get('/notifications?archived=true', farmer.accessToken).expect(200);
      expect(list.body.data.map((n: { id: string }) => n.id)).toEqual([id]);
      expect(await ctx.prisma.notification.count({ where: { id } })).toBe(1);
    });

    it('shows delivery status per channel with a plain explanation', async () => {
      await enrolledNotice(farmer.id);
      const id = (await get('/notifications', farmer.accessToken)).body.data[0].id;
      const detail = await get(`/notifications/${id}`, farmer.accessToken).expect(200);
      expect(detail.body.deliveries.map((d: { channel: string }) => d.channel).sort()).toEqual([
        'IN_APP',
        'PUSH',
        'SMS',
      ]);
      const sms = detail.body.deliveries.find((d: { channel: string }) => d.channel === 'SMS');
      expect(sms).toMatchObject({
        status: 'SKIPPED',
        reasonCode: 'NOTIFICATION_CHANNEL_DISABLED',
        isTestData: false,
      });
      expect(sms.note).toMatch(/not enabled/);
      const inApp = detail.body.deliveries.find((d: { channel: string }) => d.channel === 'IN_APP');
      expect(inApp).toMatchObject({ status: 'DELIVERED' });
      expect(JSON.stringify(detail.body)).not.toMatch(/providerId|providerMessageId/);
    });

    it("hides other users' notifications", async () => {
      await enrolledNotice(farmer.id);
      const id = (await get('/notifications', farmer.accessToken)).body.data[0].id;
      expect((await get('/notifications', basicFarmer.accessToken)).body.data).toHaveLength(0);
      await get(`/notifications/${id}`, basicFarmer.accessToken).expect(404);
      await post(`/notifications/${id}/read`, basicFarmer.accessToken).expect(404);
      await post(`/notifications/${id}/unread`, basicFarmer.accessToken).expect(404);
      await post(`/notifications/${id}/archive`, basicFarmer.accessToken).expect(404);
      await get(`/notifications/${id}`, admin.accessToken).expect(404);
      expect((await get(`/notifications/${id}`, farmer.accessToken)).body.isRead).toBe(false);
    });

    it('validates identifiers and filters', async () => {
      await get('/notifications/not-a-uuid', farmer.accessToken).expect(400);
      await get('/notifications?category=NOPE', farmer.accessToken).expect(400);
      await get('/notifications?read=maybe', farmer.accessToken).expect(400);
      await get('/notifications?limit=1000', farmer.accessToken).expect(400);
    });
  });

  describe('notification preferences', () => {
    it('lists only the channels an account type supports and why each is unavailable', async () => {
      const smartphone = await get('/notification-preferences', farmer.accessToken).expect(200);
      expect(smartphone.body.channels.map((c: { channel: string }) => c.channel)).toEqual([
        'IN_APP',
        'SMS',
        'EMAIL',
        'PUSH',
      ]);
      expect(smartphone.body.channels[0]).toMatchObject({
        channel: 'IN_APP',
        locked: true,
        available: true,
        active: true,
      });
      expect(smartphone.body.channels[1]).toMatchObject({
        channel: 'SMS',
        enabled: true,
        available: false,
        active: false,
        unavailableReasonCode: 'NOTIFICATION_CHANNEL_DISABLED',
      });

      const basic = await get('/notification-preferences', basicFarmer.accessToken).expect(200);
      expect(basic.body.channels.map((c: { channel: string }) => c.channel)).toEqual([
        'IN_APP',
        'SMS',
        'USSD',
        'IVR',
      ]);
      expect(basic.body.accountTypes).toEqual([RoleCode.BasicPhoneFarmer]);
      expect(basic.body).toMatchObject({
        timeZone: 'Africa/Kigali',
        nonEssentialEnabled: true,
        quietHours: { enabled: false, start: null, end: null },
        accountLanguage: 'rw',
        preferredLanguage: null,
        effectiveLanguage: 'rw',
      });
    });

    it('does not require basic-phone farmers to configure email', async () => {
      const res = await patch('/notification-preferences', basicFarmer.accessToken, {
        preferredLanguage: 'en',
      }).expect(200);
      expect(res.body.effectiveLanguage).toBe('en');
      const email = await patch('/notification-preferences', basicFarmer.accessToken, {
        channels: [{ channel: 'EMAIL', enabled: true }],
      }).expect(400);
      expect(email.body.message).toMatch(/EMAIL is not supported for your account type/);
      await patch('/notification-preferences', basicFarmer.accessToken, {
        channels: [{ channel: 'PUSH', enabled: true }],
      }).expect(400);
    });

    it('refuses to enable unavailable channels but always allows turning one off', async () => {
      const enable = await patch('/notification-preferences', farmer.accessToken, {
        channels: [{ channel: 'SMS', enabled: true }],
      }).expect(400);
      expect(enable.body.message).toMatch(
        /SMS cannot be turned on: This channel is not enabled by an administrator/,
      );

      const disable = await patch('/notification-preferences', farmer.accessToken, {
        channels: [{ channel: 'SMS', enabled: false }],
      }).expect(200);
      expect(
        disable.body.channels.find((c: { channel: string }) => c.channel === 'SMS').enabled,
      ).toBe(false);

      await patch('/notification-preferences', farmer.accessToken, {
        channels: [{ channel: 'IN_APP', enabled: false }],
      }).expect(400);
      await patch('/notification-preferences', farmer.accessToken, {
        channels: [
          { channel: 'SMS', enabled: false },
          { channel: 'SMS', enabled: true },
        ],
      }).expect(400);
    });

    it('explains why email is unavailable', async () => {
      const withEmail = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
      await ctx.prisma.user.update({
        where: { id: withEmail.id },
        data: { email: 'jeanne@example.rw' },
      });
      const without = (
        await get('/notification-preferences', farmer.accessToken)
      ).body.channels.find((c: { channel: string }) => c.channel === 'EMAIL');
      expect(without.unavailableReasonCode).toBe('NOTIFICATION_CHANNEL_DISABLED');
      // Enabled by an administrator but no provider yet: the reason is the provider, not the address.
      await ctx.prisma.notificationChannelSetting.update({
        where: { channel: 'EMAIL' },
        data: { isEnabled: true },
      });
      const noProvider = (
        await get('/notification-preferences', withEmail.accessToken)
      ).body.channels.find((c: { channel: string }) => c.channel === 'EMAIL');
      expect(noProvider).toMatchObject({
        available: false,
        unavailableReasonCode: 'NOTIFICATION_PROVIDER_NOT_CONFIGURED',
      });
    });

    it('keeps essential categories on and lets users opt out of the others', async () => {
      const blocked = await patch('/notification-preferences', farmer.accessToken, {
        categories: [{ category: 'SECURITY', enabled: false }],
      }).expect(400);
      expect(blocked.body.message).toMatch(/essential and cannot be turned off/);
      await patch('/notification-preferences', farmer.accessToken, {
        categories: [{ category: 'ACCOUNT_APPROVAL', enabled: false }],
      }).expect(400);

      const prefs = await patch('/notification-preferences', farmer.accessToken, {
        categories: [{ category: 'COURSE', enabled: false }],
      }).expect(200);
      expect(
        prefs.body.categories.find((c: { category: string }) => c.category === 'COURSE'),
      ).toMatchObject({
        enabled: false,
        locked: false,
      });
      expect(
        prefs.body.categories.find((c: { category: string }) => c.category === 'SECURITY'),
      ).toMatchObject({
        enabled: true,
        isEssential: true,
        locked: true,
      });

      expect(
        await publisher.notify({
          userId: farmer.id,
          category: 'COURSE',
          templateCode: 'COURSE_ENROLLED',
          variables: { courseTitle: 'T' },
        }),
      ).toEqual({
        status: 'SUPPRESSED',
        reason: 'USER_OPTED_OUT',
      });
      await publisher.notifyEvent(NotificationEvent.PasswordChanged, farmer.id);
      expect(await ctx.prisma.notification.count({ where: { userId: farmer.id } })).toBe(1);
    });

    it('honours the account-level switch for non-essential notifications only', async () => {
      await patch('/notification-preferences', farmer.accessToken, {
        nonEssentialEnabled: false,
      }).expect(200);
      await enrolledNotice(farmer.id);
      expect(await ctx.prisma.notification.count({ where: { userId: farmer.id } })).toBe(0);
      await publisher.notifyEvent(NotificationEvent.AccountSuspended, farmer.id);
      expect(await ctx.prisma.notification.count({ where: { userId: farmer.id } })).toBe(1);
    });

    it('validates time zone and quiet hours', async () => {
      await patch('/notification-preferences', farmer.accessToken, {
        timeZone: 'Mars/Olympus',
      }).expect(400);
      await patch('/notification-preferences', farmer.accessToken, {
        quietHours: { enabled: true },
      }).expect(400);
      await patch('/notification-preferences', farmer.accessToken, {
        quietHours: { enabled: true, start: '21:00', end: '21:00' },
      }).expect(400);
      await patch('/notification-preferences', farmer.accessToken, {
        quietHours: { enabled: true, start: '25:00', end: '06:00' },
      }).expect(400);
      await patch('/notification-preferences', farmer.accessToken, {
        quietHours: { enabled: false, start: '9pm' },
      }).expect(400);

      const ok = await patch('/notification-preferences', farmer.accessToken, {
        timeZone: 'Africa/Nairobi',
        quietHours: { enabled: true, start: '21:00', end: '06:00' },
      }).expect(200);
      expect(ok.body).toMatchObject({
        timeZone: 'Africa/Nairobi',
        quietHours: { enabled: true, start: '21:00', end: '06:00' },
      });

      // Turning quiet hours off keeps the saved window for next time.
      const off = await patch('/notification-preferences', farmer.accessToken, {
        quietHours: { enabled: false },
      }).expect(200);
      expect(off.body.quietHours).toEqual({ enabled: false, start: '21:00', end: '06:00' });
    });

    it('rejects unknown fields', async () => {
      await patch('/notification-preferences', farmer.accessToken, { isAdmin: true }).expect(400);
    });

    it('chooses the template language from the preference, falling back to an existing template', async () => {
      // Only English is active, so a Kinyarwanda preference falls back and records the language used.
      await patch('/notification-preferences', farmer.accessToken, {
        preferredLanguage: 'rw',
      }).expect(200);
      await enrolledNotice(farmer.id);
      expect(
        (await ctx.prisma.notification.findFirstOrThrow({ where: { userId: farmer.id } })).language,
      ).toBe('en');

      // An administrator reviews and activates the Kinyarwanda template.
      const rw = (
        await get(
          '/admin/notifications/templates?q=COURSE_ENROLLED&language=rw&channel=IN_APP',
          admin.accessToken,
        )
      ).body.data[0];
      await post(`/admin/notifications/templates/${rw.id}/activate`, admin.accessToken).expect(200);
      await enrolledNotice(farmer.id);
      const latest = await ctx.prisma.notification.findFirstOrThrow({
        where: { userId: farmer.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(latest).toMatchObject({ language: 'rw', title: 'Wiyandikishije mu isomo' });

      // Back to English with null clearing the override to the account language (rw).
      await patch('/notification-preferences', farmer.accessToken, {
        preferredLanguage: 'en',
      }).expect(200);
      await enrolledNotice(farmer.id);
      expect(
        (
          await ctx.prisma.notification.findFirstOrThrow({
            where: { userId: farmer.id },
            orderBy: { createdAt: 'desc' },
          })
        ).language,
      ).toBe('en');
      const cleared = await patch('/notification-preferences', farmer.accessToken, {
        preferredLanguage: null,
      }).expect(200);
      expect(cleared.body).toMatchObject({ preferredLanguage: null, effectiveLanguage: 'rw' });
    });

    it('records preference changes in the audit log', async () => {
      await patch('/notification-preferences', farmer.accessToken, {
        preferredLanguage: 'en',
      }).expect(200);
      const entries = await ctx.prisma.auditLog.findMany({
        where: { action: NotificationAuditAction.PreferencesUpdated },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ actorId: farmer.id, entityId: farmer.id });
    });
  });

  describe('template administration', () => {
    const createTemplate = async (body: object = smsTemplate()) => {
      const res = await post('/admin/notifications/templates', admin.accessToken, body);
      expect(res.status).toBe(201);
      return res.body;
    };

    it('creates a draft template with version 1 and validates its content', async () => {
      const created = await createTemplate();
      expect(created).toMatchObject({
        code: 'FIELD_DAY_REMINDER',
        channel: 'SMS',
        language: 'en',
        category: 'GENERAL',
        status: 'DRAFT',
        isSystem: false,
        latestVersionNumber: 1,
        createdById: admin.id,
        currentVersion: { versionNumber: 1, isCurrent: true, subject: null },
      });
      expect(created.currentVersion.variables).toHaveLength(2);

      const problems = async (overrides: object) => {
        const res = await post(
          '/admin/notifications/templates',
          admin.accessToken,
          smsTemplate({ code: 'OTHER_CODE', ...overrides }),
        );
        expect(res.status).toBe(400);
        return JSON.stringify(res.body.message);
      };
      expect(await problems({ subject: 'Not allowed' })).toMatch(
        /SMS templates cannot have a subject/,
      );
      expect(await problems({ body: 'Hi {{unknown}}' })).toMatch(/has no variable definition/);
      expect(await problems({ body: 'x'.repeat(481), variables: [] })).toMatch(
        /limited to 480 characters/,
      );
      expect(await problems({ body: 'Hi {{fullName' })).toMatch(/unmatched/);
      expect(
        await problems({
          variables: [
            { name: 'fullName', type: 'string', required: true },
            { name: 'fullName', type: 'string', required: false },
            { name: 'date', type: 'date', required: true },
          ],
        }),
      ).toMatch(/defined twice/);
      expect(
        await problems({ variables: [{ name: '1bad', type: 'string', required: true }] }),
      ).toMatch(/name must start with a letter/);
      expect(
        await problems({ variables: [{ name: 'fullName', type: 'object', required: true }] }),
      ).toMatch(/type/);
      const missingSubject = await post(
        '/admin/notifications/templates',
        admin.accessToken,
        inAppTemplate({ subject: undefined }),
      );
      expect(missingSubject.status).toBe(400);
      expect(JSON.stringify(missingSubject.body.message)).toMatch(
        /IN_APP templates need a subject/,
      );
      await post(
        '/admin/notifications/templates',
        admin.accessToken,
        smsTemplate({ code: 'lower case' }),
      ).expect(400);
      await post(
        '/admin/notifications/templates',
        admin.accessToken,
        smsTemplate({ language: 'fr' }),
      ).expect(400);
      await post(
        '/admin/notifications/templates',
        admin.accessToken,
        smsTemplate({ category: 'NOPE' }),
      ).expect(400);
    });

    it('allows one template per code, channel and language and never translates', async () => {
      await createTemplate();
      await post('/admin/notifications/templates', admin.accessToken, smsTemplate()).expect(409);
      const english = await get(
        '/admin/notifications/templates?q=FIELD_DAY_REMINDER',
        admin.accessToken,
      );
      expect(english.body.meta.total).toBe(1);
      // A Kinyarwanda variant is a separate template written by a person.
      await createTemplate(
        smsTemplate({
          language: 'rw',
          body: 'Muraho {{fullName}}, umunsi wo mu murima ni {{date}}.',
        }),
      );
      expect(
        (await get('/admin/notifications/templates?q=FIELD_DAY_REMINDER', admin.accessToken)).body
          .meta.total,
      ).toBe(2);
      expect(
        (await get('/admin/notifications/templates?language=rw&q=FIELD_DAY', admin.accessToken))
          .body.data,
      ).toHaveLength(1);
    });

    it('rejects a channel the category does not allow', async () => {
      await patch('/admin/notifications/categories/GENERAL', admin.accessToken, {
        allowedChannels: ['IN_APP', 'PUSH'],
      }).expect(200);
      const res = await post(
        '/admin/notifications/templates',
        admin.accessToken,
        smsTemplate(),
      ).expect(400);
      expect(res.body.message).toMatch(/does not allow the SMS channel/);
    });

    it('versions templates and keeps the history', async () => {
      const created = await createTemplate();
      const id = created.id;
      const v2 = await post(`/admin/notifications/templates/${id}/versions`, admin.accessToken, {
        body: 'Reminder for {{fullName}}: field day on {{date}}.',
        variables: created.currentVersion.variables,
        changeNote: 'Clearer wording',
      }).expect(201);
      expect(v2.body).toMatchObject({
        versionNumber: 2,
        isCurrent: false,
        changeNote: 'Clearer wording',
      });
      expect(
        (await get(`/admin/notifications/templates/${id}`, admin.accessToken)).body.currentVersion
          .versionNumber,
      ).toBe(1);

      const bad = await post(`/admin/notifications/templates/${id}/versions`, admin.accessToken, {
        body: 'Hi {{nope}}',
        variables: [],
      }).expect(400);
      expect(JSON.stringify(bad.body.message)).toMatch(/no variable definition/);

      const switched = await post(
        `/admin/notifications/templates/${id}/current-version`,
        admin.accessToken,
        { versionId: v2.body.id },
      ).expect(200);
      expect(switched.body.currentVersion.versionNumber).toBe(2);
      await post(`/admin/notifications/templates/${id}/current-version`, admin.accessToken, {
        versionId: '00000000-0000-4000-8000-000000000000',
      }).expect(400);

      const v3 = await post(`/admin/notifications/templates/${id}/versions`, admin.accessToken, {
        body: 'Third {{fullName}} {{date}}',
        variables: created.currentVersion.variables,
        makeCurrent: true,
      }).expect(201);
      expect(v3.body.isCurrent).toBe(true);

      const versions = await get(
        `/admin/notifications/templates/${id}/versions`,
        admin.accessToken,
      ).expect(200);
      expect(versions.body.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([
        3, 2, 1,
      ]);
      await get(
        `/admin/notifications/templates/${id}/versions/${v2.body.id}`,
        admin.accessToken,
      ).expect(200);
      await get(
        `/admin/notifications/templates/${id}/versions/00000000-0000-4000-8000-000000000000`,
        admin.accessToken,
      ).expect(404);

      const history = await get(
        `/admin/notifications/templates/${id}/history`,
        admin.accessToken,
      ).expect(200);
      expect(history.body.versions).toHaveLength(3);
      expect(history.body.audit.map((a: { action: string }) => a.action)).toEqual([
        NotificationAuditAction.TemplateCreated,
        NotificationAuditAction.TemplateVersionAdded,
        NotificationAuditAction.TemplateCurrentVersionSet,
        NotificationAuditAction.TemplateVersionAdded,
      ]);
    });

    it('updates metadata only and activates, deactivates and archives', async () => {
      const { id } = await createTemplate();
      const updated = await patch(`/admin/notifications/templates/${id}`, admin.accessToken, {
        name: 'Renamed',
        description: 'About field days',
      }).expect(200);
      expect(updated.body).toMatchObject({
        name: 'Renamed',
        description: 'About field days',
        code: 'FIELD_DAY_REMINDER',
      });
      await patch(`/admin/notifications/templates/${id}`, admin.accessToken, {
        code: 'NEW_CODE',
      }).expect(400);
      await patch(`/admin/notifications/templates/${id}`, admin.accessToken, {
        language: 'rw',
      }).expect(400);

      expect(
        (await post(`/admin/notifications/templates/${id}/activate`, admin.accessToken)).body
          .status,
      ).toBe('ACTIVE');
      expect(
        (await post(`/admin/notifications/templates/${id}/deactivate`, admin.accessToken)).body
          .status,
      ).toBe('INACTIVE');
      const archived = await post(
        `/admin/notifications/templates/${id}/archive`,
        admin.accessToken,
      ).expect(200);
      expect(archived.body).toMatchObject({ status: 'ARCHIVED', archivedAt: expect.any(String) });

      await post(`/admin/notifications/templates/${id}/activate`, admin.accessToken).expect(409);
      await patch(`/admin/notifications/templates/${id}`, admin.accessToken, {
        name: 'Again',
      }).expect(409);
      await post(`/admin/notifications/templates/${id}/versions`, admin.accessToken, {
        body: 'x',
        variables: [],
      }).expect(409);
      expect(
        (await get(`/admin/notifications/templates/${id}/versions`, admin.accessToken)).body,
      ).toHaveLength(1);
    });

    it('keeps system templates from being archived', async () => {
      const system = (
        await get(
          '/admin/notifications/templates?q=PASSWORD_CHANGED&language=en&channel=SMS',
          admin.accessToken,
        )
      ).body.data[0];
      expect(system.isSystem).toBe(true);
      await post(`/admin/notifications/templates/${system.id}/archive`, admin.accessToken).expect(
        409,
      );
      expect(
        (await post(`/admin/notifications/templates/${system.id}/deactivate`, admin.accessToken))
          .body.status,
      ).toBe('INACTIVE');
    });

    it('uses only active templates for notifications', async () => {
      const inApp = (
        await get(
          '/admin/notifications/templates?q=COURSE_ENROLLED&language=en&channel=IN_APP',
          admin.accessToken,
        )
      ).body.data[0];
      await post(`/admin/notifications/templates/${inApp.id}/deactivate`, admin.accessToken).expect(
        200,
      );
      expect(
        await publisher.notify({
          userId: farmer.id,
          category: 'COURSE',
          templateCode: 'COURSE_ENROLLED',
          variables: { courseTitle: 'T' },
        }),
      ).toEqual({
        status: 'SUPPRESSED',
        reason: 'TEMPLATE_MISSING',
      });
    });

    it('previews with validated variables and sends nothing', async () => {
      const { id } = await createTemplate();
      const ok = await post(`/admin/notifications/templates/${id}/preview`, admin.accessToken, {
        variables: { fullName: 'Aline', date: '2026-12-01' },
      }).expect(200);
      expect(ok.body).toMatchObject({
        channel: 'SMS',
        language: 'en',
        body: 'Hello Aline, the field day is on 2026-12-01.',
        notice: 'Preview only: nothing was sent.',
      });

      const missing = await post(
        `/admin/notifications/templates/${id}/preview`,
        admin.accessToken,
        { variables: { fullName: 'Aline' } },
      ).expect(400);
      expect(missing.body.message).toEqual(['Variable "date" is required']);
      const wrong = await post(`/admin/notifications/templates/${id}/preview`, admin.accessToken, {
        variables: { fullName: 7, date: 'soon' },
      }).expect(400);
      expect(wrong.body.message).toEqual([
        'Variable "fullName" must be text',
        'Variable "date" must be a date',
      ]);
      const unknown = await post(
        `/admin/notifications/templates/${id}/preview`,
        admin.accessToken,
        { variables: { fullName: 'A', date: '2026-12-01', extra: 'x' } },
      ).expect(400);
      expect(unknown.body.message).toEqual(['Unknown variable "extra"']);

      expect(await ctx.prisma.notification.count()).toBe(0);
      expect(deliveryQueue().add).not.toHaveBeenCalled();
    });

    it('lets administrators configure a template for a custom event end to end', async () => {
      const inApp = await createTemplate(inAppTemplate());
      await post(`/admin/notifications/templates/${inApp.id}/activate`, admin.accessToken).expect(
        200,
      );
      const result = await publisher.notify({
        userId: farmer.id,
        category: 'GENERAL',
        templateCode: 'FIELD_DAY_REMINDER',
        variables: { fullName: 'Jeanne', date: new Date('2026-12-01T00:00:00Z') },
        entity: { type: 'event', id: 'field-day-1' },
      });
      expect(result.status).toBe('CREATED');
      const list = await get('/notifications', farmer.accessToken);
      expect(list.body.data[0]).toMatchObject({
        title: 'Field day on 2026-12-01',
        body: 'Hello Jeanne, the field day is on 2026-12-01.',
        entityType: 'event',
        entityId: 'field-day-1',
        isEssential: false,
      });
    });
  });

  describe('category and channel settings', () => {
    it('keeps account, approval and security categories essential and active', async () => {
      for (const category of ['ACCOUNT', 'ACCOUNT_APPROVAL', 'SECURITY']) {
        await patch(`/admin/notifications/categories/${category}`, admin.accessToken, {
          isEssential: false,
        }).expect(409);
        await patch(`/admin/notifications/categories/${category}`, admin.accessToken, {
          isActive: false,
        }).expect(409);
      }
      const ok = await patch('/admin/notifications/categories/SECURITY', admin.accessToken, {
        description: 'Security alerts',
      }).expect(200);
      expect(ok.body).toMatchObject({ isEssential: true, description: 'Security alerts' });
    });

    it('configures optional categories and the inbox is always an allowed channel', async () => {
      await patch('/admin/notifications/categories/COURSE', admin.accessToken, {
        allowedChannels: ['SMS'],
      }).expect(400);
      await patch('/admin/notifications/categories/COURSE', admin.accessToken, {
        allowedChannels: ['IN_APP', 'IN_APP'],
      }).expect(400);
      await patch('/admin/notifications/categories/COURSE', admin.accessToken, {
        allowedChannels: ['IN_APP', 'CARRIER_PIGEON'],
      }).expect(400);
      await patch('/admin/notifications/categories/NOPE', admin.accessToken, {
        isActive: false,
      }).expect(400);

      const essential = await patch('/admin/notifications/categories/COURSE', admin.accessToken, {
        isEssential: true,
      }).expect(200);
      expect(essential.body.isEssential).toBe(true);
      expect(
        (await get('/notification-preferences', farmer.accessToken)).body.categories.find(
          (c: { category: string }) => c.category === 'COURSE',
        ),
      ).toMatchObject({
        isEssential: true,
        locked: true,
      });

      await patch('/admin/notifications/categories/COURSE', admin.accessToken, {
        isEssential: false,
        isActive: false,
      }).expect(200);
      expect(
        await publisher.notify({
          userId: farmer.id,
          category: 'COURSE',
          templateCode: 'COURSE_ENROLLED',
          variables: { courseTitle: 'T' },
        }),
      ).toEqual({
        status: 'SUPPRESSED',
        reason: 'CATEGORY_DISABLED',
      });
    });

    it('does not let a channel be enabled without a provider, and never disables the inbox', async () => {
      for (const channel of ['SMS', 'EMAIL', 'PUSH', 'USSD', 'IVR']) {
        const res = await patch(`/admin/notifications/channels/${channel}`, admin.accessToken, {
          isEnabled: true,
        }).expect(409);
        expect(res.body.message).toMatch(/No provider is registered/);
      }
      await patch('/admin/notifications/channels/IN_APP', admin.accessToken, {
        isEnabled: false,
      }).expect(409);
      await patch('/admin/notifications/channels/IN_APP', admin.accessToken, {
        isEnabled: true,
      }).expect(200);
      await patch('/admin/notifications/channels/SMS', admin.accessToken, {
        isEnabled: false,
      }).expect(200);
      await patch('/admin/notifications/channels/FAX', admin.accessToken, {
        isEnabled: false,
      }).expect(400);
      await patch('/admin/notifications/channels/SMS', admin.accessToken, {}).expect(400);
    });
  });

  describe('delivery without a provider', () => {
    async function queuedSmsDelivery() {
      const notification = await ctx.prisma.notification.create({
        data: {
          userId: farmer.id,
          category: 'COURSE',
          templateCode: 'X',
          title: 't',
          body: 'b',
          language: 'en',
        },
      });
      return ctx.prisma.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          channel: 'SMS',
          status: 'QUEUED',
          language: 'en',
          body: 'hello',
        },
      });
    }

    it('skips a queued delivery whose channel is no longer enabled', async () => {
      const delivery = await queuedSmsDelivery();
      const outcome = await ctx.app
        .get(NotificationDispatcher)
        .execute(delivery.id, { attempt: 1, maxAttempts: 3 });
      expect(outcome).toMatchObject({
        status: 'SKIPPED',
        reasonCode: 'NOTIFICATION_CHANNEL_DISABLED',
      });
      expect(
        await ctx.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ).toMatchObject({
        status: 'SKIPPED',
        providerId: null,
        sentAt: null,
      });
    });

    it('fails permanently with provider-not-configured and does not retry', async () => {
      await ctx.prisma.notificationChannelSetting.update({
        where: { channel: 'SMS' },
        data: { isEnabled: true },
      });
      const delivery = await queuedSmsDelivery();
      const dispatcher = ctx.app.get(NotificationDispatcher);
      const outcome = await dispatcher.execute(delivery.id, { attempt: 1, maxAttempts: 3 });
      expect(outcome).toMatchObject({
        status: 'FAILED',
        reasonCode: 'NOTIFICATION_PROVIDER_NOT_CONFIGURED',
      });
      const stored = await ctx.prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      });
      expect(stored).toMatchObject({
        status: 'FAILED',
        providerId: null,
        sentAt: null,
        deliveredAt: null,
        isTestData: false,
      });
      expect(stored.failedAt).not.toBeNull();

      // A repeated or late job does nothing.
      const again = await dispatcher.execute(delivery.id, { attempt: 2, maxAttempts: 3 });
      expect(again).toMatchObject({ status: 'FAILED', skipped: true });
    });

    it('lets administrators review deliveries without message text', async () => {
      await enrolledNotice(farmer.id);
      await enrolledNotice(basicFarmer.id);
      const all = await get('/admin/notifications/deliveries', admin.accessToken).expect(200);
      expect(all.body.meta.total).toBe(6);
      expect(JSON.stringify(all.body)).not.toMatch(/Tomato basics/);
      expect(all.body.data[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          notificationId: expect.any(String),
          userId: expect.any(String),
          attempts: expect.any(Number),
          templateCode: 'COURSE_ENROLLED',
        }),
      );

      const skipped = await get(
        '/admin/notifications/deliveries?status=SKIPPED&channel=SMS',
        admin.accessToken,
      ).expect(200);
      expect(skipped.body.meta.total).toBe(2);
      const mine = await get(
        `/admin/notifications/deliveries?userId=${farmer.id}`,
        admin.accessToken,
      ).expect(200);
      expect(mine.body.meta.total).toBe(3);
      expect(
        (await get('/admin/notifications/deliveries?isTestData=true', admin.accessToken)).body.meta
          .total,
      ).toBe(0);
      expect(
        await ctx.prisma.notificationDelivery.count({
          where: { status: NotificationDeliveryStatus.SENT },
        }),
      ).toBe(0);
      await get('/admin/notifications/deliveries?status=NOPE', admin.accessToken).expect(400);
    });
  });
});
