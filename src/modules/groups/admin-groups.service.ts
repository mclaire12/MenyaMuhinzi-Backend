import { Injectable, NotFoundException } from '@nestjs/common';
import { normalizeLocation } from '../../common/dto/location.dto';
import { paginated, paginationArgs, type Paginated } from '../../common/dto/pagination.dto';
import { Prisma, RecordStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { cropSummarySelect } from '../crops/crop.lookup';
import { assertActiveCrop } from '../crops/crop.lookup';
import type {
  AdminGroupResponseDto,
  CreateAdminGroupDto,
  ListAdminGroupsQueryDto,
  UpdateAdminGroupDto,
} from './dto/admin-group.dto';

const adminGroupSelect = {
  id: true,
  name: true,
  description: true,
  targetAudience: true,
  province: true,
  district: true,
  sector: true,
  estimatedFarmerCount: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  crop: { select: cropSummarySelect },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.AdminTargetingGroupSelect;

type AdminGroupRecord = Prisma.AdminTargetingGroupGetPayload<{ select: typeof adminGroupSelect }>;

@Injectable()
export class AdminGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAdminGroupDto, actor: AuthenticatedUser): Promise<AdminGroupResponseDto> {
    await assertActiveCrop(this.prisma, dto.cropId);
    const location = normalizeLocation(dto.location);
    const group = await this.prisma.adminTargetingGroup.create({
      data: {
        name: dto.name,
        description: dto.description,
        cropId: dto.cropId,
        targetAudience: dto.targetAudience,
        province: location.province,
        district: location.district,
        sector: location.sector ?? null,
        estimatedFarmerCount: dto.estimatedFarmerCount ?? 0,
        createdById: actor.id,
      },
      select: adminGroupSelect,
    });
    return toAdminGroup(group);
  }

  async list(query: ListAdminGroupsQueryDto): Promise<Paginated<AdminGroupResponseDto>> {
    const where: Prisma.AdminTargetingGroupWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.province) where.province = query.province;
    if (query.cropId) where.cropId = query.cropId;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [groups, total] = await this.prisma.$transaction([
      this.prisma.adminTargetingGroup.findMany({
        where,
        select: adminGroupSelect,
        orderBy: { createdAt: 'desc' },
        ...paginationArgs(query),
      }),
      this.prisma.adminTargetingGroup.count({ where }),
    ]);
    return paginated(groups.map(toAdminGroup), total, query);
  }

  async findOne(id: string): Promise<AdminGroupResponseDto> {
    const group = await this.prisma.adminTargetingGroup.findUnique({
      where: { id },
      select: adminGroupSelect,
    });
    if (!group) throw new NotFoundException('Targeting group not found');
    return toAdminGroup(group);
  }

  async update(id: string, dto: UpdateAdminGroupDto): Promise<AdminGroupResponseDto> {
    await this.findOne(id);
    if (dto.cropId) await assertActiveCrop(this.prisma, dto.cropId);
    const location = dto.location ? normalizeLocation(dto.location) : undefined;
    const group = await this.prisma.adminTargetingGroup.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        cropId: dto.cropId,
        targetAudience: dto.targetAudience,
        estimatedFarmerCount: dto.estimatedFarmerCount,
        status: dto.status,
        ...(location
          ? {
              province: location.province,
              district: location.district,
              sector: location.sector ?? null,
            }
          : {}),
      },
      select: adminGroupSelect,
    });
    return toAdminGroup(group);
  }

  /** Keeps the group so publication history still resolves. */
  async deactivate(id: string): Promise<AdminGroupResponseDto> {
    await this.findOne(id);
    const group = await this.prisma.adminTargetingGroup.update({
      where: { id },
      data: { status: RecordStatus.INACTIVE },
      select: adminGroupSelect,
    });
    return toAdminGroup(group);
  }
}

function toAdminGroup(group: AdminGroupRecord): AdminGroupResponseDto {
  return group;
}
