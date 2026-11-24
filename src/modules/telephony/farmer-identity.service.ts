import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Language, UserStatus, type Prisma } from '../../generated/prisma/client';
import { normalizeRwandanPhone } from '../../common/utils/phone';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { accountStatusMessage } from '../auth/account-status';
import type { Permission, RoleCode } from '../roles/rbac.constants';

const userSelect = {
  id: true,
  phoneNumber: true,
  status: true,
  preferredLanguage: true,
  deletedAt: true,
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
} satisfies Prisma.UserSelect;

export interface ResolvedTelephonyFarmer {
  phoneNumber: string;
  preferredLanguage: Language;
  actor: AuthenticatedUser;
}

@Injectable()
export class FarmerIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveByPhone(rawPhone: string): Promise<ResolvedTelephonyFarmer> {
    const phoneNumber = normalizeRwandanPhone(rawPhone);
    const user = await this.prisma.user.findUnique({ where: { phoneNumber }, select: userSelect });
    if (!user || user.deletedAt) {
      throw new NotFoundException('No registered farmer for this phone number');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(accountStatusMessage(user.status));
    }
    return {
      phoneNumber,
      preferredLanguage: user.preferredLanguage,
      actor: toActor(user),
    };
  }

  async tryResolveByPhone(rawPhone: string): Promise<ResolvedTelephonyFarmer | null> {
    try {
      return await this.resolveByPhone(rawPhone);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) return null;
      throw error;
    }
  }
}

function toActor(user: Prisma.UserGetPayload<{ select: typeof userSelect }>): AuthenticatedUser {
  const permissions = new Set<Permission>();
  for (const { role } of user.roles) {
    for (const { permission } of role.permissions) {
      permissions.add(permission.code as Permission);
    }
  }
  return {
    id: user.id,
    roles: user.roles.map(({ role }) => role.code as RoleCode),
    permissions: [...permissions],
  };
}