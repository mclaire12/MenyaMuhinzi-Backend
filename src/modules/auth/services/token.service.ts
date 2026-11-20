import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { parseDuration } from '../../../common/utils/duration';
import { jwtConfig } from '../../../config/configuration';
import { TokenRevocationReason, UserStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { RoleCode } from '../../roles/rbac.constants';
import { accountStatusMessage } from '../account-status';
import type { AccessTokenPayload, ClientContext } from '../auth.types';

/**
 * Access tokens carry the password version so a password change invalidates
 * them exactly; JWT `iat` only has one-second precision.
 */
export function passwordVersion(passwordChangedAt: Date | null): number {
  return passwordChangedAt?.getTime() ?? 0;
}

export interface IssuedTokens {
  tokenType: 'Bearer';
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/**
 * Access tokens are short-lived JWTs. Refresh tokens are opaque random strings
 * stored only as HMAC-SHA256 hashes, rotated on every use, and grouped in
 * families so that reuse of a rotated token revokes the whole login session.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlMs: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(jwtConfig.KEY) private readonly config: ConfigType<typeof jwtConfig>,
  ) {
    this.accessTtlSeconds = Math.floor(parseDuration(config.accessExpiresIn) / 1000);
    this.refreshTtlMs = parseDuration(config.refreshExpiresIn);
  }

  hashToken(token: string): string {
    return createHmac('sha256', this.config.refreshSecret).update(token).digest('hex');
  }

  generateOpaqueToken(bytes = 48): string {
    return randomBytes(bytes).toString('base64url');
  }

  async issue(
    user: { id: string; roles: RoleCode[]; passwordChangedAt: Date | null },
    client: ClientContext,
    familyId: string = randomUUID(),
  ): Promise<IssuedTokens & { refreshTokenId: string }> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      roles: user.roles,
      type: 'access',
      pv: passwordVersion(user.passwordChangedAt),
    };
    const accessToken = await this.jwt.signAsync(payload);

    const refreshToken = this.generateOpaqueToken();
    const refreshTokenExpiresAt = new Date(Date.now() + this.refreshTtlMs);
    const record = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        familyId,
        expiresAt: refreshTokenExpiresAt,
        ipAddress: client.ipAddress,
        userAgent: client.userAgent,
      },
      select: { id: true },
    });

    return {
      tokenType: 'Bearer',
      accessToken,
      expiresIn: this.accessTtlSeconds,
      refreshToken,
      refreshTokenExpiresAt,
      refreshTokenId: record.id,
    };
  }

  /** Validates a refresh token, revokes it and issues a replacement in the same family. */
  async rotate(refreshToken: string, client: ClientContext): Promise<IssuedTokens & { userId: string }> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
      select: {
        id: true,
        familyId: true,
        expiresAt: true,
        revokedAt: true,
        revokedReason: true,
        user: {
          select: {
            id: true,
            status: true,
            deletedAt: true,
            passwordChangedAt: true,
            roles: { select: { role: { select: { code: true } } } },
          },
        },
      },
    });

    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    if (stored.revokedAt) {
      if (stored.revokedReason === TokenRevocationReason.ROTATED) {
        await this.revokeFamily(stored.familyId, TokenRevocationReason.REUSE_DETECTED);
        this.logger.warn(`Refresh token reuse detected for user ${stored.user.id}; session revoked`);
        throw new UnauthorizedException('Refresh token reuse detected; please sign in again');
      }
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    const { user } = stored;
    if (user.deletedAt || user.status !== UserStatus.ACTIVE) {
      await this.revokeFamily(stored.familyId, TokenRevocationReason.ACCOUNT_DISABLED);
      throw new ForbiddenException(accountStatusMessage(user.status));
    }

    // Conditional update guards against two concurrent refreshes of the same token.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: TokenRevocationReason.ROTATED },
    });
    if (count === 0) {
      await this.revokeFamily(stored.familyId, TokenRevocationReason.REUSE_DETECTED);
      throw new UnauthorizedException('Refresh token reuse detected; please sign in again');
    }

    const issued = await this.issue(
      {
        id: user.id,
        roles: user.roles.map(({ role }) => role.code as RoleCode),
        passwordChangedAt: user.passwordChangedAt,
      },
      client,
      stored.familyId,
    );
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { replacedById: issued.refreshTokenId },
    });

    const { refreshTokenId: _id, ...tokens } = issued;
    return { ...tokens, userId: user.id };
  }

  /** Revokes the session the token belongs to. Returns false if it is not the user's token. */
  async revokeByToken(userId: string, refreshToken: string): Promise<boolean> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
      select: { userId: true, familyId: true },
    });
    if (!stored || stored.userId !== userId) return false;
    await this.revokeFamily(stored.familyId, TokenRevocationReason.LOGOUT);
    return true;
  }

  async revokeAllForUser(userId: string, reason: TokenRevocationReason): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  private async revokeFamily(familyId: string, reason: TokenRevocationReason): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}
