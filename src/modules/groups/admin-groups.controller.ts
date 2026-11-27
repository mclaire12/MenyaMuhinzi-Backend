import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import type { Paginated } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Authorize, CurrentUser } from '../auth/decorators/auth.decorators';
import { Permission, RoleCode } from '../roles/rbac.constants';
import { AdminGroupsService } from './admin-groups.service';
import {
  AdminGroupCourseDto,
  AdminGroupListResponseDto,
  AdminGroupResponseDto,
  CreateAdminGroupDto,
  ListAdminGroupsQueryDto,
  UpdateAdminGroupDto,
} from './dto/admin-group.dto';

@ApiTags('Administrator Groups')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('admin/groups')
export class AdminGroupsController {
  constructor(private readonly groups: AdminGroupsService) {}

  @Post()
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.TargetingGroupsManage] })
  @ApiOperation({
    summary: 'Create a course-targeting group',
    description:
      'These groups categorise an audience. They do not contain farmer memberships. **Admin only.**',
  })
  @ApiCreatedResponse({ type: AdminGroupResponseDto })
  create(
    @Body() dto: CreateAdminGroupDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AdminGroupResponseDto> {
    return this.groups.create(dto, actor);
  }

  @Get()
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.TargetingGroupsRead] })
  @ApiOperation({ summary: 'List course-targeting groups', description: '**Admin only.**' })
  @ApiOkResponse({ type: AdminGroupListResponseDto })
  list(@Query() query: ListAdminGroupsQueryDto): Promise<Paginated<AdminGroupResponseDto>> {
    return this.groups.list(query);
  }

  @Get(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.TargetingGroupsRead] })
  @ApiOperation({ summary: 'Get a course-targeting group', description: '**Admin only.**' })
  @ApiOkResponse({ type: AdminGroupResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Targeting group not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AdminGroupResponseDto> {
    return this.groups.findOne(id);
  }

  @Get(':id/courses')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.TargetingGroupsRead] })
  @ApiOperation({
    summary: 'Courses currently published to a course-targeting group',
    description: 'Only current publications are listed. **Admin only.**',
  })
  @ApiOkResponse({ type: AdminGroupCourseDto, isArray: true })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Targeting group not found' })
  courses(@Param('id', ParseUUIDPipe) id: string): Promise<AdminGroupCourseDto[]> {
    return this.groups.courses(id);
  }

  @Patch(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.TargetingGroupsManage] })
  @ApiOperation({ summary: 'Update a course-targeting group', description: '**Admin only.**' })
  @ApiOkResponse({ type: AdminGroupResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Targeting group not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminGroupDto,
  ): Promise<AdminGroupResponseDto> {
    return this.groups.update(id, dto);
  }

  @Delete(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.TargetingGroupsManage] })
  @ApiOperation({
    summary: 'Deactivate a course-targeting group',
    description:
      'The group is kept so existing publication history still resolves. **Admin only.**',
  })
  @ApiOkResponse({ type: AdminGroupResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Targeting group not found' })
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<AdminGroupResponseDto> {
    return this.groups.deactivate(id);
  }
}
