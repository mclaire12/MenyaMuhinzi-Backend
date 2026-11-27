import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Authorize, CurrentUser } from '../auth/decorators/auth.decorators';
import { Permission, RoleCode } from '../roles/rbac.constants';
import { PlatformSettingsResponseDto, UpdatePlatformSettingsDto } from './platform-settings.dto';
import { PlatformSettingsService } from './platform-settings.service';

@ApiTags('Administrator Settings')
@Controller('settings')
export class PlatformSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get()
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.PlatformSettingsRead] })
  @ApiOperation({
    summary: 'Platform settings',
    description: 'Defaults are returned until an administrator saves a value. **Admin only.**',
  })
  @ApiOkResponse({ type: PlatformSettingsResponseDto })
  get(): Promise<PlatformSettingsResponseDto> {
    return this.settings.get();
  }

  @Patch()
  @Authorize({ roles: [RoleCode.Admin], permissions: [Permission.PlatformSettingsManage] })
  @ApiOperation({
    summary: 'Update platform settings',
    description: 'Only the sections sent are replaced. The change is audited. **Admin only.**',
  })
  @ApiOkResponse({ type: PlatformSettingsResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
  update(
    @Body() dto: UpdatePlatformSettingsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PlatformSettingsResponseDto> {
    return this.settings.update(dto, actor);
  }
}
