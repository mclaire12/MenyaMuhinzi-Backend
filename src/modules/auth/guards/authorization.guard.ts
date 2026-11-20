import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission, RoleCode } from '../../roles/rbac.constants';
import type { AuthenticatedUser } from '../auth.types';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, ROLES_KEY } from '../decorators/auth.decorators';

/**
 * Global guard enforcing @Authorize({ roles, permissions }).
 * Roles are any-of; permissions are all-of.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const roles = this.reflector.getAllAndOverride<RoleCode[] | undefined>(ROLES_KEY, targets) ?? [];
    const permissions =
      this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, targets) ?? [];
    if (roles.length === 0 && permissions.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new UnauthorizedException('Authentication required');

    if (roles.length > 0 && !roles.some((role) => user.roles.includes(role))) {
      throw new ForbiddenException('You do not have the role required for this action');
    }
    if (!permissions.every((permission) => user.permissions.includes(permission))) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
}
