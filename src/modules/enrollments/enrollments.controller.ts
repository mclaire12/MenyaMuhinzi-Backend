import {
  Body,
  Controller,
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
  EnrollmentListResponseDto,
  EnrollmentResponseDto,
  ListEnrollmentsQueryDto,
  UpdateEnrollmentStatusDto,
} from './dto/enrollment.dto';
import { EnrollmentsService } from './enrollments.service';

const readers = [
  RoleCode.Admin,
  RoleCode.Facilitator,
  RoleCode.SmartphoneFarmer,
  RoleCode.BasicPhoneFarmer,
];

@ApiTags('Enrollments')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller()
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Post('courses/:courseId/enrollments')
  @Authorize({
    roles: [RoleCode.SmartphoneFarmer, RoleCode.BasicPhoneFarmer],
    permissions: [Permission.EnrollmentsRead],
  })
  @ApiOperation({
    summary: 'Enroll in a course',
    description:
      'The course must be published and visible to this farmer. A withdrawn enrollment can be started again. A second active enrollment is rejected. **Farmer.**',
  })
  @ApiCreatedResponse({ type: EnrollmentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Course not found' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Already enrolled, completed, or suspended',
  })
  enroll(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<EnrollmentResponseDto> {
    return this.enrollments.enroll(courseId, actor);
  }

  @Get('enrollments')
  @Authorize({ roles: readers, permissions: [Permission.EnrollmentsRead] })
  @ApiOperation({
    summary: 'List enrollments',
    description:
      'Farmers see their own enrollments. Facilitators see enrollments of members of their groups. Administrators see every enrollment.',
  })
  @ApiOkResponse({ type: EnrollmentListResponseDto })
  list(
    @Query() query: ListEnrollmentsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Paginated<EnrollmentResponseDto>> {
    return this.enrollments.list(query, actor);
  }

  @Get('enrollments/:id')
  @Authorize({ roles: readers, permissions: [Permission.EnrollmentsRead] })
  @ApiOperation({
    summary: 'Get an enrollment',
    description: 'Includes the status history. Other farmers receive not found.',
  })
  @ApiOkResponse({ type: EnrollmentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Enrollment not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<EnrollmentResponseDto> {
    return this.enrollments.findOne(id, actor);
  }

  @Post('enrollments/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @Authorize({ roles: readers, permissions: [Permission.EnrollmentsRead] })
  @ApiOperation({
    summary: 'Withdraw from a course',
    description:
      'Only an active enrollment can be withdrawn. The row and its history are kept. **The enrolled farmer or an administrator.**',
  })
  @ApiOkResponse({ type: EnrollmentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Enrollment not found' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Enrollment is not active' })
  withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<EnrollmentResponseDto> {
    return this.enrollments.withdraw(id, actor);
  }

  @Patch('enrollments/:id/status')
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.EnrollmentsManage] })
  @ApiOperation({
    summary: 'Change an enrollment status',
    description: 'Records the change in the enrollment history. **Admin only.**',
  })
  @ApiOkResponse({ type: EnrollmentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Enrollment not found' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Status is unchanged' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Administrator only' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEnrollmentStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<EnrollmentResponseDto> {
    return this.enrollments.updateStatus(id, dto, actor);
  }
}
