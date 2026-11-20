import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { describeError } from '../../../common/utils/describe-error';
import { notificationsConfig } from '../../../config/configuration';
import {
  Language,
  NotificationChannel,
  NotificationDeliveryStatus,
  Prisma,
  type NotificationCategory,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { QueueName } from '../../../infrastructure/queue/queue.constants';
import {
  NotificationChannelsService,
  type ChannelState,
  type Recipient,
} from '../channels/notification-channels.service';
import { quietHoursDelayMs } from '../common/quiet-hours';
import type { VariableValue } from '../common/template-renderer';
import type { NotificationEventDefinition } from '../events/notification-events';
import {
  IN_APP_PROVIDER_ID,
  NOTIFICATION_JOB_NAME,
  NotificationErrorCode,
} from '../notifications.constants';
import {
  NotificationPreferencesService,
  type EffectivePreferences,
} from '../preferences/notification-preferences.service';
import { NotificationSettingsService } from '../settings/notification-settings.service';
import {
  NotificationRenderError,
  NotificationTemplatesService,
  type RenderedContent,
  type ResolvedTemplate,
} from '../templates/notification-templates.service';

export type Variables = Record<string, VariableValue>;

export interface NotifyInput {
  userId: string;
  category: NotificationCategory;
  /** Template code; templates are looked up per channel and language. */
  templateCode: string;
  /** Channels to try besides the in-app inbox, which every notification has. */
  channels?: NotificationChannel[];
  /** Values for template placeholders; may be computed from the recipient. */
  variables?: Variables | ((recipient: Recipient) => Variables);
  entity?: { type: string; id: string };
  /** Makes the call idempotent for this user: a second call returns the first notification. */
  dedupeKey?: string;
}

export type SuppressionReason =
  | 'USER_NOT_FOUND'
  | 'CATEGORY_DISABLED'
  | 'NON_ESSENTIAL_DISABLED'
  | 'USER_OPTED_OUT'
  | 'TEMPLATE_MISSING'
  | 'TEMPLATE_VARIABLES_INVALID';

export interface PlannedDelivery {
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  reasonCode: string | null;
}

export type NotifyResult =
  | { status: 'CREATED'; notificationId: string; deliveries: PlannedDelivery[] }
  | { status: 'DUPLICATE'; notificationId: string }
  | { status: 'SUPPRESSED'; reason: SuppressionReason };

interface ChannelPlan {
  channel: NotificationChannel;
  language: Language;
  status: NotificationDeliveryStatus;
  reasonCode: string | null;
  templateVersionId: string | null;
  content: RenderedContent | null;
  delayMs: number | null;
}

/**
 * Creates notifications from business events (the internal API; there is no public "send"
 * endpoint). It applies category policy, user preferences, channel availability and quiet
 * hours, stores the in-app notification and one delivery per requested channel, and queues
 * deliveries for channels that have a registered provider. Without providers every external
 * channel is recorded as SKIPPED with the reason; nothing is reported as sent.
 */
@Injectable()
export class NotificationPublisher {
  private readonly logger = new Logger(NotificationPublisher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: NotificationChannelsService,
    private readonly preferences: NotificationPreferencesService,
    private readonly settings: NotificationSettingsService,
    private readonly templates: NotificationTemplatesService,
    @Inject(notificationsConfig.KEY)
    private readonly config: ConfigType<typeof notificationsConfig>,
    @InjectQueue(QueueName.NotificationDelivery) private readonly queue: Queue,
  ) {}

  /**
   * Publishes a built-in business event to one user and never throws: a notification problem must
   * not fail the business operation that triggered it. `fullName` is supplied automatically.
   */
  async notifyEvent(
    event: NotificationEventDefinition,
    userId: string,
    variables: Variables = {},
    options: { entity?: { type: string; id: string }; dedupeKey?: string } = {},
  ): Promise<void> {
    try {
      await this.notify({
        userId,
        category: event.category,
        templateCode: event.code,
        channels: event.channels,
        variables: (recipient) => ({ fullName: recipient.fullName, ...variables }),
        ...options,
      });
    } catch (error) {
      this.logger.warn(
        `Notification ${event.code} for user ${userId} failed: ${describeError(error)}`,
      );
    }
  }

  async notify(input: NotifyInput): Promise<NotifyResult> {
    const recipient = await this.channels.loadRecipient(input.userId);
    if (!recipient) return { status: 'SUPPRESSED', reason: 'USER_NOT_FOUND' };

    if (input.dedupeKey) {
      const existing = await this.prisma.notification.findUnique({
        where: { userId_dedupeKey: { userId: input.userId, dedupeKey: input.dedupeKey } },
        select: { id: true },
      });
      if (existing) return { status: 'DUPLICATE', notificationId: existing.id };
    }

    const policy = await this.settings.categoryPolicy(input.category);
    const prefs = await this.preferences.effective(recipient);
    if (!policy.isEssential) {
      if (!policy.isActive) return { status: 'SUPPRESSED', reason: 'CATEGORY_DISABLED' };
      if (!prefs.nonEssentialEnabled)
        return { status: 'SUPPRESSED', reason: 'NON_ESSENTIAL_DISABLED' };
      if (prefs.disabledCategories.has(input.category))
        return { status: 'SUPPRESSED', reason: 'USER_OPTED_OUT' };
    }

    const values =
      typeof input.variables === 'function' ? input.variables(recipient) : (input.variables ?? {});
    const languages = [prefs.language, prefs.language === Language.rw ? Language.en : Language.rw];

    // The inbox record is the notification itself; without its template there is nothing to store.
    const inApp = await this.templates.resolveActive(
      input.templateCode,
      NotificationChannel.IN_APP,
      languages,
    );
    if (!inApp) {
      this.logger.warn(`No active IN_APP template for ${input.templateCode}`);
      return { status: 'SUPPRESSED', reason: 'TEMPLATE_MISSING' };
    }
    let inAppContent: RenderedContent;
    try {
      inAppContent = this.templates.render(inApp.version, NotificationChannel.IN_APP, values, true);
    } catch (error) {
      if (error instanceof NotificationRenderError) {
        this.logger.warn(`Invalid variables for ${input.templateCode}: ${error.message}`);
        return { status: 'SUPPRESSED', reason: 'TEMPLATE_VARIABLES_INVALID' };
      }
      throw error;
    }

    const states = await this.channels.states(recipient);
    const requested = [...new Set(input.channels ?? [])].filter(
      (channel) => channel !== NotificationChannel.IN_APP,
    );
    const plans: ChannelPlan[] = [];
    for (const channel of requested) {
      plans.push(
        await this.planChannel({
          channel,
          input,
          values,
          languages,
          prefs,
          essential: policy.isEssential,
          allowedChannels: policy.allowedChannels,
          state: states.get(channel) as ChannelState,
        }),
      );
    }

    let created: { notificationId: string; deliveryIds: Map<NotificationChannel, string> };
    try {
      created = await this.persist(
        input,
        recipient,
        policy.isEssential,
        inApp,
        inAppContent,
        plans,
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        input.dedupeKey
      ) {
        const existing = await this.prisma.notification.findUnique({
          where: { userId_dedupeKey: { userId: input.userId, dedupeKey: input.dedupeKey } },
          select: { id: true },
        });
        if (existing) return { status: 'DUPLICATE', notificationId: existing.id };
      }
      throw error;
    }

    const deliveries: PlannedDelivery[] = [
      {
        channel: NotificationChannel.IN_APP,
        status: NotificationDeliveryStatus.DELIVERED,
        reasonCode: null,
      },
    ];
    for (const plan of plans) {
      let status = plan.status;
      let reasonCode = plan.reasonCode;
      if (plan.status === NotificationDeliveryStatus.QUEUED) {
        const deliveryId = created.deliveryIds.get(plan.channel) as string;
        if (!(await this.enqueue(deliveryId, plan.delayMs))) {
          status = NotificationDeliveryStatus.FAILED;
          reasonCode = NotificationErrorCode.QueueUnavailable;
        }
      }
      deliveries.push({ channel: plan.channel, status, reasonCode });
    }
    return { status: 'CREATED', notificationId: created.notificationId, deliveries };
  }

  // ------------------------------------------------------------------- internals

  private async planChannel(args: {
    channel: NotificationChannel;
    input: NotifyInput;
    values: Variables;
    languages: Language[];
    prefs: EffectivePreferences;
    essential: boolean;
    allowedChannels: NotificationChannel[];
    state: ChannelState;
  }): Promise<ChannelPlan> {
    const { channel, prefs, state } = args;
    const skipped = (
      reasonCode: NotificationErrorCode,
      language: Language = prefs.language,
    ): ChannelPlan => ({
      channel,
      language,
      status: NotificationDeliveryStatus.SKIPPED,
      reasonCode,
      templateVersionId: null,
      content: null,
      delayMs: null,
    });

    if (!args.allowedChannels.includes(channel))
      return skipped(NotificationErrorCode.ChannelNotAllowedForCategory);
    if (!state.available) return skipped(state.reasonCode as NotificationErrorCode);
    // A user's own channel choice is always respected; essential notifications still reach the inbox.
    if (prefs.disabledChannels.has(channel))
      return skipped(NotificationErrorCode.ChannelDisabledByUser);

    const template: ResolvedTemplate | null = await this.templates.resolveActive(
      args.input.templateCode,
      channel,
      args.languages,
    );
    if (!template) return skipped(NotificationErrorCode.TemplateMissing);
    let content: RenderedContent;
    try {
      content = this.templates.render(template.version, channel, args.values, true);
    } catch (error) {
      if (error instanceof NotificationRenderError) {
        return skipped(NotificationErrorCode.TemplateVariablesInvalid, template.language);
      }
      throw error;
    }
    // Essential notifications ignore quiet hours.
    const delayMs = args.essential ? null : quietHoursDelayMs(prefs.quietHours);
    return {
      channel,
      language: template.language,
      status: NotificationDeliveryStatus.QUEUED,
      reasonCode: null,
      templateVersionId: template.version.id,
      content,
      delayMs,
    };
  }

  private persist(
    input: NotifyInput,
    recipient: Recipient,
    isEssential: boolean,
    inApp: ResolvedTemplate,
    inAppContent: RenderedContent,
    plans: ChannelPlan[],
  ): Promise<{ notificationId: string; deliveryIds: Map<NotificationChannel, string> }> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const notification = await tx.notification.create({
        data: {
          userId: recipient.id,
          category: input.category,
          templateCode: input.templateCode,
          title: inAppContent.subject as string,
          body: inAppContent.body,
          language: inApp.language,
          isEssential,
          entityType: input.entity?.type,
          entityId: input.entity?.id,
          dedupeKey: input.dedupeKey,
        },
        select: { id: true },
      });
      // The inbox is stored by the platform itself, so it is the one delivery that is genuinely complete.
      await tx.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          channel: NotificationChannel.IN_APP,
          status: NotificationDeliveryStatus.DELIVERED,
          language: inApp.language,
          templateVersionId: inApp.version.id,
          subject: inAppContent.subject,
          body: inAppContent.body,
          providerId: IN_APP_PROVIDER_ID,
          attempts: 1,
          queuedAt: now,
          deliveredAt: now,
        },
      });
      const deliveryIds = new Map<NotificationChannel, string>();
      for (const plan of plans) {
        const queued = plan.status === NotificationDeliveryStatus.QUEUED;
        const delivery = await tx.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            channel: plan.channel,
            status: plan.status,
            language: plan.language,
            templateVersionId: plan.templateVersionId,
            subject: plan.content?.subject ?? null,
            body: plan.content?.body ?? null,
            reasonCode: plan.reasonCode,
            queuedAt: queued ? now : null,
            scheduledFor: queued && plan.delayMs ? new Date(now.getTime() + plan.delayMs) : null,
          },
          select: { id: true },
        });
        deliveryIds.set(plan.channel, delivery.id);
      }
      return { notificationId: notification.id, deliveryIds };
    });
  }

  private async enqueue(deliveryId: string, delayMs: number | null): Promise<boolean> {
    try {
      await this.queue.add(
        NOTIFICATION_JOB_NAME,
        { deliveryId },
        {
          jobId: deliveryId,
          attempts: this.config.deliveryAttempts,
          backoff: { type: 'exponential', delay: 5000 },
          ...(delayMs ? { delay: delayMs } : {}),
        },
      );
      return true;
    } catch (error) {
      this.logger.warn(`Delivery ${deliveryId} could not be queued: ${describeError(error)}`);
      await this.prisma.notificationDelivery.updateMany({
        where: { id: deliveryId, status: NotificationDeliveryStatus.QUEUED },
        data: {
          status: NotificationDeliveryStatus.FAILED,
          reasonCode: NotificationErrorCode.QueueUnavailable,
          failedAt: new Date(),
        },
      });
      return false;
    }
  }
}
