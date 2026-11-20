import { UserStatus } from '../../generated/prisma/client';

const MESSAGES: Record<UserStatus, string> = {
  ACTIVE: 'Account is active',
  PENDING: 'Your account is awaiting administrator approval',
  INACTIVE: 'Your account has been deactivated; contact an administrator',
  SUSPENDED: 'Your account has been suspended; contact an administrator',
  REJECTED: 'Your account request was rejected',
};

export function accountStatusMessage(status: UserStatus): string {
  return MESSAGES[status];
}
