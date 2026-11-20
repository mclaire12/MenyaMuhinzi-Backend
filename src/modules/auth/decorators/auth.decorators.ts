import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import type { Permission, RoleCode } from '../../roles/rbac.constants';
import type { AuthenticatedUser, ClientContext } from '../auth.types';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';
export const PERMISSIONS_KEY = 'auth:permissions';
export const AUTH_RATE_LIMIT_KEY = 'auth:rateLimit';

/** Opts a route out of the global authentication guard. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Applies the stricter authentication rate limit (AUTH_RATE_LIMIT_MAX per window and IP). */
export const AuthRateLimit = (): MethodDecorator & ClassDecorator =>
  applyDecorators(
    SetMetadata(AUTH_RATE_LIMIT_KEY, true),
    ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Rate limit exceeded' }),
  );

export interface AuthorizeOptions {
  /** The user needs at least one of these roles. */
  roles?: RoleCode[];
  /** The user needs every one of these permissions. */
  permissions?: Permission[];
}

/**
 * Documents and enforces that a route requires a valid access token and,
 * optionally, specific roles or permissions.
 */
export function Authorize(options: AuthorizeOptions = {}): MethodDecorator & ClassDecorator {
  const requirements = [
    options.roles?.length ? `one of the roles ${options.roles.join(', ')}` : undefined,
    options.permissions?.length ? `the permissions ${options.permissions.join(', ')}` : undefined,
  ].filter(Boolean);

  return applyDecorators(
    SetMetadata(ROLES_KEY, options.roles ?? []),
    SetMetadata(PERMISSIONS_KEY, options.permissions ?? []),
    ApiBearerAuth('access-token'),
    ApiUnauthorizedResponse({
      type: ErrorResponseDto,
      description: 'Missing, invalid or expired access token',
    }),
    ApiForbiddenResponse({
      type: ErrorResponseDto,
      description: requirements.length
        ? `Account not active, or the caller lacks ${requirements.join(' and ')}`
        : 'Account not active',
    }),
  );
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    ctx.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>().user,
);

export const Client = createParamDecorator((_data: unknown, ctx: ExecutionContext): ClientContext => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return {
    ipAddress: req.ip?.slice(0, 64),
    userAgent: req.headers['user-agent']?.slice(0, 500),
  };
});
