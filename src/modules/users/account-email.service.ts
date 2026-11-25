import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { describeSmtpError, sendSmtpMail } from '../../infrastructure/mail/smtp-send';
import type { Language } from '../../generated/prisma/client';
import { frontendConfig, smtpConfig } from '../../config/configuration';

export type AccountEmailOutcome =
  | { delivered: true }
  | {
      delivered: false;
      reason: 'SMTP_NOT_CONFIGURED' | 'FRONTEND_SITE_ORIGIN_NOT_CONFIGURED' | 'SEND_FAILED';
    };

/** Why the verification email is being sent; only changes the wording. */
export type VerificationEmailContext = 'registration' | 'approval' | 'staff-created' | 'resend';

/**
 * Account lifecycle emails (email verification, facilitator rejection). Uses the same
 * SMTP_* configuration and transport as password-reset delivery. Never logs tokens or links.
 */
@Injectable()
export class AccountEmailService {
  private readonly logger = new Logger(AccountEmailService.name);

  constructor(
    @Inject(smtpConfig.KEY) private readonly smtp: ConfigType<typeof smtpConfig>,
    @Inject(frontendConfig.KEY) private readonly frontend: ConfigType<typeof frontendConfig>,
  ) {}

  verificationUrl(token: string): string | null {
    const origin = this.frontend.siteOrigin;
    return origin ? `${origin}/auth/verify-email?token=${encodeURIComponent(token)}` : null;
  }

  async sendVerification(params: {
    userId: string;
    to: string;
    language: Language;
    token: string;
    /** 6-digit code the user types on the page the link opens. */
    code: string;
    expiresHours: number;
    context: VerificationEmailContext;
  }): Promise<AccountEmailOutcome> {
    const url = this.verificationUrl(params.token);
    if (!url) {
      this.logger.warn(
        `Verification email not sent for user ${params.userId}: FRONTEND_SITE_ORIGIN is not configured`,
      );
      return { delivered: false, reason: 'FRONTEND_SITE_ORIGIN_NOT_CONFIGURED' };
    }
    const { subject, body } = verificationEmail({ ...params, url });
    return this.send(params.userId, 'verification', params.to, subject, body);
  }

  async sendRejection(params: {
    userId: string;
    to: string;
    language: Language;
    reason: string;
  }): Promise<AccountEmailOutcome> {
    const { subject, body } = rejectionEmail(params);
    return this.send(params.userId, 'rejection', params.to, subject, body);
  }

  private async send(
    userId: string,
    kind: string,
    to: string,
    subject: string,
    text: string,
  ): Promise<AccountEmailOutcome> {
    if (!this.smtp.host || !this.smtp.from) {
      this.logger.warn(`Account ${kind} email not sent for user ${userId}: SMTP is not configured`);
      return { delivered: false, reason: 'SMTP_NOT_CONFIGURED' };
    }
    try {
      const info = await sendSmtpMail(this.smtp, { from: this.smtp.from, to, subject, text });
      this.logger.log(
        `Account ${kind} email accepted for user ${userId} (messageId=${info.messageId ?? 'n/a'}, attempts=${info.attempts})`,
      );
      return { delivered: true };
    } catch (error) {
      this.logger.warn(
        `Account ${kind} email failed for user ${userId}: ${describeSmtpError(error)}`,
      );
      return { delivered: false, reason: 'SEND_FAILED' };
    }
  }
}

export function verificationEmail(params: {
  language: Language;
  url: string;
  code: string;
  expiresHours: number;
  context: VerificationEmailContext;
}): { subject: string; body: string } {
  if (params.language === 'en') {
    const intro =
      params.context === 'approval'
        ? 'Your MenyaMuhinzi facilitator account request has been approved.'
        : params.context === 'staff-created'
          ? 'A MenyaMuhinzi account has been created for you.'
          : 'Thank you for registering with MenyaMuhinzi.';
    return {
      subject: 'Verify your MenyaMuhinzi email address',
      body: [
        intro,
        '',
        `Your verification code: ${params.code}`,
        '',
        `To confirm your email address within ${params.expiresHours} hours:`,
        '1. Open this link:',
        params.url,
        '2. Enter the verification code above and choose "Verify".',
        '',
        'Never share this code. You can sign in once your email address is verified.',
        'If you did not expect this message, you can ignore it.',
      ].join('\n'),
    };
  }
  const intro =
    params.context === 'approval'
      ? 'Ubusabe bwawe bwo kuba umufashamyumvire kuri MenyaMuhinzi bwemejwe.'
      : params.context === 'staff-created'
        ? 'Konti ya MenyaMuhinzi yagufunguriwe.'
        : 'Murakoze kwiyandikisha kuri MenyaMuhinzi.';
  return {
    subject: 'Emeza email yawe kuri MenyaMuhinzi',
    body: [
      intro,
      '',
      `Kode yawe yo kwemeza: ${params.code}`,
      '',
      `Kugira ngo wemeze email yawe mu masaha ${params.expiresHours}:`,
      '1. Fungura iyi link:',
      params.url,
      '2. Andika kode iri haruguru hanyuma ukande "Emeza".',
      '',
      'Ntuzasangize undi muntu iyi kode. Uzashobora kwinjira nyuma yo kwemeza email yawe.',
      'Niba utari utegereje ubu butumwa, ntugire icyo ukora.',
    ].join('\n'),
  };
}

export function rejectionEmail(params: { language: Language; reason: string }): {
  subject: string;
  body: string;
} {
  if (params.language === 'en') {
    return {
      subject: 'Your MenyaMuhinzi account request',
      body: [
        'Thank you for your interest in MenyaMuhinzi.',
        '',
        'After review, your account request was not approved.',
        `Reason: ${params.reason}`,
        '',
        'You may submit a new registration once the issue above has been addressed.',
      ].join('\n'),
    };
  }
  return {
    subject: 'Ubusabe bwawe bwa konti kuri MenyaMuhinzi',
    body: [
      'Murakoze kwifuza gukoresha MenyaMuhinzi.',
      '',
      'Nyuma yo gusuzuma, ubusabe bwawe bwa konti ntibwemejwe.',
      `Impamvu: ${params.reason}`,
      '',
      'Ushobora kongera kwiyandikisha nyuma yo gukemura ikibazo cyavuzwe haruguru.',
    ].join('\n'),
  };
}
