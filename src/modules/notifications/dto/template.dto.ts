import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Trim } from '../../../common/validation/validators';
import {
  Language,
  NotificationCategory,
  NotificationChannel,
  NotificationTemplateStatus,
} from '../../../generated/prisma/client';
import { AuditEntryDto } from '../../knowledge/dto/knowledge-source.dto';
import { VARIABLE_NAME_PATTERN } from '../common/template-renderer';
import { TEMPLATE_CODE_PATTERN } from '../notifications.constants';

export class VariableDefinitionDto {
  @ApiProperty({ example: 'fullName', description: 'Used as {{fullName}} in the subject and body' })
  @Matches(VARIABLE_NAME_PATTERN, {
    message: 'name must start with a letter and use letters, digits and underscores (max 40)',
  })
  name: string;

  @ApiProperty({ enum: ['string', 'number', 'date'] })
  @IsIn(['string', 'number', 'date'])
  type: 'string' | 'number' | 'date';

  @ApiProperty({ description: 'Rendering fails when a required variable is missing' })
  @IsBoolean()
  required: boolean;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 2000,
    description: 'Longest accepted text value (default 200)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  maxLength?: number;
}

export class TemplateContentDto {
  @ApiPropertyOptional({
    maxLength: 200,
    description:
      'Required for IN_APP, EMAIL and PUSH (the title); not allowed for SMS, USSD and IVR',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiProperty({
    example: 'Hello {{fullName}}, your account has been approved.',
    description:
      'Plain text with {{variable}} placeholders. Written for one language; never translated automatically. Do not include passwords, tokens or other credentials.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20_000)
  body: string;

  @ApiProperty({
    type: VariableDefinitionDto,
    isArray: true,
    description: 'Every placeholder must be defined here',
  })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => VariableDefinitionDto)
  variables: VariableDefinitionDto[];

  @ApiPropertyOptional({ maxLength: 1000, description: 'Why the change was made' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  changeNote?: string;
}

export class CreateTemplateDto extends TemplateContentDto {
  @ApiProperty({
    example: 'COURSE_ENROLLED',
    description: 'Upper-case identifier shared by the channel and language variants',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(TEMPLATE_CODE_PATTERN, {
    message: 'code must be upper-case letters, digits and underscores',
  })
  code: string;

  @ApiProperty({ enum: NotificationChannel })
  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @ApiProperty({ enum: Language, description: 'Kinyarwanda (rw) or English (en)' })
  @IsEnum(Language)
  language: Language;

  @ApiProperty({ maxLength: 150 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: NotificationCategory })
  @IsEnum(NotificationCategory)
  category: NotificationCategory;
}

/** Metadata only; text changes create a new version. */
export class UpdateTemplateDto {
  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: NotificationCategory })
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;
}

export class CreateTemplateVersionDto extends TemplateContentDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Make the new version the one used for new notifications',
  })
  @IsOptional()
  @IsBoolean()
  makeCurrent?: boolean;
}

export class SetCurrentVersionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  versionId: string;
}

export class PreviewTemplateDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Defaults to the current version' })
  @IsOptional()
  @IsUUID()
  versionId?: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { fullName: 'Aline Uwase' },
    description:
      'Values are validated against the variable definitions; unknown variables are rejected',
  })
  @IsObject()
  variables: Record<string, unknown>;
}

export class ListTemplatesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NotificationChannel })
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({ enum: NotificationCategory })
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;

  @ApiPropertyOptional({ enum: NotificationTemplateStatus })
  @IsOptional()
  @IsEnum(NotificationTemplateStatus)
  status?: NotificationTemplateStatus;

  @ApiPropertyOptional({ description: 'Matches code or name' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class TemplateVersionResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) templateId: string;
  @ApiProperty() versionNumber: number;
  @ApiPropertyOptional({ type: String, nullable: true }) subject: string | null;
  @ApiProperty() body: string;
  @ApiProperty({ type: VariableDefinitionDto, isArray: true }) variables: VariableDefinitionDto[];
  @ApiPropertyOptional({ type: String, nullable: true }) changeNote: string | null;
  @ApiProperty() isCurrent: boolean;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) createdById: string | null;
  @ApiProperty() createdAt: Date;
}

export class TemplateResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() code: string;
  @ApiProperty({ enum: NotificationChannel }) channel: NotificationChannel;
  @ApiProperty({ enum: Language }) language: Language;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ enum: NotificationCategory }) category: NotificationCategory;
  @ApiProperty({ enum: NotificationTemplateStatus }) status: NotificationTemplateStatus;
  @ApiProperty({ description: 'Seeded template used by built-in events; cannot be archived' })
  isSystem: boolean;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) currentVersionId:
    string | null;
  @ApiProperty() latestVersionNumber: number;
  @ApiPropertyOptional({ type: TemplateVersionResponseDto, nullable: true })
  currentVersion: TemplateVersionResponseDto | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) archivedAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) createdById: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class TemplateListResponseDto {
  @ApiProperty({ type: TemplateResponseDto, isArray: true }) data: TemplateResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

export class TemplateHistoryResponseDto {
  @ApiProperty({ type: TemplateVersionResponseDto, isArray: true, description: 'Newest first' })
  versions: TemplateVersionResponseDto[];
  @ApiProperty({ type: AuditEntryDto, isArray: true }) audit: AuditEntryDto[];
}

export class TemplatePreviewResponseDto {
  @ApiProperty({ enum: NotificationChannel }) channel: NotificationChannel;
  @ApiProperty({ enum: Language }) language: Language;
  @ApiProperty({ format: 'uuid' }) versionId: string;
  @ApiPropertyOptional({ type: String, nullable: true }) subject: string | null;
  @ApiProperty() body: string;
  @ApiProperty({ example: 'Preview only: nothing was sent.' }) notice: string;
}
