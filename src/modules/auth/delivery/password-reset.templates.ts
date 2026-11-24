import type { Language } from '../../../generated/prisma/client';

export function passwordResetEmail(params: {
  language: Language;
  resetUrl: string;
  expiresMinutes: number;
}): { subject: string; body: string } {
  if (params.language === 'en') {
    return {
      subject: 'Reset your MenyaMuhinzi password',
      body: [
        'You requested a password reset for MenyaMuhinzi.',
        '',
        `Open this link within ${params.expiresMinutes} minutes:`,
        params.resetUrl,
        '',
        'If you did not request this, you can ignore this message.',
      ].join('\n'),
    };
  }
  return {
    subject: 'Subiza ijambo ry\'ibanga rya MenyaMuhinzi',
    body: [
      'Wasabye gusubiza ijambo ry\'ibanga kuri MenyaMuhinzi.',
      '',
      `Fungura iyi link mu minota ${params.expiresMinutes}:`,
      params.resetUrl,
      '',
      'Niba utabisabye, reka ubutumwa.',
    ].join('\n'),
  };
}

export function passwordResetSms(params: {
  language: Language;
  resetUrl: string;
  expiresMinutes: number;
}): string {
  if (params.language === 'en') {
    return `MenyaMuhinzi password reset (expires in ${params.expiresMinutes} min): ${params.resetUrl}`;
  }
  return `MenyaMuhinzi gusubiza ijambo ry'ibanga (${params.expiresMinutes} min): ${params.resetUrl}`;
}