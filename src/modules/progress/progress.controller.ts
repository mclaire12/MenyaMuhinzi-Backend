import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
  CourseProgressResponseDto,
  LearningSessionResponseDto,
  LessonContentResponseDto,
  LessonProgressResponseDto,
  StartLearningSessionDto,
  UpdateLessonProgressDto,
} from './dto/progress.dto';
import { ProgressService } from './progress.service';

const learners = [RoleCode.SmartphoneFarmer, RoleCode.BasicPhoneFarmer];
const readers = [RoleCode.Admin, RoleCode.Facilitator, ...learners];

@ApiTags('Learning progress')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller()
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Get('enrollments/:id/progress')
  @Authorize({ roles: readers, permissions: [Permission.ProgressRead] })
  @ApiOperation({
    summary: 'View course progress',
    description:
      'Calculated from lesson records. Farmers see their own enrollment. Facilitators see members of their groups. Administrators see any enrollment.',
  })
  @ApiOkResponse({ type: CourseProgressResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Enrollment not found' })
  courseProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CourseProgressResponseDto> {
    return this.progress.courseProgress(id, actor);
  }

  @Put('lessons/:id/progress')
  @Authorize({ roles: learners, permissions: [Permission.ProgressUpdate] })
  @ApiOperation({
    summary: 'Record lesson progress',
    description:
      'Requires an active enrollment. The status is derived from the percentage. A lower percentage is rejected. Time spent is recorded by learning sessions, not by this request. **Farmer.**',
  })
  @ApiOkResponse({ type: LessonProgressResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Lesson or enrollment not found' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Enrollment is not active' })
  updateLesson(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLessonProgressDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<LessonProgressResponseDto> {
    return this.progress.updateLesson(id, dto, actor);
  }

  @Get('lessons/:id/content')
  @Authorize({ roles: readers, permissions: [Permission.CoursesRead] })
  @ApiOperation({
    summary: 'Get lesson content and resources',
    description:
      'Returns the written body and content references. Farmers need an active or completed enrollment. Withdrawn and suspended enrollments are refused. Media bytes are not stored in the database.',
  })
  @ApiOkResponse({ type: LessonContentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Lesson not found' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Enrollment cannot open this lesson' })
  content(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser): Promise<LessonContentResponseDto> {
    return this.progress.lessonContent(id, actor);
  }

  @Post('learning-sessions')
  @Authorize({ roles: learners, permissions: [Permission.ProgressUpdate] })
  @ApiOperation({
    summary: 'Start a learning session',
    description:
      'One open session per farmer and lesson. The channel can be WEB, USSD, IVR, or MOBILE. Progress stays on the same account. USSD and IVR providers are not called. **Farmer.**',
  })
  @ApiCreatedResponse({ type: LearningSessionResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'A session is already open' })
  start(@Body() dto: StartLearningSessionDto, @CurrentUser() actor: AuthenticatedUser): Promise<LearningSessionResponseDto> {
    return this.progress.startSession(dto, actor);
  }

  @Post('learning-sessions/:id/complete')
  @HttpCode(HttpStatus.OK)
  @Authorize({ roles: learners, permissions: [Permission.ProgressUpdate] })
  @ApiOperation({
    summary: 'Complete a learning session',
    description: 'Duration is calculated on the server and added to the lesson time. **The farmer who started it.**',
  })
  @ApiOkResponse({ type: LearningSessionResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Learning session not found' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Session is already closed' })
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser): Promise<LearningSessionResponseDto> {
    return this.progress.completeSession(id, actor);
  }

  @Post('learning-sessions/:id/abandon')
  @HttpCode(HttpStatus.OK)
  @Authorize({ roles: learners, permissions: [Permission.ProgressUpdate] })
  @ApiOperation({ summary: 'Abandon a learning session', description: 'The time until now is still recorded. **The farmer who started it.**' })
  @ApiOkResponse({ type: LearningSessionResponseDto })
  abandon(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser): Promise<LearningSessionResponseDto> {
    return this.progress.abandonSession(id, actor);
  }
}
