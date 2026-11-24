import { Controller, ForbiddenException, Get, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { Authorize, CurrentUser } from '../../auth/decorators/auth.decorators';
import { Permission, RoleCode } from '../../roles/rbac.constants';
import { ReportFilterQueryDto } from '../dto/report-query.dto';
import { AdminReportsService } from '../services/admin-reports.service';
import { ReportExportService } from '../services/report-export.service';

const admin = (permission: Permission) => ({
  roles: [RoleCode.Admin],
  permissions: [permission],
});

@ApiTags('Reports (admin)')
@Controller('admin/reports')
export class AdminReportsController {
  constructor(
    private readonly reports: AdminReportsService,
    private readonly exports: ReportExportService,
  ) {}

  @Get('dashboard')
  @Authorize(admin(Permission.ReportsRead))
  @ApiOperation({
    summary: 'Institutional dashboard',
    description:
      'Platform-wide aggregates from transactional data. Date filters use an inclusive startDate and exclusive endDate (UTC). **Admin.**',
  })
  @ApiOkResponse({ description: 'Dashboard aggregates' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  dashboard(@Query() query: ReportFilterQueryDto) {
    return this.reports.dashboard(query);
  }

  @Get('users')
  @Authorize(admin(Permission.ReportsRead))
  @ApiOperation({
    summary: 'User account analytics',
    description: 'Counts by status and role. No personal contact details. **Admin.**',
  })
  users(@Query() query: ReportFilterQueryDto) {
    return this.reports.users(query);
  }

  @Get('registrations')
  @Authorize(admin(Permission.ReportsRead))
  @ApiOperation({
    summary: 'Farmer registration analytics',
    description:
      'Registrations by type, category, province and day. Pass format=csv with reports:export to download rows without phone or email. **Admin.**',
  })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({ description: 'Registration analytics or CSV' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async registrations(
    @Query() query: ReportFilterQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (query.format === 'csv') {
      // Export requires the export permission in addition to read (checked below via Authorize on export helper path).
      this.assertExport(actor);
      const file = await this.exports.registrations(actor, query);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      return file.body;
    }
    return this.reports.registrations(query);
  }

  @Get('learning')
  @Authorize(admin(Permission.ReportsRead))
  @ApiOperation({
    summary: 'Learning analytics',
    description:
      'Enrollments, completion rates, channels and active/inactive learners. Active learners are defined by REPORTS_ACTIVE_LEARNER_DAYS. **Admin.**',
  })
  learning(@Query() query: ReportFilterQueryDto) {
    return this.reports.learning(query);
  }

  @Get('courses')
  @Authorize(admin(Permission.ReportsRead))
  @ApiOperation({ summary: 'Course catalogue statistics', description: '**Admin.**' })
  courses(@Query() query: ReportFilterQueryDto) {
    return this.reports.courses(query);
  }

  @Get('assessments')
  @Authorize(admin(Permission.ReportsRead))
  @ApiOperation({
    summary: 'Assessment analytics',
    description: 'Attempt outcomes, averages and pass rates. **Admin.**',
  })
  assessments(@Query() query: ReportFilterQueryDto) {
    return this.reports.assessments(query);
  }

  @Get('facilitators')
  @Authorize(admin(Permission.ReportsRead))
  @ApiOperation({ summary: 'Facilitator activity summary', description: '**Admin.**' })
  facilitators(@Query() query: ReportFilterQueryDto) {
    return this.reports.facilitators(query);
  }

  @Get('groups')
  @Authorize(admin(Permission.ReportsRead))
  @ApiOperation({ summary: 'Facilitator group membership statistics', description: '**Admin.**' })
  groups(@Query() query: ReportFilterQueryDto) {
    return this.reports.groups(query);
  }

  @Get('ai')
  @Authorize(admin(Permission.ReportsRead))
  @ApiOperation({
    summary: 'AI request and usage analytics',
    description:
      'Uses AiRequest and AiUsageRecord. Token totals stay null when providers did not report them. **Admin.**',
  })
  ai(@Query() query: ReportFilterQueryDto) {
    return this.reports.ai(query);
  }

  @Get('knowledge')
  @Authorize(admin(Permission.ReportsRead))
  @ApiOperation({
    summary: 'Knowledge-base analytics',
    description:
      'Sources, processing jobs and chunks. Semantic retrieval statistics are marked unavailable without a vector store. **Admin.**',
  })
  knowledge(@Query() query: ReportFilterQueryDto) {
    return this.reports.knowledge(query);
  }

  @Get('notifications')
  @Authorize(admin(Permission.ReportsRead))
  @ApiOperation({
    summary: 'Notification analytics',
    description:
      'Creation and delivery aggregates. External DELIVERED is never claimed without provider evidence. format=csv exports category/channel/status counts. **Admin.**',
  })
  @ApiProduces('application/json', 'text/csv')
  async notifications(
    @Query() query: ReportFilterQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (query.format === 'csv') {
      this.assertExport(actor);
      const file = await this.exports.notifications(actor, query);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      return file.body;
    }
    return this.reports.notifications(query);
  }

  @Get('system')
  @Authorize(admin(Permission.ReportsRead))
  @ApiOperation({
    summary: 'Operational monitoring summary',
    description:
      'Database-backed queue snapshots, failure counts and recent audit events (no secrets or message bodies). **Admin.**',
  })
  system(@Query() query: ReportFilterQueryDto) {
    return this.reports.system(query);
  }

  /** CSV export is gated by reports:export; the route itself only requires reports:read. */
  private assertExport(actor: AuthenticatedUser): void {
    if (!actor.permissions.includes(Permission.ReportsExport)) {
      throw new ForbiddenException('CSV export requires the reports:export permission');
    }
  }
}
