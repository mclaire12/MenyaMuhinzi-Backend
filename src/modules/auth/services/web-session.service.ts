import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { parseDuration } from '../../../common/utils/duration';
import { webSessionConfig } from '../../../config/configuration';
import { Prisma, TokenRevocationReason, UserStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { ClientContext } from '../auth.types';
import { TokenService } from './token.service';
import { WebSessionCryptoService } from './web-session-crypto.service';
import { revokeActiveWebSessions } from './web-session.revocation';

const ACTIVITY_SLIDE_MS = 60_000;

export type WebSessionFailure =
  | 'not_found'
  | 'revoked'
  | 'idle_expired'
  | 'absolute_expired'
  | 'password_changed'
  | 'account_inactive';

export type WebSessionValidation =
  | { ok: true; sessionId: string; session: ValidWebSession }
  | { ok: false; reason: WebSessionFailure };

export interface ValidWebSession {
  id: string;
  userId: string;
  sessionVersion: number;
  familyId: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

type StoredSession = Prisma.WebSessionGetPayload<{ include: { user: true } }>;

@Injectable()
export class WebSessionService {
  private readonly idleMs: number;
  private readonly absoluteMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly crypto: WebSessionCryptoService,
    @Inject(webSessionConfig.KEY) config: ConfigType<typeof webSessionConfig>,
  ) {
    this.idleMs = parseDuration(config.idleTtl);
    this.absoluteMs = parseDuration(config.absoluteTtl);
  }

  /**
   * Creates the refresh-token row and the web session in one transaction.
   * The raw refresh token is encrypted before insert and is not returned.
   */
  async create(input: {
    userId: string;
    passwordChangedAt: Date | null;
    client: ClientContext;
  }): Promise<{ sessionId: string }> {
    const sessionId = this.crypto.generateSessionId();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const refresh = await this.tokens.createStoredRefreshToken(tx, input.userId, input.client);
      const encrypted = this.crypto.encryptRefreshToken(refresh.refreshToken);
      await tx.webSession.create({
        data: {
          userId: input.userId,
          sessionHash: this.crypto.hashSessionId(sessionId),
          familyId: refresh.familyId,
          refreshTokenId: refresh.id,
          refreshCiphertext: bytes(encrypted.ciphertext),
          refreshNonce: bytes(encrypted.nonce),
          refreshAuthTag: bytes(encrypted.authTag),
          encryptionKeyVersion: encrypted.keyVersion,
          passwordChangedAt: input.passwordChangedAt,
          lastActivityAt: now,
          idleExpiresAt: new Date(now.getTime() + this.idleMs),
          absoluteExpiresAt: new Date(now.getTime() + this.absoluteMs),
        },
      });
    });
    return { sessionId };
  }

  async findBySessionId(sessionId: string): Promise<StoredSession | null> {
    return this.prisma.webSession.findFirst({
      where: { sessionHash: { in: this.crypto.sessionHashes(sessionId) } },
      include: { user: true },
    });
  }

  async validate(sessionId: string, now = new Date()): Promise<WebSessionValidation> {
    const session = await this.findBySessionId(sessionId);
    if (!session) return { ok: false, reason: 'not_found' };
    if (session.revokedAt) return { ok: false, reason: 'revoked' };

    if (session.absoluteExpiresAt.getTime() <= now.getTime()) {
      await this.markExpired(session.id);
      return { ok: false, reason: 'absolute_expired' };
    }
    if (session.idleExpiresAt.getTime() <= now.getTime()) {
      await this.markExpired(session.id);
      return { ok: false, reason: 'idle_expired' };
    }
    if (session.user.deletedAt || session.user.status !== UserStatus.ACTIVE) {
      await this.revokeOne(sessionId, session.userId, TokenRevocationReason.ACCOUNT_DISABLED);
      return { ok: false, reason: 'account_inactive' };
    }
    if (versionOf(session.passwordChangedAt) !== versionOf(session.user.passwordChangedAt)) {
      await this.revokeOne(sessionId, session.userId, TokenRevocationReason.PASSWORD_CHANGED);
      return { ok: false, reason: 'password_changed' };
    }

    await this.recordActivity(session, now);
    return {
      ok: true,
      sessionId,
      session: {
        id: session.id,
        userId: session.userId,
        sessionVersion: session.sessionVersion,
        familyId: session.familyId,
        idleExpiresAt: session.idleExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
      },
    };
  }

  /** Replaces the opaque id when `expectedVersion` still matches. Returns null when it does not. */
  async rotateSessionId(sessionId: string, expectedVersion: number): Promise<string | null> {
    const current = await this.findBySessionId(sessionId);
    if (!current || current.revokedAt || current.sessionVersion !== expectedVersion) return null;
    const nextId = this.crypto.generateSessionId();
    const { count } = await this.prisma.webSession.updateMany({
      where: { id: current.id, sessionVersion: expectedVersion, revokedAt: null },
      data: { sessionHash: this.crypto.hashSessionId(nextId), sessionVersion: { increment: 1 } },
    });
    return count === 1 ? nextId : null;
  }

  /** Decrypts the stored refresh token. Callers must not log the result. */
  async decryptRefreshToken(sessionId: string): Promise<string | null> {
    const session = await this.findBySessionId(sessionId);
    if (!session || session.revokedAt) return null;
    return this.crypto.decryptRefreshToken({
      ciphertext: Buffer.from(session.refreshCiphertext),
      nonce: Buffer.from(session.refreshNonce),
      authTag: Buffer.from(session.refreshAuthTag),
      keyVersion: session.encryptionKeyVersion,
    });
  }

  async revokeOne(sessionId: string, userId: string, reason: TokenRevocationReason): Promise<boolean> {
    const session = await this.findBySessionId(sessionId);
    if (!session || session.userId !== userId) return false;
    const { count } = await this.prisma.webSession.updateMany({
      where: { id: session.id, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count === 1;
  }

  async revokeAllForUser(userId: string, reason: TokenRevocationReason): Promise<void> {
    await revokeActiveWebSessions(this.prisma, { userId }, reason);
  }

  /**
   * After TokenService.rotate, re-encrypt the new refresh token and rotate the opaque session id.
   * Returns null when the session version no longer matches.
   */
  async commitRotatedCredentials(
    sessionId: string,
    expectedVersion: number,
    rotated: {
      refreshToken: string;
      refreshTokenId: string;
      familyId: string;
    },
  ): Promise<{ nextSessionId: string; idleExpiresAt: Date; absoluteExpiresAt: Date } | null> {
    const current = await this.findBySessionId(sessionId);
    if (!current || current.revokedAt || current.sessionVersion !== expectedVersion) return null;
    const nextSessionId = this.crypto.generateSessionId();
    const encrypted = this.crypto.encryptRefreshToken(rotated.refreshToken);
  const now = new Date();
  const idleExpiresAt = new Date(Math.min(now.getTime() + this.idleMs, current.absoluteExpiresAt.getTime()));
    const { count } = await this.prisma.webSession.updateMany({
      where: { id: current.id, sessionVersion: expectedVersion, revokedAt: null },
      data: {
        sessionHash: this.crypto.hashSessionId(nextSessionId),
        sessionVersion: { increment: 1 },
        familyId: rotated.familyId,
        refreshTokenId: rotated.refreshTokenId,
        refreshCiphertext: bytes(encrypted.ciphertext),
        refreshNonce: bytes(encrypted.nonce),
        refreshAuthTag: bytes(encrypted.authTag),
        encryptionKeyVersion: encrypted.keyVersion,
        lastActivityAt: now,
        idleExpiresAt,
      },
    });
    return count === 1
      ? { nextSessionId, idleExpiresAt, absoluteExpiresAt: current.absoluteExpiresAt }
      : null;
  }

  async logout(sessionId: string): Promise<void> {
    const stored = await this.findBySessionId(sessionId);
    if (!stored) return;
    const revokedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt, revokedReason: TokenRevocationReason.LOGOUT },
      }),
      this.prisma.webSession.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt, revokedReason: TokenRevocationReason.LOGOUT },
      }),
    ]);
  }

  private async recordActivity(session: StoredSession, now: Date): Promise<void> {
    if (now.getTime() - session.lastActivityAt.getTime() < ACTIVITY_SLIDE_MS) return;
    const idleExpiresAt = new Date(
      Math.min(now.getTime() + this.idleMs, session.absoluteExpiresAt.getTime()),
    );
    await this.prisma.webSession.updateMany({
      where: { id: session.id, sessionVersion: session.sessionVersion, revokedAt: null },
      data: { lastActivityAt: now, idleExpiresAt },
    });
  }

  private async markExpired(id: string): Promise<void> {
    await this.prisma.webSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

function versionOf(value: Date | null): number {
  return value?.getTime() ?? 0;
}

function bytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const copy = new ArrayBuffer(value.byteLength);
  new Uint8Array(copy).set(value);
  return new Uint8Array(copy);
}
