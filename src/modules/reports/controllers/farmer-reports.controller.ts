import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { Authorize, CurrentUser } from '../../auth/decorators/auth.decorators';
import { Permission } from '../../roles/rbac.constants';
import { ReportFilterQueryDto } from '../dto/report-query.dto';
import { FarmerReportsService } from '../services/farmer-reports.service';

@ApiTags('Reports (farmer)')
@Controller('farmer/reports')
export class FarmerReportsController {
  constructor(private readonly reports: FarmerReportsService) {}

  @Get('dashboard')
  @Authorize({ permissions: [Permission.FarmerReportsRead] })
  @ApiOperation({
    summary: 'Personal learning dashboard',
    description:
      'Only the caller’s own enrollments, progress, attempts and unread notifications. **Farmer.**',
  })
  @ApiOkResponse({ description: 'Personal dashboard' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  dashboard(@CurrentUser() actor: AuthenticatedUser, @Query() query: ReportFilterQueryDto) {
    return this.reports.dashboard(actor, query);
  }

  @Get('progress')
  @Authorize({ permissions: [Permission.FarmerReportsRead] })
  @ApiOperation({
    summary: 'Personal progress detail',
    description:
      'Course enrollments, lesson progress, channels and recent attempts for the caller only. **Farmer.**',
  })
  progress(@CurrentUser() actor: AuthenticatedUser, @Query() query: ReportFilterQueryDto) {
    return this.reports.progress(actor, query);
  }
}
