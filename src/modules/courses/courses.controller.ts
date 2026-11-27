import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { CourseContentService } from './course-content.service';
import { CoursePublicationService } from './course-publication.service';
import { CoursesService } from './courses.service';
import { CreateLessonDto, CreateModuleDto, LessonResponseDto, ModuleResponseDto, UpdateLessonDto, UpdateModuleDto } from './dto/course-content.dto';
import { CreateLessonResourceDto, LessonResourceResponseDto, UpdateLessonResourceDto } from './dto/lesson-resource.dto';

const courseReaders = [RoleCode.Admin, RoleCode.Facilitator, RoleCode.SmartphoneFarmer, RoleCode.BasicPhoneFarmer];
import { CourseListResponseDto, CourseResponseDto, ListCoursesQueryDto, PublishToGroupsDto, UpdateCourseDto } from './dto/course.dto';
import { CoursePublicationResponseDto, PublishCourseDto } from './dto/publication.dto';

@ApiTags('Courses')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  // Courses are not created by hand: POST /course-generations saves the outline and creates
  // the draft course that the AI model writes.

  @Get()
  @Authorize({ roles: courseReaders, permissions: [Permission.CoursesRead] })
  @ApiOperation({
    summary: 'List courses',
    description:
      'Administrators see every status. Facilitators see published courses that are platform-wide or targeted at one of their groups. Farmers see published courses that match their farmer type and are platform-wide, targeted at their location and group crop, or assigned to a group they belong to.',
  })
  @ApiOkResponse({ type: CourseListResponseDto })
  list(@Query() query: ListCoursesQueryDto, @CurrentUser() actor: AuthenticatedUser): Promise<Paginated<CourseResponseDto>> {
    return this.courses.list(query, actor);
  }

  @Put(':id/groups')
  @Authorize({ roles: [RoleCode.Facilitator], permissions: [Permission.GroupCoursesAssign] })
  @ApiOperation({
    summary: 'Publish a facilitator course to one or more of their groups',
    description:
      'Only for courses the facilitator generated. The list replaces the groups the course is published to; only members of those groups see it. **Facilitator (owner).**',
  })
  @ApiOkResponse({ type: CourseResponseDto })
  publishToGroups(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishToGroupsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CourseResponseDto> {
    return this.courses.publishToGroups(id, dto.groupIds, actor);
  }

  @Delete(':id/groups')
  @Authorize({ roles: [RoleCode.Facilitator], permissions: [Permission.GroupCoursesAssign] })
  @ApiOperation({
    summary: 'Stop publishing a facilitator course to its groups',
    description: 'The course returns to draft. Learner progress is kept. **Facilitator (owner).**',
  })
  @ApiOkResponse({ type: CourseResponseDto })
  unpublishFromGroups(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser): Promise<CourseResponseDto> {
    return this.courses.unpublishFromGroups(id, actor);
  }

  @Get(':id')
  @Authorize({ roles: courseReaders, permissions: [Permission.CoursesRead] })
  @ApiOperation({ summary: 'Get a course', description: 'Unpublished courses are visible to administrators only. Farmers must also match the course audience.' })
  @ApiOkResponse({ type: CourseResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Course not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser): Promise<CourseResponseDto> {
    return this.courses.findOne(id, actor);
  }

  @Patch(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CoursesManage] })
  @ApiOperation({
    summary: 'Update a course',
    description: 'Set status to ARCHIVED to archive it. Publishing uses POST /courses/:id/publish. **Admin only.**',
  })
  @ApiOkResponse({ type: CourseResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Course not found' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Status change is not allowed' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCourseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CourseResponseDto> {
    return this.courses.update(id, dto, actor);
  }

  @Delete(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CoursesManage] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a course that was never published',
    description: 'Published courses must be unpublished first. Courses with publication history must be archived. **Admin only.**',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Course not found' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Course cannot be deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.courses.remove(id);
  }
}

@ApiTags('Courses')
@Controller('courses')
export class CoursePublicationController {
  constructor(private readonly publications: CoursePublicationService) {}

  @Post(':id/publish')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CoursesPublish] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publish a course',
    description:
      'PLATFORM publishes to every farmer group. TARGETED publishes to the selected administrator targeting groups. Records the administrator and the time. **Admin only.**',
  })
  @ApiOkResponse({ type: CoursePublicationResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Course not found' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Course is already published or archived' })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishCourseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CoursePublicationResponseDto> {
    return this.publications.publish(id, dto, actor);
  }

  @Post(':id/unpublish')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CoursesPublish] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unpublish a course',
    description: 'Returns the course to draft and closes the publication. The publication row is kept. **Admin only.**',
  })
  @ApiOkResponse({ type: CoursePublicationResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Course is not published' })
  unpublish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CoursePublicationResponseDto> {
    return this.publications.unpublish(id, actor);
  }

  @Get(':id/publications')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CoursesRead] })
  @ApiOperation({ summary: 'Publication history of a course', description: 'Newest first. **Admin only.**' })
  @ApiOkResponse({ type: CoursePublicationResponseDto, isArray: true })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Course not found' })
  list(@Param('id', ParseUUIDPipe) id: string): Promise<CoursePublicationResponseDto[]> {
    return this.publications.list(id);
  }
}

@ApiTags('Course Modules')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('courses/:id/modules')
export class CourseModulesController {
  constructor(private readonly content: CourseContentService) {}

  @Post()
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CoursesManage] })
  @ApiOperation({ summary: 'Add a module', description: 'Display order is appended when omitted. **Admin only.**' })
  @ApiCreatedResponse({ type: ModuleResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Course not found' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Course is archived' })
  create(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateModuleDto): Promise<ModuleResponseDto> {
    return this.content.createModule(id, dto);
  }

  @Get()
  @Authorize({ roles: courseReaders, permissions: [Permission.CoursesRead] })
  @ApiOperation({ summary: 'List modules of a course', description: 'Ordered for display. Farmers only see modules of courses they are allowed to open.' })
  @ApiOkResponse({ type: ModuleResponseDto, isArray: true })
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser): Promise<ModuleResponseDto[]> {
    return this.content.listModules(id, actor);
  }
}

@ApiTags('Course Modules')
@Controller('modules')
export class ModulesController {
  constructor(private readonly content: CourseContentService) {}

  @Patch(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CoursesManage] })
  @ApiOperation({ summary: 'Update a module', description: '**Admin only.**' })
  @ApiOkResponse({ type: ModuleResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Module not found' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateModuleDto): Promise<ModuleResponseDto> {
    return this.content.updateModule(id, dto);
  }

  @Delete(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CoursesManage] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a module and its lessons', description: '**Admin only.**' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Module not found' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.content.removeModule(id);
  }
}

@ApiTags('Lessons')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('modules/:id/lessons')
export class ModuleLessonsController {
  constructor(private readonly content: CourseContentService) {}

  @Post()
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CoursesManage] })
  @ApiOperation({
    summary: 'Add a lesson',
    description: 'Stores the lesson, its written body, and a content reference. Media bytes are not stored in the database. **Admin only.**',
  })
  @ApiCreatedResponse({ type: LessonResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Module not found' })
  create(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateLessonDto): Promise<LessonResponseDto> {
    return this.content.createLesson(id, dto);
  }

  @Get()
  @Authorize({ roles: courseReaders, permissions: [Permission.CoursesRead] })
  @ApiOperation({
    summary: 'List lessons of a module',
    description: 'Catalogue metadata only. The written body and resources are returned by GET /lessons/:id/content for an enrolled farmer.',
  })
  @ApiOkResponse({ type: LessonResponseDto, isArray: true })
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser): Promise<LessonResponseDto[]> {
    return this.content.listLessons(id, actor);
  }
}

@ApiTags('Lessons')
@Controller('lessons')
export class LessonsController {
  constructor(private readonly content: CourseContentService) {}

  @Patch(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CoursesManage] })
  @ApiOperation({ summary: 'Update a lesson', description: '**Admin only.**' })
  @ApiOkResponse({ type: LessonResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Lesson not found' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLessonDto): Promise<LessonResponseDto> {
    return this.content.updateLesson(id, dto);
  }

  @Delete(':id')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CoursesManage] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a lesson', description: '**Admin only.**' })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.content.removeLesson(id);
  }

  @Post(':id/resources')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CoursesManage] })
  @ApiOperation({
    summary: 'Add a lesson resource',
    description: 'Stores a reference to text, video, audio, a document, or an image. **Admin only.**',
  })
  @ApiCreatedResponse({ type: LessonResourceResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Lesson not found' })
  addResource(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLessonResourceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<LessonResourceResponseDto> {
    return this.content.addResource(id, dto, actor);
  }

  @Get(':id/resources')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CoursesManage] })
  @ApiOperation({ summary: 'List lesson resources', description: 'Management view. Enrolled farmers use GET /lessons/:id/content. **Admin only.**' })
  @ApiOkResponse({ type: LessonResourceResponseDto, isArray: true })
  listResources(@Param('id', ParseUUIDPipe) id: string): Promise<LessonResourceResponseDto[]> {
    return this.content.listResources(id);
  }

  @Patch(':id/resources/:resourceId')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CoursesManage] })
  @ApiOperation({ summary: 'Update a lesson resource', description: '**Admin only.**' })
  @ApiOkResponse({ type: LessonResourceResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Lesson resource not found' })
  updateResource(
    @Param('resourceId', ParseUUIDPipe) resourceId: string,
    @Body() dto: UpdateLessonResourceDto,
  ): Promise<LessonResourceResponseDto> {
    return this.content.updateResource(resourceId, dto);
  }

  @Delete(':id/resources/:resourceId')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.CoursesManage] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a lesson resource', description: '**Admin only.**' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Lesson resource not found' })
  removeResource(@Param('resourceId', ParseUUIDPipe) resourceId: string): Promise<void> {
    return this.content.removeResource(resourceId);
  }
}
