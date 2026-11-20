import type { Notification, NotificationDelivery } from '../../../generated/prisma/client';
import { NotificationChannel, NotificationDeliveryStatus } from '../../../generated/prisma/client';
import type { DeliveryStatusResponseDto, NotificationResponseDto } from '../dto/notification.dto';
import { NotificationErrorMessage, type NotificationErrorCode } from '../notifications.constants';

export function deliveryNote(
  delivery: Pick<NotificationDelivery, 'channel' | 'status' | 'reasonCode' | 'isTestData'>,
): string {
  const reason =
    delivery.reasonCode && delivery.reasonCode in NotificationErrorMessage
      ? NotificationErrorMessage[delivery.reasonCode as NotificationErrorCode]
      : null;
  switch (delivery.status) {
    case NotificationDeliveryStatus.DELIVERED:
      return delivery.channel === NotificationChannel.IN_APP
        ? 'Stored in your notification inbox.'
        : 'The provider confirmed delivery.';
    case NotificationDeliveryStatus.SENT:
      return delivery.isTestData
        ? 'Test provider accepted the message; nothing was sent to a real recipient.'
        : 'The provider accepted the message. Delivery to the recipient is not confirmed.';
    case NotificationDeliveryStatus.QUEUED:
      return 'Waiting to be handed to the provider.';
    case NotificationDeliveryStatus.PROCESSING:
      return 'Being handed to the provider.';
    case NotificationDeliveryStatus.FAILED:
      return reason ? `Not sent: ${reason}` : 'Not sent.';
    case NotificationDeliveryStatus.SKIPPED:
      return reason ? `Not attempted: ${reason}` : 'Not attempted.';
  }
}

export function toDeliveryStatus(
  delivery: Pick<
    NotificationDelivery,
    | 'channel'
    | 'status'
    | 'language'
    | 'reasonCode'
    | 'scheduledFor'
    | 'sentAt'
    | 'deliveredAt'
    | 'failedAt'
    | 'isTestData'
  >,
): DeliveryStatusResponseDto {
  return {
    channel: delivery.channel,
    status: delivery.status,
    language: delivery.language,
    reasonCode: delivery.reasonCode,
    note: deliveryNote(delivery),
    scheduledFor: delivery.scheduledFor,
    sentAt: delivery.sentAt,
    deliveredAt: delivery.deliveredAt,
    failedAt: delivery.failedAt,
    isTestData: delivery.isTestData,
  };
}

export function toNotification(row: Notification): NotificationResponseDto {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    language: row.language,
    isEssential: row.isEssential,
    isRead: row.readAt !== null,
    readAt: row.readAt,
    archivedAt: row.archivedAt,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.createdAt,
  };
}
