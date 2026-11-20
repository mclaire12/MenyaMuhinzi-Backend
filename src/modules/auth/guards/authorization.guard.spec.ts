import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, RoleCode } from '../../roles/rbac.constants';
import type { AuthenticatedUser } from '../auth.types';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, ROLES_KEY } from '../decorators/auth.decorators';
import { AuthorizationGuard } from './authorization.guard';
import { httpContext } from '../../../../test/utils/http-context';

function guardWith(metadata: Record<string, unknown>): AuthorizationGuard {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => metadata[key as string]);
  return new AuthorizationGuard(reflector);
}

const facilitator: AuthenticatedUser = {
  id: 'u1',
  roles: [RoleCode.Facilitator],
  permissions: [Permission.FarmersRead, Permission.FarmersUpdate],
};

describe('AuthorizationGuard', () => {
  it('allows routes without role or permission requirements', () => {
    expect(guardWith({}).canActivate(httpContext({ user: facilitator }))).toBe(true);
  });

  it('allows public routes without a user', () => {
    const guard = guardWith({ [IS_PUBLIC_KEY]: true, [ROLES_KEY]: [RoleCode.Admin] });
    expect(guard.canActivate(httpContext({}))).toBe(true);
  });

  it('accepts any one of the required roles', () => {
    const guard = guardWith({ [ROLES_KEY]: [RoleCode.Admin, RoleCode.Facilitator] });
    expect(guard.canActivate(httpContext({ user: facilitator }))).toBe(true);
  });

  it('forbids users without a required role', () => {
    const guard = guardWith({ [ROLES_KEY]: [RoleCode.Admin] });
    expect(() => guard.canActivate(httpContext({ user: facilitator }))).toThrow(ForbiddenException);
  });

  it('requires every listed permission', () => {
    const allowed = guardWith({ [PERMISSIONS_KEY]: [Permission.FarmersRead, Permission.FarmersUpdate] });
    expect(allowed.canActivate(httpContext({ user: facilitator }))).toBe(true);

    const denied = guardWith({ [PERMISSIONS_KEY]: [Permission.FarmersRead, Permission.FarmersCreate] });
    expect(() => denied.canActivate(httpContext({ user: facilitator }))).toThrow(
      new ForbiddenException('You do not have permission to perform this action'),
    );
  });

  it('rejects protected routes when no user was authenticated', () => {
    const guard = guardWith({ [ROLES_KEY]: [RoleCode.Admin] });
    expect(() => guard.canActivate(httpContext({}))).toThrow(UnauthorizedException);
  });
});
