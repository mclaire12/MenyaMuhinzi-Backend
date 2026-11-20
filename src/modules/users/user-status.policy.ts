import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserStatus } from '../../generated/prisma/client';
import { FARMER_ROLES, type RoleCode } from '../roles/rbac.constants';

const ALLOWED_TRANSITIONS: Record<UserStatus, readonly UserStatus[]> = {
  ACTIVE: [UserStatus.INACTIVE, UserStatus.SUSPENDED],
  INACTIVE: [UserStatus.ACTIVE, UserStatus.SUSPENDED],
  SUSPENDED: [UserStatus.ACTIVE, UserStatus.INACTIVE],
  PENDING: [],
  REJECTED: [],
};

/** Throws when an administrator status change is not allowed. */
export function assertStatusTransition(from: UserStatus, to: UserStatus): void {
  if (from === to) {
    throw new ConflictException(`Account is already ${to}`);
  }
  if (from === UserStatus.PENDING) {
    throw new ConflictException('Pending accounts must be approved or rejected through their account request');
  }
  if (from === UserStatus.REJECTED) {
    throw new ConflictException('Rejected accounts cannot be activated; the applicant must submit a new request');
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ConflictException(`Cannot change account status from ${from} to ${to}`);
  }
}

/** A user can be a smartphone farmer or a basic-phone farmer, not both. */
export function assertCompatibleRoles(roles: readonly RoleCode[]): void {
  if (roles.filter((role) => FARMER_ROLES.includes(role)).length > 1) {
    throw new BadRequestException('SMARTPHONE_FARMER and BASIC_PHONE_FARMER cannot be combined');
  }
}
