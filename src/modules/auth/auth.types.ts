import type { Permission, RoleCode } from '../roles/rbac.constants';

/** Attached to `request.user` by AccessTokenGuard; always loaded fresh from the database. */
export interface AuthenticatedUser {
  id: string;
  roles: RoleCode[];
  permissions: Permission[];
}

export interface AccessTokenPayload {
  sub: string;
  roles: string[];
  type: 'access';
  /** Password version: passwordChangedAt in ms (0 if never changed) when the token was issued. */
  pv: number;
  iat?: number;
  exp?: number;
}

export interface ClientContext {
  ipAddress?: string;
  userAgent?: string;
}
