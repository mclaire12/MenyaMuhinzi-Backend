import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsRwandanPhone, Trim } from '../../common/validation/validators';
import { Language } from '../../generated/prisma/client';

export const PUBLICATION_SCOPES = ['PLATFORM', 'TARGETED'] as const;
export type DefaultPublicationScope = (typeof PUBLICATION_SCOPES)[number];

export class PlatformInfoDto {
  @ApiProperty({ example: 'MenyaMuhinzi', maxLength: 100 })
  @Trim()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'Iga. Hinga. Usarure neza.', maxLength: 200 })
  @Trim()
  @IsString()
  @MaxLength(200)
  tagline: string;

  @ApiProperty({ example: 'support@menyamuhinzi.rw', description: 'Empty string clears it' })
  @Trim()
  @ValidateIf((dto: PlatformInfoDto) => dto.supportEmail !== '')
  @IsEmail()
  @MaxLength(254)
  supportEmail: string;

  @ApiProperty({ example: '+250788000000', description: 'Empty string clears it' })
  @Trim()
  @ValidateIf((dto: PlatformInfoDto) => dto.supportPhone !== '')
  @IsRwandanPhone()
  supportPhone: string;
}

export class AdminNotificationPreferencesDto {
  @ApiProperty() @IsBoolean() accountRequests: boolean;
  @ApiProperty() @IsBoolean() aiFailures: boolean;
  @ApiProperty() @IsBoolean() coursePublished: boolean;
  @ApiProperty() @IsBoolean() weeklySummary: boolean;
}

export class UpdatePlatformSettingsDto {
  @ApiPropertyOptional({ type: PlatformInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformInfoDto)
  platform?: PlatformInfoDto;

  @ApiPropertyOptional({ enum: Language, description: 'Default language for new content and accounts' })
  @IsOptional()
  @IsEnum(Language)
  defaultLanguage?: Language;

  @ApiPropertyOptional({ enum: PUBLICATION_SCOPES, description: 'Pre-selected audience when publishing a course' })
  @IsOptional()
  @IsIn(PUBLICATION_SCOPES)
  defaultPublicationScope?: DefaultPublicationScope;

  @ApiPropertyOptional({ type: AdminNotificationPreferencesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AdminNotificationPreferencesDto)
  adminNotifications?: AdminNotificationPreferencesDto;
}

export class PlatformSettingsResponseDto {
  @ApiProperty({ type: PlatformInfoDto }) platform: PlatformInfoDto;
  @ApiProperty({ enum: Language }) defaultLanguage: Language;
  @ApiProperty({ enum: PUBLICATION_SCOPES }) defaultPublicationScope: DefaultPublicationScope;
  @ApiProperty({ type: AdminNotificationPreferencesDto }) adminNotifications: AdminNotificationPreferencesDto;
  @ApiPropertyOptional({ type: Date, nullable: true }) updatedAt: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) updatedBy: string | null;
}
