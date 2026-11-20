import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizeLocation } from '../../common/dto/location.dto';
import { paginated, paginationArgs, type Paginated } from '../../common/dto/pagination.dto';
import { FarmerType, Prisma, RecordStatus, UserStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { assertActiveCrop, cropSummarySelect } from '../crops/crop.lookup';
import { NotificationEvent } from '../notifications/events/notification-events';
import { NotificationPublisher } from '../notifications/publishing/notification-publisher.service';
import { FARMER_ROLES, RoleCode } from '../roles/rbac.constants';
import { searchConditions } from '../users/users.service';
import type {
  AddGroupMembersDto,
  CreateFacilitatorGroupDto,
  FacilitatorGroupResponseDto,
  GroupMemberResponseDto,
  ListFacilitatorGroupsQueryDto,
  ListGroupMembersQueryDto,
  UpdateFacilitatorGroupDto,
} from './dto/facilitator-group.dto';

const groupSelect = {
  id: true,
  name: true,
  description: true,
  province: true,
  district: true,
  sector: true,
  cell: true,
  village: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  crop: { select: cropSummarySelect },
  facilitator: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
  _count: { select: { members: true } },
} satisfies Prisma.FacilitatorGroupSelect;

type GroupRecord = Prisma.FacilitatorGroupGetPayload<{ select: typeof groupSelect }>;

const memberSelect = {
  addedAt: true,
  user: {
    select: {
      id: true,
      fullName: true,
      phoneNumber: true,
      email: true,
      status: true,
      roles: { select: { role: { select: { code: true } } } },
    },
  },
} satisfies Prisma.FacilitatorGroupMemberSelect;

type MemberRecord = Prisma.FacilitatorGroupMemberGetPayload<{ select: typeof memberSelect }>;

export function isAdmin(actor: AuthenticatedUser): boolean {
  return actor.roles.includes(RoleCode.Admin);
}

@Injectable()
export class FacilitatorGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationPublisher,
  ) {}

  async create(
    dto: CreateFacilitatorGroupDto,
    actor: AuthenticatedUser,
  ): Promise<FacilitatorGroupResponseDto> {
    const facilitatorId = await this.resolveFacilitator(dto.facilitatorId, actor);
    await assertActiveCrop(this.prisma, dto.cropId);
    const location = normalizeLocation(dto.location);
    const group = await this.prisma.facilitatorGroup.create({
      data: {
        name: dto.name,
        description: dto.description,
        facilitatorId,
        cropId: dto.cropId,
        province: location.province,
        district: location.district,
        sector: location.sector,
        cell: location.cell ?? null,
        village: location.village ?? null,
        createdById: actor.id,
      },
      select: groupSelect,
    });
    return toGroup(group);
  }

  async list(
    query: ListFacilitatorGroupsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<Paginated<FacilitatorGroupResponseDto>> {
    const where: Prisma.FacilitatorGroupWhereInput = {};
    if (isAdmin(actor)) {
      if (query.facilitatorId) where.facilitatorId = query.facilitatorId;
    } else {
      where.facilitatorId = actor.id;
    }
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
      this.prisma.facilitatorGroup.findMany({
        where,
        select: groupSelect,
        orderBy: { createdAt: 'desc' },
        ...paginationArgs(query),
      }),
      this.prisma.facilitatorGroup.count({ where }),
    ]);
    return paginated(groups.map(toGroup), total, query);
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<FacilitatorGroupResponseDto> {
    return toGroup(await this.accessible(id, actor));
  }

  async update(
    id: string,
    dto: UpdateFacilitatorGroupDto,
    actor: AuthenticatedUser,
  ): Promise<FacilitatorGroupResponseDto> {
    await this.accessible(id, actor);
    if (dto.facilitatorId && !isAdmin(actor)) {
      throw new ForbiddenException('Only an administrator can reassign a group');
    }
    if (dto.cropId) await assertActiveCrop(this.prisma, dto.cropId);
    const facilitatorId = dto.facilitatorId
      ? await this.assertActiveFacilitator(dto.facilitatorId)
      : undefined;
    const location = dto.location ? normalizeLocation(dto.location) : undefined;
    const group = await this.prisma.facilitatorGroup.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        cropId: dto.cropId,
        facilitatorId,
        status: dto.status,
        ...(location
          ? {
              province: location.province,
              district: location.district,
              sector: location.sector,
              cell: location.cell ?? null,
              village: location.village ?? null,
            }
          : {}),
      },
      select: groupSelect,
    });
    return toGroup(group);
  }

  async deactivate(id: string, actor: AuthenticatedUser): Promise<FacilitatorGroupResponseDto> {
    await this.accessible(id, actor);
    const group = await this.prisma.facilitatorGroup.update({
      where: { id },
      data: { status: RecordStatus.INACTIVE },
      select: groupSelect,
    });
    return toGroup(group);
  }

  async addMembers(
    id: string,
    dto: AddGroupMembersDto,
    actor: AuthenticatedUser,
  ): Promise<GroupMemberResponseDto[]> {
    const group = await this.accessible(id, actor);
    if (group.status !== RecordStatus.ACTIVE) {
      throw new ConflictException('Inactive groups cannot take new members');
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: dto.userIds }, deletedAt: null },
      select: {
        id: true,
        status: true,
        roles: { select: { role: { select: { code: true } } } },
      },
    });
    if (users.length !== dto.userIds.length) {
      throw new BadRequestException('One or more users are not registered');
    }
    for (const user of users) {
      const codes = user.roles.map(({ role }) => role.code);
      if (codes.includes(RoleCode.Admin) || codes.includes(RoleCode.Facilitator)) {
        throw new BadRequestException(
          'Facilitators and administrators cannot be added as farmer members',
        );
      }
      if (!codes.some((code) => FARMER_ROLES.includes(code as RoleCode))) {
        throw new BadRequestException('Only registered farmers can be added to a farmer group');
      }
      if (user.status !== UserStatus.ACTIVE) {
        throw new BadRequestException('Only active farmers can be added to a group');
      }
    }

    try {
      await this.prisma.facilitatorGroupMember.createMany({
        data: dto.userIds.map((userId) => ({ groupId: id, userId, addedById: actor.id })),
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('One or more farmers are already members of this group');
      }
      throw error;
    }

    const members = await this.prisma.facilitatorGroupMember.findMany({
      where: { groupId: id, userId: { in: dto.userIds } },
      select: memberSelect,
      orderBy: { addedAt: 'asc' },
    });
    for (const userId of dto.userIds) {
      await this.notifications.notifyEvent(
        NotificationEvent.GroupMemberAdded,
        userId,
        { groupName: group.name },
        { entity: { type: 'farmer-group', id } },
      );
    }
    return members.map(toMember);
  }

  async listMembers(
    id: string,
    query: ListGroupMembersQueryDto,
    actor: AuthenticatedUser,
  ): Promise<Paginated<GroupMemberResponseDto>> {
    await this.accessible(id, actor);
    const farmerRole =
      query.farmerType === FarmerType.SMARTPHONE
        ? RoleCode.SmartphoneFarmer
        : query.farmerType === FarmerType.BASIC_PHONE
          ? RoleCode.BasicPhoneFarmer
          : undefined;
    const where: Prisma.FacilitatorGroupMemberWhereInput = {
      groupId: id,
      user: {
        deletedAt: null,
        ...(farmerRole ? { roles: { some: { role: { code: farmerRole } } } } : {}),
        ...(query.search ? { OR: searchConditions(query.search) } : {}),
      },
    };
    const [members, total] = await this.prisma.$transaction([
      this.prisma.facilitatorGroupMember.findMany({
        where,
        select: memberSelect,
        orderBy: { addedAt: 'asc' },
        ...paginationArgs(query),
      }),
      this.prisma.facilitatorGroupMember.count({ where }),
    ]);
    return paginated(members.map(toMember), total, query);
  }

  async removeMember(id: string, userId: string, actor: AuthenticatedUser): Promise<void> {
    await this.accessible(id, actor);
    const { count } = await this.prisma.facilitatorGroupMember.deleteMany({
      where: { groupId: id, userId },
    });
    if (count === 0) throw new NotFoundException('Farmer is not a member of this group');
  }

  /** Group plus the fields needed to test course eligibility. */
  async accessible(id: string, actor: AuthenticatedUser): Promise<GroupRecord> {
    const group = await this.prisma.facilitatorGroup.findUnique({
      where: { id },
      select: groupSelect,
    });
    if (!group) throw new NotFoundException('Farmer group not found');
    if (!isAdmin(actor) && group.facilitator.id !== actor.id) {
      throw new ForbiddenException('You can only manage groups assigned to you');
    }
    return group;
  }

  private async resolveFacilitator(
    requestedId: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<string> {
    if (isAdmin(actor)) {
      if (!requestedId) {
        throw new BadRequestException(
          'facilitatorId is required when an administrator creates a group',
        );
      }
      return this.assertActiveFacilitator(requestedId);
    }
    if (requestedId && requestedId !== actor.id) {
      throw new ForbiddenException('You cannot assign a group to another facilitator');
    }
    return actor.id;
  }

  private async assertActiveFacilitator(userId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        status: UserStatus.ACTIVE,
        roles: { some: { role: { code: RoleCode.Facilitator } } },
      },
      select: { id: true },
    });
    if (!user)
      throw new BadRequestException('Assigned facilitator must be an active facilitator account');
    return user.id;
  }
}

function toGroup(group: GroupRecord): FacilitatorGroupResponseDto {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    facilitator: group.facilitator,
    crop: group.crop,
    location: {
      province: group.province,
      district: group.district,
      sector: group.sector,
      cell: group.cell,
      village: group.village,
    },
    status: group.status,
    memberCount: group._count.members,
    createdBy: group.createdBy,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

function toMember(member: MemberRecord): GroupMemberResponseDto {
  const codes = member.user.roles.map(({ role }) => role.code);
  return {
    userId: member.user.id,
    fullName: member.user.fullName,
    phoneNumber: member.user.phoneNumber,
    email: member.user.email,
    farmerType: codes.includes(RoleCode.BasicPhoneFarmer)
      ? FarmerType.BASIC_PHONE
      : FarmerType.SMARTPHONE,
    status: member.user.status,
    addedAt: member.addedAt,
  };
}
