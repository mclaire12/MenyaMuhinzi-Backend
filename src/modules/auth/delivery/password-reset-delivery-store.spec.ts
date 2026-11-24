import { PasswordResetDeliveryStatus } from '../../../generated/prisma/client';
import { PasswordResetDeliveryStoreService } from './password-reset-delivery-store.service';
import type { WebSessionCryptoService } from '../services/web-session-crypto.service';
import type { PrismaService } from '../../../infrastructure/database/prisma.service';

describe('PasswordResetDeliveryStoreService', () => {
  const encrypted = {
    ciphertext: Buffer.from('cipher'),
    nonce: Buffer.from('nonce'.padEnd(12, '0')),
    authTag: Buffer.alloc(16),
    keyVersion: 1,
  };

  let prisma: jest.Mocked<Pick<PrismaService, 'passwordResetDelivery'>>;
  let crypto: jest.Mocked<Pick<WebSessionCryptoService, 'encryptRefreshToken' | 'decryptRefreshToken'>>;
  let store: PasswordResetDeliveryStoreService;

  beforeEach(() => {
    prisma = {
      passwordResetDelivery: {
        create: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      } as unknown as jest.Mocked<PrismaService>['passwordResetDelivery'],
    } as jest.Mocked<Pick<PrismaService, 'passwordResetDelivery'>>;

    crypto = {
      encryptRefreshToken: jest.fn().mockReturnValue(encrypted),
      decryptRefreshToken: jest.fn().mockReturnValue('opaque-reset-token'),
    };

    store = new PasswordResetDeliveryStoreService(
      { passwordResetDelivery: prisma.passwordResetDelivery } as unknown as PrismaService,
      crypto as unknown as WebSessionCryptoService,
    );
  });

  it('stores encrypted material and returns only a delivery id', async () => {
    prisma.passwordResetDelivery.create.mockResolvedValueOnce({ id: 'delivery-1' } as never);
    const result = await store.create({
      passwordResetTokenId: 'tok-1',
      userId: 'user-1',
      channel: 'sms',
      destination: '+250788123456',
      language: 'rw',
      resetToken: 'opaque-reset-token',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(result).toEqual({ deliveryId: 'delivery-1' });
    expect(crypto.encryptRefreshToken).toHaveBeenCalledWith('opaque-reset-token');
    expect(prisma.passwordResetDelivery.create).toHaveBeenCalled();
  });

  it('clears ciphertext after marking delivered', async () => {
    prisma.passwordResetDelivery.update.mockResolvedValueOnce({} as never);
    await store.markDelivered('delivery-1');
    expect(prisma.passwordResetDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-1' },
        data: expect.objectContaining({
          status: PasswordResetDeliveryStatus.SENT,
          tokenCiphertext: null,
        }),
      }),
    );
  });

  it('refuses to resolve consumed reset tokens', async () => {
    prisma.passwordResetDelivery.findUnique.mockResolvedValueOnce({
      id: 'delivery-1',
      userId: 'user-1',
      channel: 'sms',
      destination: '+250788123456',
      language: 'rw',
      status: PasswordResetDeliveryStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      tokenCiphertext: encrypted.ciphertext,
      tokenNonce: encrypted.nonce,
      tokenAuthTag: encrypted.authTag,
      encryptionKeyVersion: encrypted.keyVersion,
      passwordResetToken: { usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
    } as never);
    await expect(store.resolveForWorker('delivery-1')).resolves.toBeNull();
  });
});