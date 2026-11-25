import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { describeSmtpError, sendSmtpMail } from '../../../infrastructure/mail/smtp-send';
import type { Language } from '../../../generated/prisma/client';
import { authConfig, frontendConfig, smsConfig, smtpConfig } from '../../../config/configuration';
import { passwordResetEmail, passwordResetSms } from './password-reset.templates';
import { PasswordResetDeliveryStoreService } from './password-reset-delivery-store.service';

export type PasswordResetDeliveryOutcome =
  | { delivered: true; channel: 'email' | 'sms'; provider: string }
  | { delivered: false; channel: 'email' | 'sms'; reason: string };

@Injectable()
export class PasswordResetDeliveryService {
  private readonly logger = new Logger(PasswordResetDeliveryService.name);

  constructor(
    private readonly deliveryStore: PasswordResetDeliveryStoreService,
    @Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>,
    @Inject(frontendConfig.KEY) private readonly frontend: ConfigType<typeof frontendConfig>,
    @Inject(smtpConfig.KEY) private readonly smtp: ConfigType<typeof smtpConfig>,
    @Inject(smsConfig.KEY) private readonly sms: ConfigType<typeof smsConfig>,
  ) {}

  providerReadiness(): {
    email: { configured: boolean; reason?: string };
    sms: { configured: boolean; reason?: string };
    frontendOrigin: { configured: boolean; reason?: string };
  } {
    return {
      email: this.smtpReady()
        ? { configured: true }
        : { configured: false, reason: 'SMTP_NOT_CONFIGURED' },
      sms: this.twilioReady()
        ? { configured: true }
        : { configured: false, reason: 'TWILIO_NOT_CONFIGURED' },
      frontendOrigin: this.frontend.siteOrigin
        ? { configured: true }
        : { configured: false, reason: 'FRONTEND_SITE_ORIGIN_NOT_CONFIGURED' },
    };
  }

  buildResetUrl(token: string): string | null {
    const origin = this.frontend.siteOrigin;
    if (!origin) return null;
    const encoded = encodeURIComponent(token);
    return `${origin}/auth/reset?token=${encoded}`;
  }

  async deliverById(deliveryId: string): Promise<PasswordResetDeliveryOutcome> {
    const resolved = await this.deliveryStore.resolveForWorker(deliveryId);
    if (!resolved) {
      return { delivered: false, channel: 'email', reason: 'DELIVERY_RECORD_UNAVAILABLE' };
    }

    const resetUrl = this.buildResetUrl(resolved.resetToken);
    if (!resetUrl) {
      return {
        delivered: false,
        channel: resolved.channel,
        reason: 'FRONTEND_SITE_ORIGIN_NOT_CONFIGURED',
      };
    }

    const expiresMinutes = this.auth.passwordResetTtlMinutes;
    const outcome =
      resolved.channel === 'email'
        ? await this.sendEmail(
            resolved.destination,
            resolved.language,
            resetUrl,
            expiresMinutes,
            resolved.userId,
          )
        : await this.sendSms(
            resolved.destination,
            resolved.language,
            resetUrl,
            expiresMinutes,
            resolved.userId,
          );

    if (outcome.delivered) {
      await this.deliveryStore.markDelivered(deliveryId);
    }
    return outcome;
  }

  private smtpReady(): boolean {
    return Boolean(this.smtp.host && this.smtp.from);
  }

  private twilioReady(): boolean {
    return Boolean(this.sms.twilioAccountSid && this.sms.twilioAuthToken && this.sms.twilioFrom);
  }

  private async sendEmail(
    destination: string,
    language: Language,
    resetUrl: string,
    expiresMinutes: number,
    userId: string,
  ): Promise<PasswordResetDeliveryOutcome> {
    if (!this.smtpReady()) {
      this.logger.warn(`Password reset email not sent for user ${userId}: SMTP is not configured`);
      return { delivered: false, channel: 'email', reason: 'SMTP_NOT_CONFIGURED' };
    }

    const { subject, body } = passwordResetEmail({ language, resetUrl, expiresMinutes });
    try {
      const info = await sendSmtpMail(this.smtp, {
        from: this.smtp.from ?? '',
        to: destination,
        subject,
        text: body,
      });
      this.logger.log(
        `Password reset email accepted for user ${userId} (messageId=${info.messageId ?? 'n/a'}, attempts=${info.attempts})`,
      );
      return { delivered: true, channel: 'email', provider: 'smtp' };
    } catch (error) {
      this.logger.warn(
        `Password reset email failed for user ${userId}: ${describeSmtpError(error)}`,
      );
      throw error;
    }
  }

  private async sendSms(
    destination: string,
    language: Language,
    resetUrl: string,
    expiresMinutes: number,
    userId: string,
  ): Promise<PasswordResetDeliveryOutcome> {
    if (!this.twilioReady()) {
      this.logger.warn(`Password reset SMS not sent for user ${userId}: Twilio is not configured`);
      return { delivered: false, channel: 'sms', reason: 'TWILIO_NOT_CONFIGURED' };
    }

    const body = passwordResetSms({ language, resetUrl, expiresMinutes });
    const credentials = Buffer.from(`${this.sms.twilioAccountSid}:${this.sms.twilioAuthToken}`).toString(
      'base64',
    );
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.sms.twilioAccountSid}/Messages.json`;
    const payload = new URLSearchParams({
      To: destination,
      From: this.sms.twilioFrom!,
      Body: body,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload,
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.warn(`Password reset SMS failed for user ${userId}: HTTP ${response.status}`);
      throw new Error(`Twilio responded ${response.status}: ${text.slice(0, 120)}`);
    }

    this.logger.log(`Password reset SMS accepted for user ${userId}`);
    return { delivered: true, channel: 'sms', provider: 'twilio' };
  }
}