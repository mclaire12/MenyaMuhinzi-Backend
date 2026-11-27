import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
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
import type { Paginated } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Authorize, CurrentUser } from '../auth/decorators/auth.decorators';
import { Permission, RoleCode } from '../roles/rbac.constants';
import { CourseGenerationService } from './course-generation.service';
import {
  CourseGenerationListResponseDto,
  CourseGenerationResponseDto,
  CreateCourseGenerationDto,
  ListCourseGenerationsQueryDto,
} from './dto/course-generation.dto';

const generators = [RoleCode.Admin, RoleCode.Facilitator];

@ApiTags('AI Course Generation')
@Controller('course-generations')
export class CourseGenerationController {
  constructor(private readonly generations: CourseGenerationService) {}

  @Post()
  @Authorize({ roles: generators, permissions: [Permission.CourseGenerationsCreate] })
  @ApiOperation({
    summary: 'Request an AI-generated course',
    description:
      'Saves the course outline (chapters and sub-chapters), creates the draft course skeleton and queues it for the course-generation model. Administrators create platform courses; facilitators create courses for one of their own groups. **Admin or facilitator.**',
  })
  @ApiCreatedResponse({ type: CourseGenerationResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid outline, crop, group or knowledge sources' })
  create(@Body() dto: CreateCourseGenerationDto, @CurrentUser() actor: AuthenticatedUser): Promise<CourseGenerationResponseDto> {
    return this.generations.create(dto, actor);
  }

  @Get()
  @Authorize({ roles: generators, permissions: [Permission.CourseGenerationsRead] })
  @ApiOperation({ summary: 'List course generation requests', description: 'Facilitators see their own requests. **Admin or facilitator.**' })
  @ApiOkResponse({ type: CourseGenerationListResponseDto })
  list(@Query() query: ListCourseGenerationsQueryDto, @CurrentUser() actor: AuthenticatedUser): Promise<Paginated<CourseGenerationResponseDto>> {
    return this.generations.list(query, actor);
  }

  @Get(':id')
  @Authorize({ roles: generators, permissions: [Permission.CourseGenerationsRead] })
  @ApiOperation({ summary: 'Get a course generation request' })
  @ApiOkResponse({ type: CourseGenerationResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser): Promise<CourseGenerationResponseDto> {
    return this.generations.findOne(id, actor);
  }

  @Post(':id/cancel')
  @Authorize({ roles: generators, permissions: [Permission.CourseGenerationsCreate] })
  @ApiOperation({ summary: 'Cancel a pending course generation request', description: 'The draft course is kept.' })
  @ApiOkResponse({ type: CourseGenerationResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'The request is no longer pending' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser): Promise<CourseGenerationResponseDto> {
    return this.generations.cancel(id, actor);
  }
}
