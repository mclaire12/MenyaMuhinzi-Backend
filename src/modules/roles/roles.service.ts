import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { PermissionResponseDto, RoleResponseDto, SetRolePermissionsDto } from './dto/role.dto';
import { IMMUTABLE_ROLE_CODES, type Permission, type RoleCode } from './rbac.constants';

const roleSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  isSystem: true,
  permissions: { select: { permission: { select: { code: true } } } },
} as const;

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<RoleResponseDto[]> {
    const roles = await this.prisma.role.findMany({ select: roleSelect, orderBy: { code: 'asc' } });
    return roles.map(toRoleResponse);
  }

  async listPermissions(): Promise<PermissionResponseDto[]> {
    const permissions = await this.prisma.permission.findMany({
      select: { code: true, description: true },
      orderBy: { code: 'asc' },
    });
    return permissions.map((p) => ({
      code: p.code as Permission,
      description: p.description ?? '',
    }));
  }

  async setPermissions(code: string, dto: SetRolePermissionsDto): Promise<RoleResponseDto> {
    const role = await this.prisma.role.findUnique({ where: { code }, select: { id: true } });
    if (!role) throw new NotFoundException('Role not found');
    if ((IMMUTABLE_ROLE_CODES as readonly string[]).includes(code)) {
      throw new ConflictException(
        `The ${code} role always has every permission and cannot be changed`,
      );
    }

    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: dto.permissions } },
      select: { id: true },
    });
    if (permissions.length !== dto.permissions.length) {
      throw new BadRequestException('Unknown permission');
    }

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      this.prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      }),
    ]);

    const updated = await this.prisma.role.findUniqueOrThrow({
      where: { id: role.id },
      select: roleSelect,
    });
    return toRoleResponse(updated);
  }
}

function toRoleResponse(role: {
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: { permission: { code: string } }[];
}): RoleResponseDto {
  return {
    code: role.code as RoleCode,
    name: role.name,
    description: role.description ?? '',
    isSystem: role.isSystem,
    permissions: role.permissions.map(({ permission }) => permission.code as Permission).sort(),
  };
}
