import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { Authorize } from '../auth/decorators/auth.decorators';
import { PermissionResponseDto, RoleResponseDto, SetRolePermissionsDto } from './dto/role.dto';
import { ALL_ROLE_CODES, Permission, RoleCode } from './rbac.constants';
import { RolesService } from './roles.service';

@ApiTags('Roles & Permissions')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.RolesRead] })
  @ApiOperation({ summary: 'List roles and their permissions', description: '**Admin only.**' })
  @ApiOkResponse({ type: RoleResponseDto, isArray: true })
  list(): Promise<RoleResponseDto[]> {
    return this.roles.list();
  }

  @Get('permissions')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.RolesRead] })
  @ApiOperation({ summary: 'List all permissions', description: '**Admin only.**' })
  @ApiOkResponse({ type: PermissionResponseDto, isArray: true })
  listPermissions(): Promise<PermissionResponseDto[]> {
    return this.roles.listPermissions();
  }

  @Put(':code/permissions')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.RolesManage] })
  @ApiOperation({
    summary: 'Replace the permissions granted to a role',
    description:
      'Takes effect on the next request of every user with the role. The ADMIN role is immutable. **Admin only.**',
  })
  @ApiParam({ name: 'code', enum: ALL_ROLE_CODES })
  @ApiOkResponse({ type: RoleResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Role not found' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Role is immutable' })
  setPermissions(
    @Param('code') code: string,
    @Body() dto: SetRolePermissionsDto,
  ): Promise<RoleResponseDto> {
    return this.roles.setPermissions(code, dto);
  }
}
