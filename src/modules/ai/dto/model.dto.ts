import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDate,
  IsEnum,
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
} from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Trim } from '../../../common/validation/validators';
import {
  AiCapability,
  AiRecordStatus,
  Language,
  RecordStatus,
} from '../../../generated/prisma/client';
import { ChangeNoteDto } from './common.dto';

const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;

export class CreateAiModelDto extends ChangeNoteDto {
  @ApiProperty({
    maxLength: 100,
    example: 'example-provider',
    description: 'Identifier of the AiProvider implementation that would serve this model',
  })
  @Trim()
  @Matches(PROVIDER_PATTERN, { message: 'provider must be a lower-case identifier' })
  provider: string;

  @ApiProperty({ maxLength: 200, example: 'example-model' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  modelName: string;

  @ApiProperty({ maxLength: 100, example: '2026-01' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  modelVersion: string;

  @ApiProperty({ maxLength: 200, example: 'Example model (Jan 2026)' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  displayName: string;

  @ApiProperty({ enum: AiCapability, isArray: true, example: [AiCapability.TEXT_GENERATION] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(AiCapability, { each: true })
  capabilities: AiCapability[];

  @ApiPropertyOptional({ enum: Language, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Language, { each: true })
  supportedLanguages?: Language[];

  @ApiPropertyOptional({ minimum: 1, example: 128000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  contextWindowTokens?: number;

  @ApiPropertyOptional({ minimum: 1, example: 4096 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  maxOutputTokens?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Non-secret descriptive settings. Keys or values that look like credentials (apiKey, token, secret, ...) are rejected.',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/** Provider, model name and version identify the model and cannot change. */
export class UpdateAiModelDto extends PartialType(
  OmitType(CreateAiModelDto, ['provider', 'modelName', 'modelVersion']),
) {}

export class ListAiModelsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AiRecordStatus })
  @IsOptional()
  @IsEnum(AiRecordStatus)
  status?: AiRecordStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @Matches(PROVIDER_PATTERN)
  provider?: string;

  @ApiPropertyOptional({ enum: AiCapability })
  @IsOptional()
  @IsEnum(AiCapability)
  capability?: AiCapability;
}

export class AiModelResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() provider: string;
  @ApiProperty() modelName: string;
  @ApiProperty() modelVersion: string;
  @ApiProperty() displayName: string;
  @ApiProperty({ enum: AiCapability, isArray: true }) capabilities: AiCapability[];
  @ApiProperty({ enum: Language, isArray: true }) supportedLanguages: Language[];
  @ApiPropertyOptional({ type: Number, nullable: true }) contextWindowTokens: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) maxOutputTokens: number | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  metadata: unknown;
  @ApiProperty({ enum: AiRecordStatus }) status: AiRecordStatus;
  @ApiProperty() currentVersion: number;
  @ApiProperty({
    description:
      'Whether an AiProvider with this id is registered in the running application. Always false until a provider is integrated.',
  })
  providerRegistered: boolean;
  @ApiPropertyOptional({ type: Date, nullable: true }) archivedAt: Date | null;
  @ApiProperty({ format: 'uuid' }) createdById: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class AiModelListResponseDto {
  @ApiProperty({ type: AiModelResponseDto, isArray: true }) data: AiModelResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

// ------------------------------------------------------------ model configurations

export class CreateModelConfigurationDto extends ChangeNoteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  assistantId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  primaryModelId: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Must differ from the primary model' })
  @IsOptional()
  @IsUUID()
  fallbackModelId?: string;

  @ApiPropertyOptional({
    enum: AiCapability,
    isArray: true,
    default: [AiCapability.TEXT_GENERATION],
    description: 'Every configured model must offer these capabilities',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(AiCapability, { each: true })
  requiredCapabilities?: AiCapability[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { temperature: 0.2 },
    description: 'Non-secret generation settings',
  })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'When the configuration takes effect after activation; defaults to activation time',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveFrom?: Date;
}

export class ListModelConfigurationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assistantId?: string;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class ModelSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() provider: string;
  @ApiProperty() modelName: string;
  @ApiProperty() modelVersion: string;
  @ApiProperty() displayName: string;
  @ApiProperty({ enum: AiRecordStatus }) status: AiRecordStatus;
  @ApiProperty() providerRegistered: boolean;
}

export class ModelConfigurationResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) assistantId: string;
  @ApiProperty() version: number;
  @ApiProperty({ type: ModelSummaryDto }) primaryModel: ModelSummaryDto;
  @ApiPropertyOptional({ type: ModelSummaryDto, nullable: true })
  fallbackModel: ModelSummaryDto | null;
  @ApiProperty({ enum: AiCapability, isArray: true }) requiredCapabilities: AiCapability[];
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  parameters: unknown;
  @ApiProperty({ enum: RecordStatus }) status: RecordStatus;
  @ApiPropertyOptional({ type: Date, nullable: true }) effectiveFrom: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) deactivatedAt: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) changeNote: string | null;
  @ApiProperty({ format: 'uuid' }) createdById: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ModelConfigurationListResponseDto {
  @ApiProperty({ type: ModelConfigurationResponseDto, isArray: true })
  data: ModelConfigurationResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}
