import type { Prisma } from '../../generated/prisma/client';
import type { RoleCode } from '../roles/rbac.constants';
import type { UserDetailResponseDto, UserResponseDto } from './dto/user-response.dto';

/**
 * Explicit selections: credentials (passwordHash, tokens, lockout counters)
 * are never loaded for API responses.
 */
export const userSummarySelect = {
  id: true,
  fullName: true,
  phoneNumber: true,
  email: true,
  status: true,
  statusReason: true,
  statusChangedAt: true,
  preferredLanguage: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  roles: { select: { role: { select: { code: true } } }, orderBy: { assignedAt: 'asc' } },
} satisfies Prisma.UserSelect;

export const locationSelect = {
  province: true,
  district: true,
  sector: true,
  cell: true,
  village: true,
} satisfies Prisma.UserLocationSelect;

export const userDetailSelect = {
  ...userSummarySelect,
  location: { select: locationSelect },
  farmerProfile: {
    select: { id: true, farmerType: true, farmerCategory: true, registeredAt: true },
  },
  facilitatorProfile: {
    select: {
      id: true,
      professionalTitle: true,
      organization: true,
      contactEmail: true,
      contactPhone: true,
    },
  },
} satisfies Prisma.UserSelect;

export type UserSummaryRecord = Prisma.UserGetPayload<{ select: typeof userSummarySelect }>;
export type UserDetailRecord = Prisma.UserGetPayload<{ select: typeof userDetailSelect }>;

export function toUserResponse(user: UserSummaryRecord): UserResponseDto {
  const { roles, ...rest } = user;
  return { ...rest, roles: roles.map(({ role }) => role.code as RoleCode) };
}

export function toUserDetailResponse(user: UserDetailRecord): UserDetailResponseDto {
  const { location, farmerProfile, facilitatorProfile, ...summary } = user;
  return {
    ...toUserResponse(summary),
    location: location ?? null,
    farmerProfile: farmerProfile ?? null,
    facilitatorProfile: facilitatorProfile ?? null,
  };
}
