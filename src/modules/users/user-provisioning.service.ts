import { ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import type { LocationDto } from '../../common/dto/location.dto';
import { normalizeLocation } from '../../common/dto/location.dto';
import {
  type FarmerCategory,
  type FarmerType,
  type Language,
  Prisma,
  UserStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PasswordHasher } from '../auth/services/password-hasher.service';
import type { RoleCode } from '../roles/rbac.constants';

export interface ProvisionAccountInput {
  fullName: string;
  phoneNumber: string;
  email?: string | null;
  password?: string;
  preferredLanguage?: Language;
  roles: RoleCode[];
  status: UserStatus;
  emailVerifiedAt?: Date;
  createdById?: string;
  location?: LocationDto;
  farmer?: { farmerType: FarmerType; farmerCategory?: FarmerCategory };
  facilitator?: {
    professionalTitle: string;
    organization: string;
    contactEmail?: string;
    contactPhone?: string;
  };
  /** Creates a PENDING account request for administrator approval. */
  accountRequest?: { requestedRole: RoleCode; submittedById?: string; notes?: string };
}

export interface ProvisionedAccount {
  userId: string;
  accountRequestId: string | null;
}

/**
 * Creates a user together with roles, profile, location and (optionally) an
 * account request in one transaction. A previously REJECTED applicant may apply
 * again with the same phone number; any other existing account is a conflict.
 */
@Injectable()
export class UserProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
  ) {}

  async provision(input: ProvisionAccountInput): Promise<ProvisionedAccount> {
    const passwordHash = input.password ? await this.hasher.hash(input.password) : undefined;
    const email = input.email ? input.email.toLowerCase() : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const roles = await tx.role.findMany({ where: { code: { in: input.roles } } });
        if (roles.length !== new Set(input.roles).size) {
          throw new InternalServerErrorException('Roles are not seeded; run `npm run db:seed`');
        }

        const requestedRoleId = input.accountRequest
          ? roles.find((role) => role.code === input.accountRequest?.requestedRole)?.id
          : undefined;

        const existing = await tx.user.findUnique({
          where: { phoneNumber: input.phoneNumber },
          select: { id: true, status: true, deletedAt: true },
        });
        const reusable =
          existing && existing.status === UserStatus.REJECTED && !existing.deletedAt && input.accountRequest
            ? existing
            : null;

        if (existing && !reusable) {
          throw new ConflictException(
            existing.status === UserStatus.PENDING
              ? 'An account request for this phone number is already pending approval'
              : 'An account with this phone number already exists',
          );
        }

        if (email) {
          const emailOwner = await tx.user.findUnique({ where: { email }, select: { id: true } });
          if (emailOwner && emailOwner.id !== reusable?.id) {
            throw new ConflictException('An account with this email address already exists');
          }
        }

        const location = input.location ? normalizeLocation(input.location) : undefined;
        const now = new Date();
        const userData = {
          fullName: input.fullName,
          email,
          preferredLanguage: input.preferredLanguage,
          status: input.status,
          // A re-application starts unverified: the (possibly new) address must be proven again.
          emailVerifiedAt: input.emailVerifiedAt ?? null,
          statusChangedAt: now,
          statusReason: null,
          ...(passwordHash ? { passwordHash, passwordChangedAt: now } : {}),
        };

        let userId: string;
        if (reusable) {
          userId = reusable.id;
          await tx.userRole.deleteMany({ where: { userId } });
          await tx.farmerProfile.deleteMany({ where: { userId } });
          await tx.facilitatorProfile.deleteMany({ where: { userId } });
          await tx.userLocation.deleteMany({ where: { userId } });
          await tx.user.update({ where: { id: userId }, data: userData });
        } else {
          const created = await tx.user.create({
            data: { ...userData, phoneNumber: input.phoneNumber, createdById: input.createdById },
            select: { id: true },
          });
          userId = created.id;
        }

        await tx.userRole.createMany({
          data: roles.map((role) => ({ userId, roleId: role.id, assignedById: input.createdById })),
        });
        if (location) await tx.userLocation.create({ data: { ...location, userId } });
        if (input.farmer) await tx.farmerProfile.create({ data: { ...input.farmer, userId } });
        if (input.facilitator) {
          await tx.facilitatorProfile.create({ data: { ...input.facilitator, userId } });
        }

        let accountRequestId: string | null = null;
        if (input.accountRequest && requestedRoleId) {
          const request = await tx.accountRequest.create({
            data: {
              userId,
              requestedRoleId,
              submittedById: input.accountRequest.submittedById,
              notes: input.accountRequest.notes,
            },
            select: { id: true },
          });
          accountRequestId = request.id;
        }

        return { userId, accountRequestId };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account with this phone number or email already exists');
      }
      throw error;
    }
  }
}
