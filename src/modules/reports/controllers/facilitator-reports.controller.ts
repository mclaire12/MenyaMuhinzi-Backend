import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
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
import { FacilitatorReportsService } from '../services/facilitator-reports.service';

@ApiTags('Reports (facilitator)')
@Controller('facilitator/reports')
export class FacilitatorReportsController {
  constructor(private readonly reports: FacilitatorReportsService) {}

  @Get('dashboard')
  @Authorize({ permissions: [Permission.FacilitatorReportsRead] })
  @ApiOperation({
    summary: 'Facilitator dashboard',
    description: 'Aggregates limited to the caller’s farmer groups. **Facilitator.**',
  })
  @ApiOkResponse({ description: 'Scoped dashboard' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  dashboard(@CurrentUser() actor: AuthenticatedUser, @Query() query: ReportFilterQueryDto) {
    return this.reports.dashboard(actor, query);
  }

  @Get('groups')
  @Authorize({ permissions: [Permission.FacilitatorReportsRead] })
  @ApiOperation({
    summary: 'Own groups and members',
    description:
      'Optional groupId must belong to the caller. Phone numbers and emails are omitted. **Facilitator.**',
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  groups(@CurrentUser() actor: AuthenticatedUser, @Query() query: ReportFilterQueryDto) {
    return this.reports.groups(actor, query);
  }

  @Get('learning')
  @Authorize({ permissions: [Permission.FacilitatorReportsRead] })
  @ApiOperation({
    summary: 'Learning analytics for own groups',
    description: '**Facilitator.**',
  })
  learning(@CurrentUser() actor: AuthenticatedUser, @Query() query: ReportFilterQueryDto) {
    return this.reports.learning(actor, query);
  }

  @Get('assessments')
  @Authorize({ permissions: [Permission.FacilitatorReportsRead] })
  @ApiOperation({
    summary: 'Assessment analytics for own groups',
    description: '**Facilitator.**',
  })
  assessments(@CurrentUser() actor: AuthenticatedUser, @Query() query: ReportFilterQueryDto) {
    return this.reports.assessments(actor, query);
  }
}
