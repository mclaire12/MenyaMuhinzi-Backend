import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserStatus } from '../../generated/prisma/client';
import { RoleCode } from '../roles/rbac.constants';
import { assertCompatibleRoles, assertStatusTransition } from './user-status.policy';

describe('assertStatusTransition', () => {
  it.each([
    [UserStatus.ACTIVE, UserStatus.SUSPENDED],
    [UserStatus.ACTIVE, UserStatus.INACTIVE],
    [UserStatus.SUSPENDED, UserStatus.ACTIVE],
    [UserStatus.INACTIVE, UserStatus.ACTIVE],
    [UserStatus.SUSPENDED, UserStatus.INACTIVE],
  ])('allows %s -> %s', (from, to) => {
    expect(() => assertStatusTransition(from, to)).not.toThrow();
  });

  it('rejects a no-op change', () => {
    expect(() => assertStatusTransition(UserStatus.ACTIVE, UserStatus.ACTIVE)).toThrow(
      new ConflictException('Account is already ACTIVE'),
    );
  });

  it('sends pending accounts through the approval workflow', () => {
    expect(() => assertStatusTransition(UserStatus.PENDING, UserStatus.ACTIVE)).toThrow(/account request/);
  });

  it('does not reactivate rejected accounts', () => {
    expect(() => assertStatusTransition(UserStatus.REJECTED, UserStatus.ACTIVE)).toThrow(/new request/);
  });
});

describe('assertCompatibleRoles', () => {
  it('allows a facilitator who is also a farmer', () => {
    expect(() => assertCompatibleRoles([RoleCode.Facilitator, RoleCode.SmartphoneFarmer])).not.toThrow();
  });

  it('rejects both farmer roles at once', () => {
    expect(() => assertCompatibleRoles([RoleCode.SmartphoneFarmer, RoleCode.BasicPhoneFarmer])).toThrow(
      BadRequestException,
    );
  });
});
