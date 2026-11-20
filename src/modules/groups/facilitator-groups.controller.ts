import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import {
  AddGroupMembersDto,
  AssignGroupCourseDto,
  CreateFacilitatorGroupDto,
  FacilitatorGroupListResponseDto,
  FacilitatorGroupResponseDto,
  GroupCourseResponseDto,
  GroupMemberListResponseDto,
  GroupMemberResponseDto,
  ListFacilitatorGroupsQueryDto,
  ListGroupMembersQueryDto,
  UpdateFacilitatorGroupDto,
} from './dto/facilitator-group.dto';
import { FacilitatorGroupsService } from './facilitator-groups.service';
import { GroupCoursesService } from './group-courses.service';

const groupRoles = [RoleCode.Admin, RoleCode.Facilitator];

@ApiTags('Facilitator Groups')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'The group is assigned to another facilitator',
})
@Controller('facilitator/groups')
export class FacilitatorGroupsController {
  constructor(
    private readonly groups: FacilitatorGroupsService,
    private readonly courses: GroupCoursesService,
  ) {}

  @Post()
  @Authorize({ roles: groupRoles, permissions: [Permission.FarmerGroupsManage] })
  @ApiOperation({
    summary: 'Create a farmer group',
    description:
      'Facilitators are assigned to the group they create. Administrators must set facilitatorId. **Admin or facilitator.**',
  })
  @ApiCreatedResponse({ type: FacilitatorGroupResponseDto })
  create(
    @Body() dto: CreateFacilitatorGroupDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FacilitatorGroupResponseDto> {
    return this.groups.create(dto, actor);
  }

  @Get()
  @Authorize({ roles: groupRoles, permissions: [Permission.FarmerGroupsRead] })
  @ApiOperation({
    summary: 'List farmer groups',
    description:
      'Facilitators see only groups assigned to them. Administrators see every group. **Admin or facilitator.**',
  })
  @ApiOkResponse({ type: FacilitatorGroupListResponseDto })
  list(
    @Query() query: ListFacilitatorGroupsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Paginated<FacilitatorGroupResponseDto>> {
    return this.groups.list(query, actor);
  }

  @Get(':id')
  @Authorize({ roles: groupRoles, permissions: [Permission.FarmerGroupsRead] })
  @ApiOperation({
    summary: 'Get a farmer group',
    description: '**Admin, or the assigned facilitator.**',
  })
  @ApiOkResponse({ type: FacilitatorGroupResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Farmer group not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FacilitatorGroupResponseDto> {
    return this.groups.findOne(id, actor);
  }

  @Patch(':id')
  @Authorize({ roles: groupRoles, permissions: [Permission.FarmerGroupsManage] })
  @ApiOperation({
    summary: 'Update a farmer group',
    description:
      'Only an administrator can change facilitatorId. **Admin, or the assigned facilitator.**',
  })
  @ApiOkResponse({ type: FacilitatorGroupResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFacilitatorGroupDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FacilitatorGroupResponseDto> {
    return this.groups.update(id, dto, actor);
  }

  @Delete(':id')
  @Authorize({ roles: groupRoles, permissions: [Permission.FarmerGroupsManage] })
  @ApiOperation({
    summary: 'Deactivate a farmer group',
    description:
      'Members and course assignments are kept. The group accepts no new members. **Admin, or the assigned facilitator.**',
  })
  @ApiOkResponse({ type: FacilitatorGroupResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FacilitatorGroupResponseDto> {
    return this.groups.deactivate(id, actor);
  }

  @Post(':id/members')
  @Authorize({ roles: groupRoles, permissions: [Permission.FarmerGroupsManage] })
  @ApiOperation({
    summary: 'Add registered farmers to a group',
    description:
      'Accepts smartphone and basic-phone farmers. Rejects unknown users, non-farmers, and facilitators or administrators. **Admin, or the assigned facilitator.**',
  })
  @ApiCreatedResponse({ type: GroupMemberResponseDto, isArray: true })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'A farmer is already a member, or the group is inactive',
  })
  addMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddGroupMembersDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<GroupMemberResponseDto[]> {
    return this.groups.addMembers(id, dto, actor);
  }

  @Get(':id/members')
  @Authorize({ roles: groupRoles, permissions: [Permission.FarmerGroupsRead] })
  @ApiOperation({
    summary: 'List group members',
    description: 'Search by name, phone or email. **Admin, or the assigned facilitator.**',
  })
  @ApiOkResponse({ type: GroupMemberListResponseDto })
  listMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListGroupMembersQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Paginated<GroupMemberResponseDto>> {
    return this.groups.listMembers(id, query, actor);
  }

  @Delete(':id/members/:userId')
  @Authorize({ roles: groupRoles, permissions: [Permission.FarmerGroupsManage] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a farmer from a group',
    description: 'Does not delete the farmer account. **Admin, or the assigned facilitator.**',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Farmer is not a member' })
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    return this.groups.removeMember(id, userId, actor);
  }

  @Post(':id/courses')
  @Authorize({ roles: groupRoles, permissions: [Permission.GroupCoursesAssign] })
  @ApiOperation({
    summary: 'Assign a published course to this group',
    description:
      "Platform-wide courses can be assigned to any group. Targeted courses can be assigned only when the group's crop and location fall inside a selected targeting group. Facilitators cannot publish courses. **Admin, or the assigned facilitator.**",
  })
  @ApiCreatedResponse({ type: GroupCourseResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Course is not eligible, or is already assigned',
  })
  assignCourse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignGroupCourseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<GroupCourseResponseDto> {
    return this.courses.assign(id, dto.courseId, actor);
  }

  @Get(':id/courses')
  @Authorize({ roles: groupRoles, permissions: [Permission.FarmerGroupsRead] })
  @ApiOperation({
    summary: 'List courses assigned to this group',
    description: '**Admin, or the assigned facilitator.**',
  })
  @ApiOkResponse({ type: GroupCourseResponseDto, isArray: true })
  listCourses(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<GroupCourseResponseDto[]> {
    return this.courses.list(id, actor);
  }
}
