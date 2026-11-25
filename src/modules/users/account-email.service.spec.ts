import { AccountEmailService, rejectionEmail, verificationEmail } from './account-email.service';

const sendMail = jest.fn();
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail, close: jest.fn() })) },
}));

const smtp = {
  host: 'smtp.example',
  port: 587,
  secure: false,
  user: 'u',
  password: 'p',
  from: 'no-reply@example.rw',
};

function service(overrides: { smtp?: Partial<typeof smtp>; origin?: string | undefined } = {}) {
  return new AccountEmailService(
    { ...smtp, ...overrides.smtp } as never,
    { siteOrigin: 'origin' in overrides ? overrides.origin : 'https://app.example' } as never,
  );
}

describe('AccountEmailService', () => {
  beforeEach(() => sendMail.mockReset());

  it('sends a verification link built from the frontend origin', async () => {
    sendMail.mockResolvedValue({ messageId: 'm-1' });
    const outcome = await service().sendVerification({
      userId: 'u-1',
      to: 'jeanne@example.rw',
      language: 'en',
      token: 'tok/en+1',
      code: '048213',
      expiresHours: 24,
      context: 'registration',
    });

    expect(outcome).toEqual({ delivered: true });
    const message = sendMail.mock.calls[0][0];
    expect(message).toMatchObject({ to: 'jeanne@example.rw', from: 'no-reply@example.rw' });
    expect(message.text).toContain('https://app.example/auth/verify-email?token=tok%2Fen%2B1');
    expect(message.text).toContain('Your verification code: 048213');
  });

  it('reports — and does not pretend — when SMTP or the site origin is missing', async () => {
    const params = {
      userId: 'u-1',
      to: 'a@b.rw',
      language: 'rw' as const,
      token: 't',
      code: '123456',
      expiresHours: 24,
      context: 'registration' as const,
    };
    await expect(service({ smtp: { host: undefined } }).sendVerification(params)).resolves.toEqual({
      delivered: false,
      reason: 'SMTP_NOT_CONFIGURED',
    });
    await expect(service({ origin: undefined }).sendVerification(params)).resolves.toEqual({
      delivered: false,
      reason: 'FRONTEND_SITE_ORIGIN_NOT_CONFIGURED',
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('retries a transient connection reset and then succeeds', async () => {
    sendMail
      .mockRejectedValueOnce(Object.assign(new Error('read ECONNRESET'), { code: 'ESOCKET' }))
      .mockResolvedValueOnce({ messageId: 'm-2' });
    await expect(
      service().sendRejection({ userId: 'u-1', to: 'a@b.rw', language: 'en', reason: 'X' }),
    ).resolves.toEqual({ delivered: true });
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permanent rejection', async () => {
    sendMail.mockRejectedValue(
      Object.assign(new Error('550 mailbox unavailable'), { code: 'EENVELOPE', responseCode: 550 }),
    );
    await expect(
      service().sendRejection({ userId: 'u-1', to: 'a@b.rw', language: 'en', reason: 'X' }),
    ).resolves.toEqual({ delivered: false, reason: 'SEND_FAILED' });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('reports a failed delivery instead of throwing', async () => {
    sendMail.mockRejectedValue(new Error('connection refused'));
    await expect(
      service().sendRejection({
        userId: 'u-1',
        to: 'a@b.rw',
        language: 'en',
        reason: 'Incomplete',
      }),
    ).resolves.toEqual({ delivered: false, reason: 'SEND_FAILED' });
  });
});

describe('account email templates', () => {
  it('words the verification email for each context in both languages', () => {
    const url = 'https://app.example/auth/verify-email?token=x';
    const approval = verificationEmail({
      language: 'en',
      url,
      code: '777001',
      expiresHours: 24,
      context: 'approval',
    });
    expect(approval.body).toMatch(/approved/);
    expect(approval.body).toContain(url);
    expect(approval.body).toContain('777001');
    expect(
      verificationEmail({ language: 'rw', url, code: '1', expiresHours: 24, context: 'registration' })
        .subject,
    ).toMatch(/Emeza email/);
  });

  it('includes the rejection reason and no verification link', () => {
    const email = rejectionEmail({ language: 'en', reason: 'Phone number could not be verified' });
    expect(email.body).toContain('Reason: Phone number could not be verified');
    expect(email.body).not.toMatch(/verify-email|token/);
    expect(rejectionEmail({ language: 'rw', reason: 'X' }).body).toContain('Impamvu: X');
  });
});
