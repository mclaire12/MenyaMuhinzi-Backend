import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsIn } from 'class-validator';
import { ALL_PERMISSIONS, ALL_ROLE_CODES, Permission, RoleCode } from '../rbac.constants';

export class PermissionResponseDto {
  @ApiProperty({ enum: ALL_PERMISSIONS, example: Permission.UsersRead })
  code: Permission;

  @ApiProperty({ example: 'List and view user accounts' })
  description: string;
}

export class RoleResponseDto {
  @ApiProperty({ enum: ALL_ROLE_CODES, example: RoleCode.Facilitator })
  code: RoleCode;

  @ApiProperty({ example: 'Agricultural Facilitator / Agronomist' })
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ description: 'System roles are seeded and cannot be deleted' })
  isSystem: boolean;

  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true })
  permissions: Permission[];
}

export class SetRolePermissionsDto {
  @ApiProperty({
    enum: ALL_PERMISSIONS,
    isArray: true,
    example: [Permission.FarmersRead, Permission.FarmersUpdate],
    description: 'Replaces the full permission set of the role',
  })
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissions: Permission[];
}
