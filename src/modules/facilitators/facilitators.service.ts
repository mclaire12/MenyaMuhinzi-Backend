import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizeLocation } from '../../common/dto/location.dto';
import { paginated, paginationArgs, type Paginated } from '../../common/dto/pagination.dto';
import { Prisma, UserStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RoleCode } from '../roles/rbac.constants';
import { locationSelect } from '../users/user.mapper';
import { UserProvisioningService } from '../users/user-provisioning.service';
import { searchConditions } from '../users/users.service';
import type {
  CreateFacilitatorDto,
  FacilitatorResponseDto,
  ListFacilitatorsQueryDto,
  UpdateFacilitatorDto,
} from './dto/facilitator.dto';

const facilitatorSelect = {
  id: true,
  fullName: true,
  phoneNumber: true,
  email: true,
  preferredLanguage: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  location: { select: locationSelect },
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

type FacilitatorRecord = Prisma.UserGetPayload<{ select: typeof facilitatorSelect }>;

@Injectable()
export class FacilitatorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: UserProvisioningService,
  ) {}

  async list(query: ListFacilitatorsQueryDto): Promise<Paginated<FacilitatorResponseDto>> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      facilitatorProfile: query.organization
        ? { is: { organization: { contains: query.organization, mode: 'insensitive' } } }
        : { isNot: null },
    };
    if (query.status) where.status = query.status;
    if (query.search) where.OR = searchConditions(query.search);
    if (query.province) where.location = { is: { province: query.province } };

    const [facilitators, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: facilitatorSelect,
        orderBy: { createdAt: query.sort },
        ...paginationArgs(query),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(facilitators.map(toFacilitatorResponse), total, query);
  }

  async findOne(userId: string): Promise<FacilitatorResponseDto> {
    const facilitator = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, facilitatorProfile: { isNot: null } },
      select: facilitatorSelect,
    });
    if (!facilitator) throw new NotFoundException('Facilitator not found');
    return toFacilitatorResponse(facilitator);
  }

  async create(dto: CreateFacilitatorDto, actor: AuthenticatedUser): Promise<FacilitatorResponseDto> {
    const { professionalTitle, organization, contactEmail, contactPhone, location, ...account } = dto;
    const { userId } = await this.provisioning.provision({
      ...account,
      roles: [RoleCode.Facilitator],
      status: UserStatus.ACTIVE,
      createdById: actor.id,
      location,
      facilitator: { professionalTitle, organization, contactEmail, contactPhone },
    });
    return this.findOne(userId);
  }

  async update(userId: string, dto: UpdateFacilitatorDto): Promise<FacilitatorResponseDto> {
    await this.findOne(userId);
    const location = dto.location ? normalizeLocation(dto.location) : undefined;
    const locationData = location
      ? {
          province: location.province,
          district: location.district,
          sector: location.sector ?? null,
          cell: location.cell ?? null,
          village: location.village ?? null,
        }
      : undefined;
    const profileData = {
      professionalTitle: dto.professionalTitle,
      organization: dto.organization,
      contactEmail: dto.contactEmail,
      contactPhone: dto.contactPhone,
    };
    const hasProfileChanges = Object.values(profileData).some((value) => value !== undefined);

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          fullName: dto.fullName,
          phoneNumber: dto.phoneNumber,
          email: dto.email,
          preferredLanguage: dto.preferredLanguage,
          facilitatorProfile: hasProfileChanges ? { update: profileData } : undefined,
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

function toFacilitatorResponse(user: FacilitatorRecord): FacilitatorResponseDto {
  const profile = user.facilitatorProfile as NonNullable<FacilitatorRecord['facilitatorProfile']>;
  return {
    userId: user.id,
    profileId: profile.id,
    fullName: user.fullName,
    phoneNumber: user.phoneNumber,
    email: user.email,
    preferredLanguage: user.preferredLanguage,
    status: user.status,
    professionalTitle: profile.professionalTitle,
    organization: profile.organization,
    contactEmail: profile.contactEmail,
    contactPhone: profile.contactPhone,
    location: user.location ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
