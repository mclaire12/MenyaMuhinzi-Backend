import { Injectable, Logger } from '@nestjs/common';
import { describeError } from '../../../common/utils/describe-error';
import { NotificationChannel, NotificationDeliveryStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { NotificationChannelsService } from '../channels/notification-channels.service';
import { NotificationErrorCode } from '../notifications.constants';
import { NotificationProviderError } from '../providers/notification-provider.interfaces';
import { NotificationProviderRegistry } from '../providers/notification-provider.registry';
import { NotificationSettingsService } from '../settings/notification-settings.service';

export interface DeliveryJobData {
  deliveryId: string;
}

export interface DeliveryOutcome {
  deliveryId: string;
  status: NotificationDeliveryStatus;
  reasonCode: string | null;
  /** True when the delivery was not in the queued state, so nothing was done. */
  skipped?: boolean;
}

/**
 * Hands queued deliveries to the registered provider. Without a provider the delivery fails with
 * NOTIFICATION_PROVIDER_NOT_CONFIGURED and is not retried. A delivery is SENT only after a provider
 * accepted it; this class never marks anything DELIVERED, which needs a provider receipt.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NotificationProviderRegistry,
    private readonly channels: NotificationChannelsService,
    private readonly settings: NotificationSettingsService,
  ) {}

  /**
   * Runs one delivery. Resolves with an outcome for permanent results. A retryable provider error
   * puts the delivery back to QUEUED and throws so the queue retries it.
   */
  async execute(
    deliveryId: string,
    context: { attempt: number; maxAttempts: number },
  ): Promise<DeliveryOutcome> {
    // Claiming is conditional so duplicate or late jobs cannot send a message twice.
    const claimed = await this.prisma.notificationDelivery.updateMany({
      where: { id: deliveryId, status: NotificationDeliveryStatus.QUEUED },
      data: { status: NotificationDeliveryStatus.PROCESSING, attempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      const current = await this.prisma.notificationDelivery.findUnique({
        where: { id: deliveryId },
        select: { status: true, reasonCode: true },
      });
      return {
        deliveryId,
        status: current?.status ?? NotificationDeliveryStatus.SKIPPED,
        reasonCode: current?.reasonCode ?? null,
        skipped: true,
      };
    }

    const delivery = await this.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
      select: {
        channel: true,
        subject: true,
        body: true,
        language: true,
        notification: { select: { userId: true } },
      },
    });

    const recipient = await this.channels.loadRecipient(delivery.notification.userId);
    if (!recipient)
      return this.finish(
        deliveryId,
        NotificationDeliveryStatus.SKIPPED,
        NotificationErrorCode.UserUnavailable,
      );

    if (!(await this.settings.enabledChannels()).has(delivery.channel)) {
      return this.finish(
        deliveryId,
        NotificationDeliveryStatus.SKIPPED,
        NotificationErrorCode.ChannelDisabled,
      );
    }
    const provider = this.registry.forChannel(delivery.channel);
    if (!provider || delivery.channel === NotificationChannel.IN_APP) {
      return this.finish(
        deliveryId,
        NotificationDeliveryStatus.FAILED,
        NotificationErrorCode.ProviderNotConfigured,
      );
    }
    if (delivery.channel === NotificationChannel.EMAIL && !recipient.email) {
      return this.finish(
        deliveryId,
        NotificationDeliveryStatus.FAILED,
        NotificationErrorCode.NoAddress,
      );
    }
    if (delivery.body === null) {
      return this.finish(
        deliveryId,
        NotificationDeliveryStatus.FAILED,
        NotificationErrorCode.TemplateMissing,
      );
    }

    try {
      const result = await provider.send({
        deliveryId,
        channel: delivery.channel,
        recipient: {
          userId: recipient.id,
          language: delivery.language,
          phoneNumber: recipient.phoneNumber,
          email: recipient.email,
        },
        subject: delivery.subject,
        body: delivery.body,
      });
      await this.prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: NotificationDeliveryStatus.SENT,
          providerId: provider.id,
          providerMessageId: result.providerMessageId ?? null,
          isTestData: provider.isTestDouble === true,
          reasonCode: null,
          sentAt: new Date(),
        },
      });
      return { deliveryId, status: NotificationDeliveryStatus.SENT, reasonCode: null };
    } catch (error) {
      // Provider messages can contain addresses or credentials, so only a code is stored and logged.
      const retryable = error instanceof NotificationProviderError ? error.retryable : true;
      this.logger.warn(
        `Delivery ${deliveryId} (${delivery.channel}) failed: ${error instanceof Error ? error.name : describeError(error)}`,
      );
      if (retryable && context.attempt < context.maxAttempts) {
        await this.prisma.notificationDelivery.update({
          where: { id: deliveryId },
          data: {
            status: NotificationDeliveryStatus.QUEUED,
            reasonCode: NotificationErrorCode.ProviderError,
          },
        });
        throw new NotificationProviderError('The provider could not send the message', true);
      }
      return this.finish(
        deliveryId,
        NotificationDeliveryStatus.FAILED,
        NotificationErrorCode.ProviderError,
      );
    }
  }

  private async finish(
    deliveryId: string,
    status: NotificationDeliveryStatus,
    reasonCode: NotificationErrorCode,
  ): Promise<DeliveryOutcome> {
    await this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status,
        reasonCode,
        ...(status === NotificationDeliveryStatus.FAILED ? { failedAt: new Date() } : {}),
      },
    });
    return { deliveryId, status, reasonCode };
  }
}
