/**
 * Background job queues. Producers and processors are added by feature modules
 * in later phases (AI course generation, media rendering, notifications, ...).
 */
export const QueueName = {
  AiGeneration: 'ai-generation',
  Media: 'media',
  Notifications: 'notifications',
  /** Per-channel notification deliveries (Phase 6). Separate from the legacy password-reset jobs. */
  NotificationDelivery: 'notification-delivery',
  Knowledge: 'knowledge',
} as const;

export type QueueName = (typeof QueueName)[keyof typeof QueueName];

export const ALL_QUEUES: QueueName[] = Object.values(QueueName);
