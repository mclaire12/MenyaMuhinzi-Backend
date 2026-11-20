import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../infrastructure/database/prisma.service';
import { Permission, RoleCode } from '../../roles/rbac.constants';
import type { AuthenticatedUser } from '../auth.types';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import { AccessTokenGuard } from './access-token.guard';
import { httpContext } from '../../../../test/utils/http-context';

const SECRET = 'unit-test-secret-0123456789abcdefghijklmnop';

describe('AccessTokenGuard', () => {
  const jwt = new JwtService({ secret: SECRET });
  const findUnique = jest.fn();
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  let reflector: Reflector;
  let guard: AccessTokenGuard;

  const activeUser = {
    id: 'user-1',
    status: UserStatus.ACTIVE,
    deletedAt: null,
    passwordChangedAt: null as Date | null,
    roles: [
      {
        role: {
          code: RoleCode.Facilitator,
          permissions: [{ permission: { code: Permission.FarmersRead } }],
        },
      },
    ],
  };

  const sign = (payload: Record<string, unknown> = { sub: 'user-1', roles: [], type: 'access', pv: 0 }) =>
    jwt.signAsync(payload);

  beforeEach(() => {
    findUnique.mockReset();
    reflector = new Reflector();
    guard = new AccessTokenGuard(reflector, jwt, prisma);
  });

  it('skips public routes', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => key === IS_PUBLIC_KEY);
    await expect(guard.canActivate(httpContext({ headers: {} }))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('requires a bearer token', async () => {
    await expect(guard.canActivate(httpContext({ headers: {} }))).rejects.toThrow(
      new UnauthorizedException('Authentication required'),
    );
    await expect(
      guard.canActivate(httpContext({ headers: { authorization: 'Basic abc' } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects tokens signed with another secret', async () => {
    const forged = await new JwtService({ secret: 'another-secret' }).signAsync({ sub: 'user-1', type: 'access' });
    await expect(
      guard.canActivate(httpContext({ headers: { authorization: `Bearer ${forged}` } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects expired tokens', async () => {
    const expired = await jwt.signAsync({ sub: 'user-1', type: 'access' }, { expiresIn: -10 });
    await expect(
      guard.canActivate(httpContext({ headers: { authorization: `Bearer ${expired}` } })),
    ).rejects.toThrow(new UnauthorizedException('Invalid or expired access token'));
  });

  it('attaches the user with roles and permissions loaded from the database', async () => {
    findUnique.mockResolvedValue(activeUser);
    const request: { headers: Record<string, string>; user?: AuthenticatedUser } = {
      headers: { authorization: `Bearer ${await sign()}` },
    };

    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'user-1',
      roles: [RoleCode.Facilitator],
      permissions: [Permission.FarmersRead],
    });
  });

  it.each([UserStatus.PENDING, UserStatus.SUSPENDED, UserStatus.INACTIVE, UserStatus.REJECTED])(
    'forbids %s accounts',
    async (status) => {
      findUnique.mockResolvedValue({ ...activeUser, status });
      await expect(
        guard.canActivate(httpContext({ headers: { authorization: `Bearer ${await sign()}` } })),
      ).rejects.toThrow(ForbiddenException);
    },
  );

  it('rejects deleted users', async () => {
    findUnique.mockResolvedValue({ ...activeUser, deletedAt: new Date() });
    await expect(
      guard.canActivate(httpContext({ headers: { authorization: `Bearer ${await sign()}` } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects tokens issued before the last password change, even within the same second', async () => {
    const changedAt = new Date();
    const token = await sign();
    findUnique.mockResolvedValue({ ...activeUser, passwordChangedAt: changedAt });
    await expect(
      guard.canActivate(httpContext({ headers: { authorization: `Bearer ${token}` } })),
    ).rejects.toThrow(/password change/);
  });

  it('accepts tokens issued after the last password change', async () => {
    const changedAt = new Date(Date.now() - 60_000);
    const token = await sign({ sub: 'user-1', roles: [], type: 'access', pv: changedAt.getTime() });
    findUnique.mockResolvedValue({ ...activeUser, passwordChangedAt: changedAt });
    await expect(
      guard.canActivate(httpContext({ headers: { authorization: `Bearer ${token}` } })),
    ).resolves.toBe(true);
  });

  it('rejects tokens that are not access tokens', async () => {
    const token = await sign({ sub: 'user-1', type: 'refresh' });
    await expect(
      guard.canActivate(httpContext({ headers: { authorization: `Bearer ${token}` } })),
    ).rejects.toThrow(UnauthorizedException);
  });
});
