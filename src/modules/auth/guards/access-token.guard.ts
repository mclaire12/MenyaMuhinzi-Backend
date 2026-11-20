import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { UserStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { Permission, RoleCode } from '../../roles/rbac.constants';
import type { AccessTokenPayload, AuthenticatedUser } from '../auth.types';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import { accountStatusMessage } from '../account-status';
import { passwordVersion } from '../services/token.service';

/**
 * Global guard: every route requires a valid access token unless marked @Public().
 * The user, their status and their roles/permissions are re-read from the database
 * on each request, so suspensions and role changes take effect immediately.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = this.extractBearerToken(request);
    if (!token) throw new UnauthorizedException('Authentication required');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    if (payload.type !== 'access' || !payload.sub) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        passwordChangedAt: true,
        roles: {
          select: {
            role: {
              select: {
                code: true,
                permissions: { select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
      },
    });

    if (!user || user.deletedAt) throw new UnauthorizedException('Invalid or expired access token');

    if (payload.pv !== passwordVersion(user.passwordChangedAt)) {
      throw new UnauthorizedException('Session expired after a password change; sign in again');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(accountStatusMessage(user.status));
    }

    const permissions = new Set<Permission>();
    for (const { role } of user.roles) {
      for (const { permission } of role.permissions) permissions.add(permission.code as Permission);
    }

    request.user = {
      id: user.id,
      roles: user.roles.map(({ role }) => role.code as RoleCode),
      permissions: [...permissions],
    };
    return true;
  }

  private extractBearerToken(request: Request): string | undefined {
    const [scheme, value] = request.headers.authorization?.split(' ') ?? [];
    return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
  }
}
