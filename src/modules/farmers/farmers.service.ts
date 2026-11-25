import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizeLocation } from '../../common/dto/location.dto';
import { paginated, paginationArgs, type Paginated } from '../../common/dto/pagination.dto';
import { findDistrict } from '../../common/rwanda/administrative-divisions';
import { FarmerType, Prisma, UserStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RoleCode } from '../roles/rbac.constants';
import { locationSelect } from '../users/user.mapper';
import { EmailVerificationService } from '../users/email-verification.service';
import { UserProvisioningService } from '../users/user-provisioning.service';
import { searchConditions } from '../users/users.service';
import type {
  CreateFarmerDto,
  FarmerResponseDto,
  ListFarmersQueryDto,
  UpdateFarmerDto,
} from './dto/farmer.dto';

const farmerSelect = {
  id: true,
  fullName: true,
  phoneNumber: true,
  email: true,
  preferredLanguage: true,
  status: true,
  updatedAt: true,
  location: { select: locationSelect },
  farmerProfile: {
    select: { id: true, farmerType: true, farmerCategory: true, registeredAt: true },
  },
} satisfies Prisma.UserSelect;

type FarmerRecord = Prisma.UserGetPayload<{ select: typeof farmerSelect }>;

export function farmerRoleFor(type: FarmerType): RoleCode {
  return type === FarmerType.SMARTPHONE ? RoleCode.SmartphoneFarmer : RoleCode.BasicPhoneFarmer;
}

@Injectable()
export class FarmersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: UserProvisioningService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  async list(query: ListFarmersQueryDto): Promise<Paginated<FarmerResponseDto>> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      farmerProfile:
        query.farmerType || query.farmerCategory
          ? {
              is: {
                ...(query.farmerType ? { farmerType: query.farmerType } : {}),
                ...(query.farmerCategory ? { farmerCategory: query.farmerCategory } : {}),
              },
            }
          : { isNot: null },
    };
    if (query.status) where.status = query.status;
    if (query.search) where.OR = searchConditions(query.search);
    if (query.province || query.district) {
      const district =
        query.district && query.province
          ? (findDistrict(query.province, query.district) ?? query.district)
          : query.district;
      where.location = {
        is: {
          ...(query.province ? { province: query.province } : {}),
          ...(district ? { district: { equals: district, mode: 'insensitive' } } : {}),
        },
      };
    }

    const [farmers, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: farmerSelect,
        orderBy: { createdAt: query.sort },
        ...paginationArgs(query),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(farmers.map(toFarmerResponse), total, query);
  }

  async findOne(userId: string): Promise<FarmerResponseDto> {
    const farmer = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, farmerProfile: { isNot: null } },
      select: farmerSelect,
    });
    if (!farmer) throw new NotFoundException('Farmer not found');
    return toFarmerResponse(farmer);
  }

  async create(dto: CreateFarmerDto, actor: AuthenticatedUser): Promise<FarmerResponseDto> {
    const { farmerType, farmerCategory, location, ...account } = dto;
    const { userId } = await this.provisioning.provision({
      ...account,
      roles: [farmerRoleFor(farmerType)],
      status: UserStatus.ACTIVE,
      createdById: actor.id,
      location,
      farmer: { farmerType, farmerCategory },
    });
    const { emailSent } = await this.emailVerification.issue(userId, 'staff-created');
    return { ...(await this.findOne(userId)), emailSent };
  }

  async update(userId: string, dto: UpdateFarmerDto): Promise<FarmerResponseDto> {
    await this.findOne(userId);
    const location = dto.location ? normalizeLocation(dto.location) : undefined;
    const locationData = location
      ? {
          province: location.province,
          district: location.district,
          sector: location.sector,
          cell: location.cell ?? null,
          village: location.village ?? null,
        }
      : undefined;

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          fullName: dto.fullName,
          phoneNumber: dto.phoneNumber,
          email: dto.email,
          preferredLanguage: dto.preferredLanguage,
          farmerProfile: dto.farmerCategory
            ? { update: { farmerCategory: dto.farmerCategory } }
            : undefined,
          location: locationData
            ? { upsert: { create: locationData, update: locationData } }
            : undefined,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Another account already uses this phone number or email');
      }
      throw error;
    }
    return this.findOne(userId);
  }
}

function toFarmerResponse(user: FarmerRecord): FarmerResponseDto {
  const profile = user.farmerProfile as NonNullable<FarmerRecord['farmerProfile']>;
  return {
    userId: user.id,
    profileId: profile.id,
    fullName: user.fullName,
    phoneNumber: user.phoneNumber,
    email: user.email,
    preferredLanguage: user.preferredLanguage,
    status: user.status,
    farmerType: profile.farmerType,
    farmerCategory: profile.farmerCategory,
    registeredAt: profile.registeredAt,
    location: user.location ?? null,
    updatedAt: user.updatedAt,
  };
}
