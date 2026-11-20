import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../common/validation/validators';
import {
  Language,
  NotificationCategory,
  NotificationChannel,
} from '../../../generated/prisma/client';
import { TIME_PATTERN } from '../common/quiet-hours';

export class QuietHoursDto {
  @ApiProperty({
    description: 'Quiet hours hold back non-essential SMS, email, push, USSD and IVR messages',
  })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({ example: '21:00', description: 'Local time, HH:mm (24 hours)' })
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'start must be a time like 21:00' })
  start?: string;

  @ApiPropertyOptional({
    example: '06:00',
    description: 'Local time, HH:mm (24 hours); may be earlier than start',
  })
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'end must be a time like 06:00' })
  end?: string;
}

export class ChannelPreferenceUpdateDto {
  @ApiProperty({ enum: NotificationChannel })
  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @ApiProperty({
    description: 'Turning a channel off is always allowed; turning one on needs it to be available',
  })
  @IsBoolean()
  enabled: boolean;
}

export class CategoryPreferenceUpdateDto {
  @ApiProperty({ enum: NotificationCategory })
  @IsEnum(NotificationCategory)
  category: NotificationCategory;

  @ApiProperty({ description: 'Essential categories cannot be turned off' })
  @IsBoolean()
  enabled: boolean;
}

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({
    enum: Language,
    nullable: true,
    description: 'Language for notifications. null returns to the account language.',
  })
  @IsOptional()
  @IsEnum(Language)
  preferredLanguage?: Language | null;

  @ApiPropertyOptional({
    example: 'Africa/Kigali',
    description: 'IANA time zone used for quiet hours',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(64)
  timeZone?: string;

  @ApiPropertyOptional({ type: QuietHoursDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quietHours?: QuietHoursDto;

  @ApiPropertyOptional({
    description: 'Account-level switch for every notification that is not essential',
  })
  @IsOptional()
  @IsBoolean()
  nonEssentialEnabled?: boolean;

  @ApiPropertyOptional({ type: ChannelPreferenceUpdateDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ChannelPreferenceUpdateDto)
  channels?: ChannelPreferenceUpdateDto[];

  @ApiPropertyOptional({ type: CategoryPreferenceUpdateDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CategoryPreferenceUpdateDto)
  categories?: CategoryPreferenceUpdateDto[];
}

export class ChannelPreferenceResponseDto {
  @ApiProperty({ enum: NotificationChannel }) channel: NotificationChannel;
  @ApiProperty({ description: 'What the user chose; on by default' }) enabled: boolean;
  @ApiProperty({
    description:
      'The channel can deliver to this user now: supported, enabled by an administrator, backed by a provider, and the user has an address',
  })
  available: boolean;
  @ApiProperty({ description: 'enabled && available: notifications will use this channel' })
  active: boolean;
  @ApiProperty({ description: 'The inbox cannot be turned off' }) locked: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'NOTIFICATION_CHANNEL_DISABLED' })
  unavailableReasonCode: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) unavailableReason: string | null;
}

export class CategoryPreferenceResponseDto {
  @ApiProperty({ enum: NotificationCategory }) category: NotificationCategory;
  @ApiProperty() enabled: boolean;
  @ApiProperty({ description: 'Essential notifications are always delivered to the inbox' })
  isEssential: boolean;
  @ApiProperty({ description: 'The user cannot change this category' }) locked: boolean;
}

export class QuietHoursResponseDto {
  @ApiProperty() enabled: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) start: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) end: string | null;
}

export class NotificationPreferencesResponseDto {
  @ApiProperty({ type: String, isArray: true, description: 'Role codes of the account' })
  accountTypes: string[];
  @ApiProperty({ enum: Language }) accountLanguage: Language;
  @ApiPropertyOptional({ enum: Language, nullable: true }) preferredLanguage: Language | null;
  @ApiProperty({
    enum: Language,
    description: 'preferredLanguage, or the account language when none is set',
  })
  effectiveLanguage: Language;
  @ApiProperty({ example: 'Africa/Kigali' }) timeZone: string;
  @ApiProperty({ type: QuietHoursResponseDto }) quietHours: QuietHoursResponseDto;
  @ApiProperty() nonEssentialEnabled: boolean;
  @ApiProperty({
    type: ChannelPreferenceResponseDto,
    isArray: true,
    description: 'Only channels this account type supports',
  })
  channels: ChannelPreferenceResponseDto[];
  @ApiProperty({ type: CategoryPreferenceResponseDto, isArray: true })
  categories: CategoryPreferenceResponseDto[];
}
