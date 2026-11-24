import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../common/dto/pagination.dto';
import {
  FarmerType,
  Prisma,
  TokenRevocationReason,
  UserStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { revokeActiveWebSessions } from '../auth/services/web-session.revocation';
import { NotificationEvent } from '../notifications/events/notification-events';
import { NotificationPublisher } from '../notifications/publishing/notification-publisher.service';
import { Permission, RoleCode } from '../roles/rbac.constants';
import type { UserDetailResponseDto, UserResponseDto } from './dto/user-response.dto';
import type {
  AssignRolesDto,
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
  UpdateUserStatusDto,
} from './dto/user-request.dto';
import {
  toUserDetailResponse,
  toUserResponse,
  userDetailSelect,
  userSummarySelect,
} from './user.mapper';
import { UserProvisioningService } from './user-provisioning.service';
import { assertCompatibleRoles, assertStatusTransition } from './user-status.policy';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: UserProvisioningService,
    private readonly notifications: NotificationPublisher,
  ) {}

  async list(query: ListUsersQueryDto): Promise<Paginated<UserResponseDto>> {
    const where = this.buildWhere(query);
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: userSummarySelect,
        orderBy: { createdAt: query.sort },
        ...paginationArgs(query),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(users.map(toUserResponse), total, query);
  }

  async findOne(id: string): Promise<UserDetailResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: userDetailSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return toUserDetailResponse(user);
  }

  async create(dto: CreateUserDto, actor: AuthenticatedUser): Promise<UserDetailResponseDto> {
    if (!actor.permissions.includes(Permission.UsersAssignRoles)) {
      throw new ForbiddenException('You do not have permission to assign roles');
    }
    assertCompatibleRoles(dto.roles);
    const { userId } = await this.provisioning.provision({
      ...dto,
      status: UserStatus.ACTIVE,
      createdById: actor.id,
    });
    return this.findOne(userId);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserDetailResponseDto> {
    await this.assertExists(id);
    try {
      await this.prisma.user.update({
        where: { id },
        data: {
          fullName: dto.fullName,
          phoneNumber: dto.phoneNumber,
          email: dto.email === undefined ? undefined : dto.email,
          preferredLanguage: dto.preferredLanguage,
        },
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
    return this.findOne(id);
  }

  async changeStatus(
    id: string,
    dto: UpdateUserStatusDto,
    actor: AuthenticatedUser,
  ): Promise<UserDetailResponseDto> {
    if (id === actor.id) {
      throw new ForbiddenException('You cannot change the status of your own account');
    }
    const user = await this.assertExists(id);
    assertStatusTransition(user.status, dto.status);

    const deactivating = dto.status !== UserStatus.ACTIVE;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          status: dto.status,
          statusReason: dto.reason ?? null,
          statusChangedAt: new Date(),
          statusChangedById: actor.id,
          ...(deactivating ? {} : { failedLoginAttempts: 0, lockedUntil: null }),
        },
      }),
      ...(deactivating
        ? [
            this.prisma.refreshToken.updateMany({
              where: { userId: id, revokedAt: null },
              data: {
                revokedAt: new Date(),
                revokedReason: TokenRevocationReason.ACCOUNT_DISABLED,
              },
            }),
            revokeActiveWebSessions(this.prisma, { userId: id }, TokenRevocationReason.ACCOUNT_DISABLED),
          ]
        : []),
    ]);
    const event =
      dto.status === UserStatus.SUSPENDED
        ? NotificationEvent.AccountSuspended
        : dto.status === UserStatus.INACTIVE
          ? NotificationEvent.AccountDeactivated
          : NotificationEvent.AccountReactivated;
    await this.notifications.notifyEvent(event, id, {}, { entity: { type: 'user', id } });
    return this.findOne(id);
  }

  async assignRoles(
    id: string,
    dto: AssignRolesDto,
    actor: AuthenticatedUser,
  ): Promise<UserDetailResponseDto> {
    if (id === actor.id) {
      throw new ForbiddenException('You cannot change your own roles');
    }
    assertCompatibleRoles(dto.roles);
    await this.assertExists(id);

    const roles = await this.prisma.role.findMany({ where: { code: { in: dto.roles } } });
    if (roles.length !== dto.roles.length) throw new BadRequestException('Unknown role');

    const farmerType = dto.roles.includes(RoleCode.SmartphoneFarmer)
      ? FarmerType.SMARTPHONE
      : dto.roles.includes(RoleCode.BasicPhoneFarmer)
        ? FarmerType.BASIC_PHONE
        : undefined;

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.createMany({
        data: roles.map((role) => ({ userId: id, roleId: role.id, assignedById: actor.id })),
      }),
      // Keep the farmer profile type consistent with the farmer role.
      ...(farmerType
        ? [this.prisma.farmerProfile.updateMany({ where: { userId: id }, data: { farmerType } })]
        : []),
    ]);
    return this.findOne(id);
  }

  private async assertExists(id: string): Promise<{ id: string; status: UserStatus }> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private buildWhere(query: ListUsersQueryDto): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.role) where.roles = { some: { role: { code: query.role } } };
    if (query.search) where.OR = searchConditions(query.search);
    return where;
  }

  private mapUniqueViolation(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Another account already uses this phone number or email');
    }
    return error;
  }
}

/** Name, email or phone number (digits are matched regardless of formatting). */
export function searchConditions(search: string): Prisma.UserWhereInput[] {
  const conditions: Prisma.UserWhereInput[] = [
    { fullName: { contains: search, mode: 'insensitive' } },
    { email: { contains: search, mode: 'insensitive' } },
  ];
  const digits = search.replace(/\D/g, '');
  if (digits.length >= 3) {
    conditions.push({ phoneNumber: { contains: digits.replace(/^0/, '') } });
  }
  return conditions;
}
