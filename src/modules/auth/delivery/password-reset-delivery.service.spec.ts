import type { PasswordResetDeliveryStoreService } from './password-reset-delivery-store.service';
import { PasswordResetDeliveryService } from './password-reset-delivery.service';

describe('PasswordResetDeliveryService', () => {
  it('reports provider readiness without exposing secrets', () => {
    const service = new PasswordResetDeliveryService(
      {} as PasswordResetDeliveryStoreService,
      { passwordResetTtlMinutes: 30 } as never,
      { siteOrigin: undefined } as never,
      { host: undefined, port: 587, user: undefined, password: undefined, from: undefined, secure: false } as never,
      { twilioAccountSid: undefined, twilioAuthToken: undefined, twilioFrom: undefined } as never,
    );
    expect(service.providerReadiness()).toEqual({
      email: { configured: false, reason: 'SMTP_NOT_CONFIGURED' },
      sms: { configured: false, reason: 'TWILIO_NOT_CONFIGURED' },
      frontendOrigin: { configured: false, reason: 'FRONTEND_SITE_ORIGIN_NOT_CONFIGURED' },
    });
  });

  it('does not deliver when the delivery record is unavailable', async () => {
    const store = { resolveForWorker: jest.fn().mockResolvedValue(null) };
    const service = new PasswordResetDeliveryService(
      store as unknown as PasswordResetDeliveryStoreService,
      { passwordResetTtlMinutes: 30 } as never,
      { siteOrigin: 'https://app.example' } as never,
      { host: 'smtp', port: 587, user: 'u', password: 'p', from: 'noreply@example.com', secure: false } as never,
      { twilioAccountSid: 'sid', twilioAuthToken: 'tok', twilioFrom: '+123' } as never,
    );
    await expect(service.deliverById('missing')).resolves.toEqual({
      delivered: false,
      channel: 'email',
      reason: 'DELIVERY_RECORD_UNAVAILABLE',
    });
  });
});