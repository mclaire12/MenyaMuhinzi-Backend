import { Injectable } from '@nestjs/common';

function bytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const copy = new ArrayBuffer(value.byteLength);
  new Uint8Array(copy).set(value);
  return new Uint8Array(copy);
}
import { PasswordResetDeliveryStatus, type Language } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { WebSessionCryptoService } from '../services/web-session-crypto.service';

export interface CreatePasswordResetDeliveryInput {
  passwordResetTokenId: string;
  userId: string;
  channel: 'email' | 'sms';
  destination: string;
  language: Language;
  resetToken: string;
  expiresAt: Date;
}

export interface ResolvedPasswordResetDelivery {
  deliveryId: string;
  userId: string;
  channel: 'email' | 'sms';
  destination: string;
  language: Language;
  resetToken: string;
  expiresAt: Date;
}

/**
 * Persists delivery metadata and encrypts the plaintext reset token at rest.
 * BullMQ jobs reference only `deliveryId`.
 */
@Injectable()
export class PasswordResetDeliveryStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: WebSessionCryptoService,
  ) {}

  async create(input: CreatePasswordResetDeliveryInput): Promise<{ deliveryId: string }> {
    const encrypted = this.crypto.encryptRefreshToken(input.resetToken);
    const record = await this.prisma.passwordResetDelivery.create({
      data: {
        passwordResetTokenId: input.passwordResetTokenId,
        userId: input.userId,
        channel: input.channel,
        destination: input.destination,
        language: input.language,
        tokenCiphertext: bytes(encrypted.ciphertext),
        tokenNonce: bytes(encrypted.nonce),
        tokenAuthTag: bytes(encrypted.authTag),
        encryptionKeyVersion: encrypted.keyVersion,
        expiresAt: input.expiresAt,
        status: PasswordResetDeliveryStatus.PENDING,
      },
      select: { id: true },
    });
    return { deliveryId: record.id };
  }

  /** Marks previous pending deliveries failed when a new reset is requested for the same user. */
  async invalidatePendingForUser(userId: string): Promise<void> {
    await this.prisma.passwordResetDelivery.updateMany({
      where: {
        userId,
        status: PasswordResetDeliveryStatus.PENDING,
      },
      data: {
        status: PasswordResetDeliveryStatus.FAILED,
        tokenCiphertext: null,
        tokenNonce: null,
        tokenAuthTag: null,
        encryptionKeyVersion: null,
      },
    });
  }

  async resolveForWorker(deliveryId: string): Promise<ResolvedPasswordResetDelivery | null> {
    const record = await this.prisma.passwordResetDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        passwordResetToken: { select: { usedAt: true, expiresAt: true } },
      },
    });
    if (!record) return null;
    if (record.status !== PasswordResetDeliveryStatus.PENDING) return null;
    if (record.expiresAt.getTime() <= Date.now()) return null;
    if (record.passwordResetToken.usedAt) return null;
    if (record.passwordResetToken.expiresAt.getTime() <= Date.now()) return null;
    if (
      !record.tokenCiphertext ||
      !record.tokenNonce ||
      !record.tokenAuthTag ||
      record.encryptionKeyVersion == null
    ) {
      return null;
    }

    const resetToken = this.crypto.decryptRefreshToken({
      ciphertext: Buffer.from(record.tokenCiphertext),
      nonce: Buffer.from(record.tokenNonce),
      authTag: Buffer.from(record.tokenAuthTag),
      keyVersion: record.encryptionKeyVersion,
    });

    return {
      deliveryId: record.id,
      userId: record.userId,
      channel: record.channel as 'email' | 'sms',
      destination: record.destination,
      language: record.language,
      resetToken,
      expiresAt: record.expiresAt,
    };
  }

  async markDelivered(deliveryId: string): Promise<void> {
    await this.prisma.passwordResetDelivery.update({
      where: { id: deliveryId },
      data: {
        status: PasswordResetDeliveryStatus.SENT,
        deliveredAt: new Date(),
        tokenCiphertext: null,
        tokenNonce: null,
        tokenAuthTag: null,
        encryptionKeyVersion: null,
      },
    });
  }

  async markFailed(deliveryId: string): Promise<void> {
    await this.prisma.passwordResetDelivery.updateMany({
      where: { id: deliveryId, status: PasswordResetDeliveryStatus.PENDING },
      data: {
        status: PasswordResetDeliveryStatus.FAILED,
        tokenCiphertext: null,
        tokenNonce: null,
        tokenAuthTag: null,
        encryptionKeyVersion: null,
      },
    });
  }
}