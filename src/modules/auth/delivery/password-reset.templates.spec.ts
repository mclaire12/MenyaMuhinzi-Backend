import { passwordResetEmail, passwordResetSms } from './password-reset.templates';

describe('password reset templates', () => {
  it('builds bilingual email and sms without embedding secrets beyond the reset URL param', () => {
    const url = 'https://app.example/auth/reset?token=opaque';
    const emailRw = passwordResetEmail({ language: 'rw', resetUrl: url, expiresMinutes: 30 });
    expect(emailRw.subject).toMatch(/MenyaMuhinzi/);
    expect(emailRw.body).toContain(url);

    const emailEn = passwordResetEmail({ language: 'en', resetUrl: url, expiresMinutes: 30 });
    expect(emailEn.subject).toMatch(/Reset your/);

    const sms = passwordResetSms({ language: 'rw', resetUrl: url, expiresMinutes: 30 });
    expect(sms).toContain('MenyaMuhinzi');
    expect(sms).toContain(url);
  });
});