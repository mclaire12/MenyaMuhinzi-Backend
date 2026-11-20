import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import type { Paginated } from '../../../common/dto/pagination.dto';
import { NotificationCategory, NotificationChannel } from '../../../generated/prisma/client';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { Authorize, CurrentUser } from '../../auth/decorators/auth.decorators';
import { Permission, RoleCode } from '../../roles/rbac.constants';
import {
  AdminDeliveryListResponseDto,
  AdminDeliveryResponseDto,
  AdminListDeliveriesQueryDto,
} from '../dto/notification.dto';
import {
  CategorySettingResponseDto,
  ChannelSettingResponseDto,
  UpdateCategorySettingDto,
  UpdateChannelSettingDto,
} from '../dto/settings.dto';
import {
  CreateTemplateDto,
  CreateTemplateVersionDto,
  ListTemplatesQueryDto,
  PreviewTemplateDto,
  SetCurrentVersionDto,
  TemplateHistoryResponseDto,
  TemplateListResponseDto,
  TemplatePreviewResponseDto,
  TemplateResponseDto,
  TemplateVersionResponseDto,
  UpdateTemplateDto,
} from '../dto/template.dto';
import { NotificationsService } from '../inbox/notifications.service';
import { NotificationSettingsService } from '../settings/notification-settings.service';
import { NotificationTemplatesService } from '../templates/notification-templates.service';

const admin = (permission: Permission) => ({ roles: [RoleCode.Admin], permissions: [permission] });

@ApiTags('Notification admin: templates')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('admin/notifications/templates')
export class AdminNotificationTemplatesController {
  constructor(private readonly templates: NotificationTemplatesService) {}

  @Get()
  @Authorize(admin(Permission.NotificationTemplatesRead))
  @ApiOperation({ summary: 'List notification templates', description: '**Admin only.**' })
  @ApiOkResponse({ type: TemplateListResponseDto })
  list(@Query() query: ListTemplatesQueryDto): Promise<Paginated<TemplateResponseDto>> {
    return this.templates.list(query);
  }

  @Post()
  @Authorize(admin(Permission.NotificationTemplatesManage))
  @ApiOperation({
    summary: 'Create a template',
    description:
      'One template per code, channel and language, created as DRAFT with version 1. Kinyarwanda and English are written separately; nothing is translated automatically. Every {{placeholder}} needs a variable definition. **Admin only.**',
  })
  @ApiCreatedResponse({ type: TemplateResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Code, channel and language already used',
  })
  create(
    @Body() dto: CreateTemplateDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TemplateResponseDto> {
    return this.templates.create(dto, actor);
  }

  @Get(':id')
  @Authorize(admin(Permission.NotificationTemplatesRead))
  @ApiOperation({
    summary: 'Get a template with its current version',
    description: '**Admin only.**',
  })
  @ApiOkResponse({ type: TemplateResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Template not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<TemplateResponseDto> {
    return this.templates.findOne(id);
  }

  @Patch(':id')
  @Authorize(admin(Permission.NotificationTemplatesManage))
  @ApiOperation({
    summary: 'Update template metadata',
    description: 'Name, description and category. Text changes need a new version. **Admin only.**',
  })
  @ApiOkResponse({ type: TemplateResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TemplateResponseDto> {
    return this.templates.update(id, dto, actor);
  }

  @Get(':id/history')
  @Authorize(admin(Permission.NotificationTemplatesRead))
  @ApiOperation({
    summary: 'Template history',
    description: 'All versions and the audit trail. **Admin only.**',
  })
  @ApiOkResponse({ type: TemplateHistoryResponseDto })
  history(@Param('id', ParseUUIDPipe) id: string): Promise<TemplateHistoryResponseDto> {
    return this.templates.history(id);
  }

  @Get(':id/versions')
  @Authorize(admin(Permission.NotificationTemplatesRead))
  @ApiOperation({ summary: 'List versions, newest first', description: '**Admin only.**' })
  @ApiOkResponse({ type: TemplateVersionResponseDto, isArray: true })
  versions(@Param('id', ParseUUIDPipe) id: string): Promise<TemplateVersionResponseDto[]> {
    return this.templates.listVersions(id);
  }

  @Post(':id/versions')
  @Authorize(admin(Permission.NotificationTemplatesManage))
  @ApiOperation({
    summary: 'Add a template version',
    description:
      'Earlier versions are kept. The new version is used only when makeCurrent is true or it is made current later. **Admin only.**',
  })
  @ApiCreatedResponse({ type: TemplateVersionResponseDto })
  addVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTemplateVersionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TemplateVersionResponseDto> {
    return this.templates.addVersion(id, dto, actor);
  }

  @Get(':id/versions/:versionId')
  @Authorize(admin(Permission.NotificationTemplatesRead))
  @ApiOperation({ summary: 'Get one version', description: '**Admin only.**' })
  @ApiOkResponse({ type: TemplateVersionResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Version not found' })
  version(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<TemplateVersionResponseDto> {
    return this.templates.findVersion(id, versionId);
  }

  @Post(':id/current-version')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.NotificationTemplatesManage))
  @ApiOperation({ summary: 'Choose the current version', description: '**Admin only.**' })
  @ApiOkResponse({ type: TemplateResponseDto })
  setCurrent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCurrentVersionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TemplateResponseDto> {
    return this.templates.setCurrentVersion(id, dto, actor);
  }

  @Post(':id/preview')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.NotificationTemplatesRead))
  @ApiOperation({
    summary: 'Preview a template',
    description:
      'Validates the variables against the definitions and renders the text. Nothing is stored or sent. **Admin only.**',
  })
  @ApiOkResponse({ type: TemplatePreviewResponseDto })
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreviewTemplateDto,
  ): Promise<TemplatePreviewResponseDto> {
    return this.templates.preview(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.NotificationTemplatesManage))
  @ApiOperation({ summary: 'Activate a template', description: '**Admin only.**' })
  @ApiOkResponse({ type: TemplateResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Archived, or no current version' })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TemplateResponseDto> {
    return this.templates.activate(id, actor);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.NotificationTemplatesManage))
  @ApiOperation({ summary: 'Deactivate a template', description: '**Admin only.**' })
  @ApiOkResponse({ type: TemplateResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TemplateResponseDto> {
    return this.templates.deactivate(id, actor);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Authorize(admin(Permission.NotificationTemplatesManage))
  @ApiOperation({
    summary: 'Archive a template',
    description: 'Versions are preserved. System templates cannot be archived. **Admin only.**',
  })
  @ApiOkResponse({ type: TemplateResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'System template' })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TemplateResponseDto> {
    return this.templates.archive(id, actor);
  }
}

@ApiTags('Notification admin: settings')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('admin/notifications')
export class AdminNotificationSettingsController {
  constructor(
    private readonly settings: NotificationSettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('categories')
  @Authorize(admin(Permission.NotificationSettingsRead))
  @ApiOperation({
    summary: 'List notification categories and their policy',
    description: '**Admin only.**',
  })
  @ApiOkResponse({ type: CategorySettingResponseDto, isArray: true })
  categories(): Promise<CategorySettingResponseDto[]> {
    return this.settings.listCategories();
  }

  @Patch('categories/:category')
  @Authorize(admin(Permission.NotificationSettingsManage))
  @ApiOperation({
    summary: 'Configure a category',
    description:
      'Essential flag, active flag and allowed channels. Account, account approval and security are essential and locked. **Admin only.**',
  })
  @ApiParam({ name: 'category', enum: NotificationCategory })
  @ApiOkResponse({ type: CategorySettingResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Locked essential category' })
  updateCategory(
    @Param('category', new ParseEnumPipe(NotificationCategory)) category: NotificationCategory,
    @Body() dto: UpdateCategorySettingDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CategorySettingResponseDto> {
    return this.settings.updateCategory(category, dto, actor);
  }

  @Get('channels')
  @Authorize(admin(Permission.NotificationSettingsRead))
  @ApiOperation({
    summary: 'List channels and whether they can deliver',
    description:
      'Shows whether a provider is registered for each channel. No provider ships with the application, so every channel except IN_APP reports providerRegistered=false. **Admin only.**',
  })
  @ApiOkResponse({ type: ChannelSettingResponseDto, isArray: true })
  channels(): Promise<ChannelSettingResponseDto[]> {
    return this.settings.listChannels();
  }

  @Patch('channels/:channel')
  @Authorize(admin(Permission.NotificationSettingsManage))
  @ApiOperation({
    summary: 'Enable or disable a channel',
    description:
      'A channel can be enabled only while a provider is registered for it. IN_APP is always enabled. **Admin only.**',
  })
  @ApiParam({ name: 'channel', enum: NotificationChannel })
  @ApiOkResponse({ type: ChannelSettingResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'No provider registered, or IN_APP' })
  updateChannel(
    @Param('channel', new ParseEnumPipe(NotificationChannel)) channel: NotificationChannel,
    @Body() dto: UpdateChannelSettingDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ChannelSettingResponseDto> {
    return this.settings.updateChannel(channel, dto, actor);
  }

  @Get('deliveries')
  @Authorize(admin(Permission.NotificationDeliveriesRead))
  @ApiOperation({
    summary: 'List deliveries across users',
    description: 'Per-channel delivery tracking without message text. **Admin only.**',
  })
  @ApiOkResponse({ type: AdminDeliveryListResponseDto })
  deliveries(
    @Query() query: AdminListDeliveriesQueryDto,
  ): Promise<Paginated<AdminDeliveryResponseDto>> {
    return this.notifications.listDeliveries(query);
  }
}
