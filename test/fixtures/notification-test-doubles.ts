/*
 * TEST DOUBLES ONLY. Nothing here sends an SMS, email, push message, USSD prompt or voice call and
 * no network request is made. The provider marks itself as a test double, so the dispatcher stores
 * its deliveries with isTestData=true. It only records the messages it was given.
 */
import { NotificationChannel } from '../../src/generated/prisma/client';
import {
  NotificationProviderError,
  type NotificationProvider,
  type OutboundMessage,
  type SendResult,
} from '../../src/modules/notifications/providers/notification-provider.interfaces';

export const TEST_NOTIFICATION_PROVIDER_ID = 'test-notifications';

interface Failure {
  error: Error;
  channel?: NotificationChannel;
  times: number;
}

export class TestNotificationProvider implements NotificationProvider {
  readonly id = TEST_NOTIFICATION_PROVIDER_ID;
  readonly isTestDouble = true;
  readonly sent: OutboundMessage[] = [];
  private failures: Failure[] = [];
  private counter = 0;

  constructor(
    readonly channels: readonly NotificationChannel[] = [
      NotificationChannel.SMS,
      NotificationChannel.EMAIL,
      NotificationChannel.PUSH,
      NotificationChannel.USSD,
      NotificationChannel.IVR,
    ],
  ) {}

  /** The next `times` sends (optionally only on one channel) throw this error. */
  failWith(error: Error, options: { channel?: NotificationChannel; times?: number } = {}): this {
    this.failures.push({ error, channel: options.channel, times: options.times ?? 1 });
    return this;
  }

  reset(): void {
    this.sent.length = 0;
    this.failures = [];
    this.counter = 0;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const failure = this.failures.find(
      (candidate) =>
        candidate.times > 0 && (!candidate.channel || candidate.channel === message.channel),
    );
    if (failure) {
      failure.times -= 1;
      throw failure.error;
    }
    this.sent.push(message);
    this.counter += 1;
    return { providerMessageId: `test-message-${this.counter}` };
  }
}

export const retryableError = (message = 'temporary outage'): NotificationProviderError =>
  new NotificationProviderError(message, true);
export const permanentError = (message = 'rejected'): NotificationProviderError =>
  new NotificationProviderError(message, false);
