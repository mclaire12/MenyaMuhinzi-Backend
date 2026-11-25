import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '../../../generated/prisma/client';
import { RoleCode } from '../../roles/rbac.constants';
import { EMAIL_NOT_VERIFIED } from '../account-status';
import { GoogleWebSessionAuthService } from './google-web-session-auth.service';

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u-1',
    fullName: 'Jeanne',
    phoneNumber: '+250788123456',
    email: 'jeanne@example.rw',
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    passwordChangedAt: null,
    roles: [{ role: { code: RoleCode.SmartphoneFarmer } }],
    ...overrides,
  };
}

function setup(user: ReturnType<typeof profile> | null) {
  const google = {
    verifyAuthorizationResponse: jest.fn().mockResolvedValue({
      identity: { subject: 'google-sub', email: 'jeanne@example.rw' },
      mode: 'login',
      context: {},
    }),
  };
  const prisma = {
    userOAuthIdentity: { findUnique: jest.fn().mockResolvedValue({ userId: 'u-1' }) },
    user: { findFirst: jest.fn().mockResolvedValue(user), update: jest.fn() },
  };
  const sessions = {
    create: jest.fn().mockResolvedValue({ sessionId: 'sid' }),
    findBySessionId: jest
      .fn()
      .mockResolvedValue({ idleExpiresAt: new Date(), absoluteExpiresAt: new Date() }),
  };
  const service = new GoogleWebSessionAuthService(
    google as never,
    prisma as never,
    {} as never,
    sessions as never,
    {} as never,
  );
  const complete = () =>
    service.complete(
      { state: 's', callbackUrl: 'https://app/cb?code=c&state=s' } as never,
      {} as never,
    );
  return { complete, sessions };
}

describe('GoogleWebSessionAuthService eligibility', () => {
  it('creates a session for an active, verified, linked farmer', async () => {
    const { complete, sessions } = setup(profile());
    await expect(complete()).resolves.toMatchObject({ sessionId: 'sid' });
    expect(sessions.create).toHaveBeenCalled();
  });

  it('refuses an approved account whose email is not verified yet', async () => {
    const { complete, sessions } = setup(profile({ emailVerifiedAt: null }));
    await expect(complete()).rejects.toThrow(new ForbiddenException(EMAIL_NOT_VERIFIED));
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it.each([UserStatus.PENDING, UserStatus.REJECTED, UserStatus.SUSPENDED])(
    'refuses %s accounts',
    async (status) => {
      const { complete, sessions } = setup(profile({ status }));
      await expect(complete()).rejects.toBeInstanceOf(ForbiddenException);
      expect(sessions.create).not.toHaveBeenCalled();
    },
  );

  it('keeps administrators and basic-phone farmers on password sign-in', async () => {
    for (const code of [RoleCode.Admin, RoleCode.BasicPhoneFarmer]) {
      const { complete } = setup(profile({ roles: [{ role: { code } }] }));
      await expect(complete()).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('does not link by email alone when no Google identity is linked', async () => {
    const { complete } = setup(null);
    await expect(complete()).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
