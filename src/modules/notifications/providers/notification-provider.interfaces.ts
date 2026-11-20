import type { Language, NotificationChannel } from '../../../generated/prisma/client';

/**
 * Provider abstractions for outbound channels (SMS, email, push, USSD, IVR). They are
 * preparation only: no implementation ships with the application, so no external request is
 * ever made and nothing is reported as sent. Implementations are bound to NOTIFICATION_PROVIDERS.
 */
export const NOTIFICATION_PROVIDERS = Symbol('NOTIFICATION_PROVIDERS');

export interface NotificationRecipient {
  userId: string;
  language: Language;
  /** E.164 number. Present for every account. */
  phoneNumber: string;
  /** Null for most basic-phone farmers. */
  email: string | null;
}

export interface OutboundMessage {
  deliveryId: string;
  channel: NotificationChannel;
  recipient: NotificationRecipient;
  /** Only for channels that use one (email, push). */
  subject: string | null;
  body: string;
}

export interface SendResult {
  /** The provider's own message id, when it returns one. */
  providerMessageId?: string;
}

export interface NotificationProvider {
  /** Stable identifier recorded on deliveries. */
  readonly id: string;
  /** Channels this provider can send on. */
  readonly channels: readonly NotificationChannel[];
  /**
   * True only for test doubles. Their deliveries are stored with isTestData=true and are never
   * presented as real.
   */
  readonly isTestDouble?: boolean;
  /**
   * Hands the message to the provider. Resolving means the provider accepted it (status SENT);
   * it does not mean the recipient received it. Throw NotificationProviderError on failure.
   */
  send(message: OutboundMessage): Promise<SendResult>;
}

/** Thrown by providers. Retryable errors (timeouts, rate limits) are retried by the queue. */
export class NotificationProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'NotificationProviderError';
  }
}
