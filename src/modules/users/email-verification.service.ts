import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { UserStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AccountEmailService, type VerificationEmailContext } from './account-email.service';

export const EMAIL_VERIFICATION_TTL_HOURS = 24;
/** A new verification email is not sent more often than this per account. */
export const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60_000;

/** Wrong codes allowed per email before the link is retired and a new email is needed. */
export const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;

export const INVALID_VERIFICATION_TOKEN = 'Email verification link is invalid or has expired';
export const INVALID_VERIFICATION_CODE = 'The verification code is incorrect';
export const RESEND_VERIFICATION_MESSAGE =
  'If an account matches and still needs verification, a new verification email has been sent.';

export interface VerificationIssueResult {
  /** True only when the SMTP server accepted the message. */
  emailSent: boolean;
}

/** SHA-256 of a 256-bit random token; only the hash is persisted. */
export function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The code is hashed together with its token hash so equal codes never share a hash. */
export function hashVerificationCode(tokenHash: string, code: string): string {
  return createHash('sha256').update(`${tokenHash}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Single-use, expiring email verification tokens. Plaintext tokens exist only in the
 * outgoing email; they are never stored, logged or returned by the API.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: AccountEmailService,
  ) {}

  /** Replaces any outstanding token for the user and emails a new verification link. */
  async issue(userId: string, context: VerificationEmailContext): Promise<VerificationIssueResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, preferredLanguage: true, emailVerifiedAt: true },
    });
    if (!user?.email || user.emailVerifiedAt) return { emailSent: false };

    const token = randomBytes(32).toString('base64url');
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const tokenHash = hashVerificationToken(token);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now },
      }),
      this.prisma.emailVerificationToken.create({
        data: {
          userId,
          email: user.email,
          tokenHash,
          otpHash: hashVerificationCode(tokenHash, code),
          expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_HOURS * 3_600_000),
        },
      }),
    ]);

    const outcome = await this.mail.sendVerification({
      userId,
      to: user.email,
      language: user.preferredLanguage,
      token,
      code,
      expiresHours: EMAIL_VERIFICATION_TTL_HOURS,
      context,
    });
    return { emailSent: outcome.delivered };
  }

  /**
   * Consumes a token together with the 6-digit code from the same email. Only ACTIVE
   * accounts can be verified, so a facilitator whose request is still pending (or was
   * rejected) can never bypass approval this way. Wrong codes are counted per token and
   * the token is retired after EMAIL_VERIFICATION_MAX_ATTEMPTS.
   */
  async verify(token: string, code: string): Promise<void> {
    const tokenHash = hashVerificationToken(token);
    const stored = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        email: true,
        expiresAt: true,
        usedAt: true,
        otpHash: true,
        failedAttempts: true,
        user: { select: { email: true, status: true, deletedAt: true } },
      },
    });
    if (
      !stored ||
      !stored.otpHash ||
      stored.usedAt ||
      stored.expiresAt.getTime() <= Date.now() ||
      stored.failedAttempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS
    ) {
      throw new BadRequestException(INVALID_VERIFICATION_TOKEN);
    }
    // The address changed after the link was sent, or the account is not eligible.
    if (
      stored.user.deletedAt ||
      stored.user.status !== UserStatus.ACTIVE ||
      stored.user.email?.toLowerCase() !== stored.email.toLowerCase()
    ) {
      throw new BadRequestException(INVALID_VERIFICATION_TOKEN);
    }

    if (!sameHash(stored.otpHash, hashVerificationCode(tokenHash, code))) {
      const attempts = stored.failedAttempts + 1;
      await this.prisma.emailVerificationToken.updateMany({
        where: { id: stored.id, usedAt: null },
        data: {
          failedAttempts: { increment: 1 },
          ...(attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS ? { usedAt: new Date() } : {}),
        },
      });
      const remaining = Math.max(0, EMAIL_VERIFICATION_MAX_ATTEMPTS - attempts);
      if (remaining === 0) throw new BadRequestException(INVALID_VERIFICATION_TOKEN);
      throw new BadRequestException(
        `${INVALID_VERIFICATION_CODE}. ${remaining} attempt(s) remaining.`,
      );
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Conditional update: a token can be consumed exactly once even under concurrency.
      const { count } = await tx.emailVerificationToken.updateMany({
        where: { id: stored.id, usedAt: null },
        data: { usedAt: now },
      });
      if (count === 0) throw new BadRequestException(INVALID_VERIFICATION_TOKEN);
      await tx.user.update({ where: { id: stored.userId }, data: { emailVerifiedAt: now } });
    });
  }

  /** Generic response whether or not the identifier matches an eligible account. */
  async resend(where: { email: string } | { phoneNumber: string }): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({
      where: { deletedAt: null, status: UserStatus.ACTIVE, emailVerifiedAt: null, ...where },
      select: {
        id: true,
        emailVerificationTokens: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
    const last = user?.emailVerificationTokens[0]?.createdAt;
    if (user && (!last || Date.now() - last.getTime() >= EMAIL_VERIFICATION_RESEND_COOLDOWN_MS)) {
      await this.issue(user.id, 'resend');
    }
    return { message: RESEND_VERIFICATION_MESSAGE };
  }
}
