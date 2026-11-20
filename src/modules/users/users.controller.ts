import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Authorize, CurrentUser } from '../auth/decorators/auth.decorators';
import { Permission, RoleCode } from '../roles/rbac.constants';
import {
  AssignRolesDto,
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
  UpdateUserStatusDto,
} from './dto/user-request.dto';
import { UserDetailResponseDto, UserListResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.UsersRead] })
  @ApiOperation({
    summary: 'List users',
    description: 'Search, filter and paginate user accounts. **Role:** ADMIN.',
  })
  @ApiOkResponse({ type: UserListResponseDto })
  list(@Query() query: ListUsersQueryDto): Promise<UserListResponseDto> {
    return this.users.list(query);
  }

  @Get(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.UsersRead] })
  @ApiOperation({ summary: 'Get a user', description: 'Includes profile and location. **Role:** ADMIN.' })
  @ApiOkResponse({ type: UserDetailResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserDetailResponseDto> {
    return this.users.findOne(id);
  }

  @Post()
  @Authorize({
    roles: [RoleCode.Admin],
    permissions: [Permission.UsersCreate, Permission.UsersAssignRoles],
  })
  @ApiOperation({
    summary: 'Register a user',
    description:
      'Creates an ACTIVE account with the given roles, without a profile. Use POST /farmers or ' +
      'POST /facilitators to create users with profiles. **Role:** ADMIN.',
  })
  @ApiCreatedResponse({ type: UserDetailResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Phone number or email already in use' })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthenticatedUser): Promise<UserDetailResponseDto> {
    return this.users.create(dto, actor);
  }

  @Patch(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.UsersUpdate] })
  @ApiOperation({ summary: 'Update user details', description: '**Role:** ADMIN.' })
  @ApiOkResponse({ type: UserDetailResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Phone number or email already in use' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto): Promise<UserDetailResponseDto> {
    return this.users.update(id, dto);
  }

  @Patch(':id/status')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.UsersManageStatus] })
  @ApiOperation({
    summary: 'Activate, deactivate, suspend or reactivate an account',
    description:
      'Allowed transitions: ACTIVE -> INACTIVE | SUSPENDED, INACTIVE -> ACTIVE | SUSPENDED, ' +
      'SUSPENDED -> ACTIVE | INACTIVE. Deactivating or suspending revokes all sessions. ' +
      'Administrators cannot change their own status. **Role:** ADMIN.',
  })
  @ApiOkResponse({ type: UserDetailResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Transition not allowed' })
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserDetailResponseDto> {
    return this.users.changeStatus(id, dto, actor);
  }

  @Patch(':id/roles')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.UsersAssignRoles] })
  @ApiOperation({
    summary: 'Assign or change user roles',
    description:
      'Replaces the user\'s roles. Administrators cannot change their own roles. **Role:** ADMIN.',
  })
  @ApiOkResponse({ type: UserDetailResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  assignRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRolesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserDetailResponseDto> {
    return this.users.assignRoles(id, dto, actor);
  }
}
