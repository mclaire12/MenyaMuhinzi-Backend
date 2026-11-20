import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../../common/validation/validators';
import { NotificationCategory, NotificationChannel } from '../../../generated/prisma/client';

export class CategorySettingResponseDto {
  @ApiProperty({ enum: NotificationCategory }) category: NotificationCategory;
  @ApiProperty({
    description:
      'Essential categories ignore user opt-outs and quiet hours. Account, approval and security are always essential.',
  })
  isEssential: boolean;
  @ApiProperty({ description: 'Account, approval and security categories cannot be changed' })
  isLocked: boolean;
  @ApiProperty({ description: 'Inactive non-essential categories create no notifications' })
  isActive: boolean;
  @ApiProperty({ enum: NotificationChannel, isArray: true }) allowedChannels: NotificationChannel[];
  @ApiPropertyOptional({ type: String, nullable: true }) description: string | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) updatedAt: Date | null;
}

export class UpdateCategorySettingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEssential?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    enum: NotificationChannel,
    isArray: true,
    description: 'Must include IN_APP, the inbox that records every notification',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(NotificationChannel, { each: true })
  allowedChannels?: NotificationChannel[];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class ChannelSettingResponseDto {
  @ApiProperty({ enum: NotificationChannel }) channel: NotificationChannel;
  @ApiProperty({
    description: 'Set by an administrator; needs a registered provider (except IN_APP)',
  })
  isEnabled: boolean;
  @ApiProperty({
    description:
      'Enabled and able to deliver now. False when a provider is required but not registered.',
  })
  isAvailable: boolean;
  @ApiProperty({ description: 'False for IN_APP, which the platform delivers itself' })
  providerRequired: boolean;
  @ApiProperty({
    description: 'Whether provider code is registered. False for every external channel today.',
  })
  providerRegistered: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) providerId: string | null;
  @ApiProperty({ description: 'True when the registered provider is a test double' })
  isTestProvider: boolean;
  @ApiProperty({
    type: String,
    isArray: true,
    description: 'Account types that can use the channel',
  })
  supportedAccountTypes: string[];
  @ApiPropertyOptional({ type: Date, nullable: true }) updatedAt: Date | null;
}

export class UpdateChannelSettingDto {
  @ApiProperty()
  @IsBoolean()
  isEnabled: boolean;
}
