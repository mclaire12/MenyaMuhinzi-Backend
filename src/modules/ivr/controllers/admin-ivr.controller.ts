import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '../../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { Authorize, CurrentUser } from '../../auth/decorators/auth.decorators';
import { Permission, RoleCode } from '../../roles/rbac.constants';
import { TELEPHONY_CHANNEL } from '../../telephony/telephony.constants';
import { TelephonySettingsService } from '../../telephony/telephony-settings.service';
import { IvrAnalyticsResponseDto, ListIvrSessionsQueryDto, PatchIvrConfigurationDto } from '../dto/ivr.dto';
import { IvrAnalyticsService } from '../ivr-analytics.service';
import { IvrSessionService } from '../ivr-session.service';

const admin = (permission: Permission) => ({ roles: [RoleCode.Admin], permissions: [permission] });

@ApiTags('IVR admin')
@Controller('admin/ivr')
export class AdminIvrController {
  constructor(
    private readonly sessions: IvrSessionService,
    private readonly settings: TelephonySettingsService,
    private readonly analytics: IvrAnalyticsService,
  ) {}

  @Get('configuration')
  @Authorize(admin(Permission.IvrConfigurationRead))
  @ApiOperation({ summary: 'View IVR configuration', description: '**Admin only.**' })
  configuration() {
    return this.settings.get(TELEPHONY_CHANNEL.Ivr);
  }

  @Patch('configuration')
  @Authorize(admin(Permission.IvrConfigurationManage))
  @ApiOperation({ summary: 'Update IVR configuration', description: '**Admin only.**' })
  updateConfiguration(@Body() dto: PatchIvrConfigurationDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.settings.update(TELEPHONY_CHANNEL.Ivr, dto, actor.id);
  }

  @Get('sessions')
  @Authorize(admin(Permission.IvrSessionsRead))
  @ApiOperation({ summary: 'List IVR sessions', description: '**Admin only.**' })
  listSessions(@Query() query: ListIvrSessionsQueryDto): Promise<Paginated<unknown>> {
    return this.sessions.list(query);
  }

  @Get('sessions/:id')
  @Authorize(admin(Permission.IvrSessionsRead))
  @ApiOperation({ summary: 'View an IVR session', description: '**Admin only.**' })
  getSession(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.get(id);
  }

  @Post('sessions/:id/terminate')
  @Authorize(admin(Permission.IvrSessionsManage))
  @ApiOperation({ summary: 'Terminate an active IVR session', description: '**Admin only.**' })
  terminate(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.terminate(id);
  }

  @Get('analytics')
  @Authorize(admin(Permission.IvrAnalyticsRead))
  @ApiOkResponse({ type: IvrAnalyticsResponseDto })
  @ApiOperation({ summary: 'IVR analytics summary', description: '**Admin only.**' })
  analyticsSummary(): Promise<IvrAnalyticsResponseDto> {
    return this.analytics.summary();
  }
}