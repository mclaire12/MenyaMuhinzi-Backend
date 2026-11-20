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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import type { Paginated } from '../../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { Authorize, CurrentUser } from '../../auth/decorators/auth.decorators';
import { ALL_ROLE_CODES, Permission } from '../../roles/rbac.constants';
import {
  ListNotificationsQueryDto,
  MarkAllReadDto,
  MarkAllReadResponseDto,
  NotificationDetailResponseDto,
  NotificationListResponseDto,
  NotificationResponseDto,
  UnreadCountResponseDto,
} from '../dto/notification.dto';
import {
  NotificationPreferencesResponseDto,
  UpdateNotificationPreferencesDto,
} from '../dto/preference.dto';
import { NotificationsService } from '../inbox/notifications.service';
import { NotificationPreferencesService } from '../preferences/notification-preferences.service';

const readers = { roles: ALL_ROLE_CODES, permissions: [Permission.NotificationsRead] };
const managers = { roles: ALL_ROLE_CODES, permissions: [Permission.NotificationsManage] };

@ApiTags('Notifications')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Authorize(readers)
  @ApiOperation({
    summary: 'List my notifications',
    description: 'Newest first. Archived notifications are excluded unless archived=true.',
  })
  @ApiOkResponse({ type: NotificationListResponseDto })
  list(
    @Query() query: ListNotificationsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Paginated<NotificationResponseDto>> {
    return this.notifications.list(actor.id, query);
  }

  @Get('unread-count')
  @Authorize(readers)
  @ApiOperation({
    summary: 'Count my unread notifications',
    description: 'Archived notifications are not counted.',
  })
  @ApiOkResponse({ type: UnreadCountResponseDto })
  unreadCount(@CurrentUser() actor: AuthenticatedUser): Promise<UnreadCountResponseDto> {
    return this.notifications.unreadCount(actor.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @Authorize(managers)
  @ApiOperation({
    summary: 'Mark all my unread notifications as read',
    description: 'Optionally limited to one category.',
  })
  @ApiOkResponse({ type: MarkAllReadResponseDto })
  readAll(
    @Body() dto: MarkAllReadDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MarkAllReadResponseDto> {
    return this.notifications.markAllRead(actor.id, dto);
  }

  @Get(':id')
  @Authorize(readers)
  @ApiOperation({
    summary: 'Get one of my notifications with its delivery status per channel',
    description:
      'Each channel is tracked separately. SENT means a provider accepted the message; no provider is registered yet, so external channels show SKIPPED or FAILED with a reason.',
  })
  @ApiOkResponse({ type: NotificationDetailResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Not found or not mine' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<NotificationDetailResponseDto> {
    return this.notifications.findOne(actor.id, id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @Authorize(managers)
  @ApiOperation({ summary: 'Mark a notification as read', description: 'Idempotent.' })
  @ApiOkResponse({ type: NotificationDetailResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Not found or not mine' })
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<NotificationDetailResponseDto> {
    return this.notifications.markRead(actor.id, id);
  }

  @Post(':id/unread')
  @HttpCode(HttpStatus.OK)
  @Authorize(managers)
  @ApiOperation({ summary: 'Mark a notification as unread' })
  @ApiOkResponse({ type: NotificationDetailResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Not found or not mine' })
  markUnread(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<NotificationDetailResponseDto> {
    return this.notifications.markUnread(actor.id, id);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Authorize(managers)
  @ApiOperation({
    summary: 'Archive a notification',
    description: 'Removes it from the inbox and the unread count. Nothing is deleted.',
  })
  @ApiOkResponse({ type: NotificationDetailResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Not found or not mine' })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<NotificationDetailResponseDto> {
    return this.notifications.archive(actor.id, id);
  }
}

@ApiTags('Notification preferences')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
@Controller('notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get()
  @Authorize(readers)
  @ApiOperation({
    summary: 'Get my notification preferences',
    description:
      'Lists only the channels my account type supports, with whether each is available now and why not. Basic-phone farmers are never asked for an email address.',
  })
  @ApiOkResponse({ type: NotificationPreferencesResponseDto })
  get(@CurrentUser() actor: AuthenticatedUser): Promise<NotificationPreferencesResponseDto> {
    return this.preferences.get(actor.id);
  }

  @Patch()
  @Authorize(managers)
  @ApiOperation({
    summary: 'Update my notification preferences',
    description:
      'Channels, categories, language, time zone, quiet hours and the account-level switch for non-essential notifications. Unavailable channels cannot be turned on; essential account, approval and security notifications cannot be turned off and ignore quiet hours.',
  })
  @ApiOkResponse({ type: NotificationPreferencesResponseDto })
  update(
    @Body() dto: UpdateNotificationPreferencesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<NotificationPreferencesResponseDto> {
    return this.preferences.update(actor.id, dto, actor);
  }
}
