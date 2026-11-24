import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '../../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { Authorize, CurrentUser } from '../../auth/decorators/auth.decorators';
import { Permission, RoleCode } from '../../roles/rbac.constants';
import { TELEPHONY_CHANNEL } from '../../telephony/telephony.constants';
import { TelephonySettingsService } from '../../telephony/telephony-settings.service';
import {
  ListUssdSessionsQueryDto,
  PatchUssdConfigurationDto,
  UssdAnalyticsResponseDto,
} from '../dto/ussd.dto';
import { UssdAnalyticsService } from '../ussd-analytics.service';
import { UssdSessionService } from '../ussd-session.service';

const admin = (permission: Permission) => ({ roles: [RoleCode.Admin], permissions: [permission] });

@ApiTags('USSD admin')
@Controller('admin/ussd')
export class AdminUssdController {
  constructor(
    private readonly sessions: UssdSessionService,
    private readonly settings: TelephonySettingsService,
    private readonly analytics: UssdAnalyticsService,
  ) {}

  @Get('configuration')
  @Authorize(admin(Permission.UssdConfigurationRead))
  @ApiOperation({ summary: 'View USSD configuration', description: '**Admin only.**' })
  configuration() {
    return this.settings.get(TELEPHONY_CHANNEL.Ussd);
  }

  @Patch('configuration')
  @Authorize(admin(Permission.UssdConfigurationManage))
  @ApiOperation({ summary: 'Update USSD configuration', description: '**Admin only.**' })
  updateConfiguration(@Body() dto: PatchUssdConfigurationDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.settings.update(TELEPHONY_CHANNEL.Ussd, dto, actor.id);
  }

  @Get('sessions')
  @Authorize(admin(Permission.UssdSessionsRead))
  @ApiOperation({ summary: 'List USSD sessions', description: '**Admin only.**' })
  listSessions(@Query() query: ListUssdSessionsQueryDto): Promise<Paginated<unknown>> {
    return this.sessions.list(query);
  }

  @Get('sessions/:id')
  @Authorize(admin(Permission.UssdSessionsRead))
  @ApiOperation({ summary: 'View a USSD session', description: '**Admin only.**' })
  getSession(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.get(id);
  }

  @Post('sessions/:id/terminate')
  @Authorize(admin(Permission.UssdSessionsManage))
  @ApiOkResponse({ description: 'Terminated session' })
  @ApiOperation({ summary: 'Terminate an active USSD session', description: '**Admin only.**' })
  terminate(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.terminate(id);
  }

  @Get('analytics')
  @Authorize(admin(Permission.UssdAnalyticsRead))
  @ApiOkResponse({ type: UssdAnalyticsResponseDto })
  @ApiOperation({ summary: 'USSD analytics summary', description: '**Admin only.**' })
  analyticsSummary(): Promise<UssdAnalyticsResponseDto> {
    return this.analytics.summary();
  }
}