import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  Language,
  NotificationCategory,
  NotificationChannel,
  NotificationDeliveryStatus,
} from '../../../generated/prisma/client';

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NotificationCategory })
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;

  @ApiPropertyOptional({ description: 'true: only read; false: only unread' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  read?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'true lists archived notifications instead of the inbox',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  archived?: boolean;
}

export class MarkAllReadDto {
  @ApiPropertyOptional({
    enum: NotificationCategory,
    description: 'Only this category; default is every category',
  })
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;
}

export class DeliveryStatusResponseDto {
  @ApiProperty({ enum: NotificationChannel }) channel: NotificationChannel;
  @ApiProperty({
    enum: NotificationDeliveryStatus,
    description:
      'SENT means a provider accepted the message; DELIVERED only appears for the in-app inbox or a provider receipt',
  })
  status: NotificationDeliveryStatus;
  @ApiProperty({ enum: Language }) language: Language;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'NOTIFICATION_CHANNEL_DISABLED' })
  reasonCode: string | null;
  @ApiProperty({ description: 'Plain-language explanation of the status' }) note: string;
  @ApiPropertyOptional({ type: Date, nullable: true }) scheduledFor: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) sentAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) deliveredAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) failedAt: Date | null;
  @ApiProperty({ description: 'True when a test double handled the delivery' }) isTestData: boolean;
}

export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: NotificationCategory }) category: NotificationCategory;
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty({ enum: Language }) language: Language;
  @ApiProperty() isEssential: boolean;
  @ApiProperty() isRead: boolean;
  @ApiPropertyOptional({ type: Date, nullable: true }) readAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) archivedAt: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'course' }) entityType:
    string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) entityId: string | null;
  @ApiProperty() createdAt: Date;
}

export class NotificationDetailResponseDto extends NotificationResponseDto {
  @ApiProperty({
    type: DeliveryStatusResponseDto,
    isArray: true,
    description: 'One entry per channel',
  })
  deliveries: DeliveryStatusResponseDto[];
}

export class NotificationListResponseDto {
  @ApiProperty({ type: NotificationResponseDto, isArray: true }) data: NotificationResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

export class UnreadCountByCategoryDto {
  @ApiProperty({ enum: NotificationCategory }) category: NotificationCategory;
  @ApiProperty() count: number;
}

export class UnreadCountResponseDto {
  @ApiProperty({ description: 'Unread notifications in the inbox (archived ones are not counted)' })
  total: number;
  @ApiProperty({ type: UnreadCountByCategoryDto, isArray: true })
  byCategory: UnreadCountByCategoryDto[];
}

export class MarkAllReadResponseDto {
  @ApiProperty({ description: 'Notifications that were unread and are now read' }) updated: number;
}

export class AdminListDeliveriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NotificationChannel })
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @ApiPropertyOptional({ enum: NotificationDeliveryStatus })
  @IsOptional()
  @IsEnum(NotificationDeliveryStatus)
  status?: NotificationDeliveryStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  notificationId?: string;

  @ApiPropertyOptional({ description: 'true: only test-double deliveries; false: only real ones' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isTestData?: boolean;
}

export class AdminDeliveryResponseDto extends DeliveryStatusResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) notificationId: string;
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty() attempts: number;
  @ApiPropertyOptional({ type: String, nullable: true }) providerId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) templateCode: string | null;
  @ApiProperty() createdAt: Date;
}

export class AdminDeliveryListResponseDto {
  @ApiProperty({ type: AdminDeliveryResponseDto, isArray: true }) data: AdminDeliveryResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}
