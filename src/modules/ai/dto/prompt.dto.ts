import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Trim } from '../../../common/validation/validators';
import { AiPromptCategory, AiRecordStatus, Language } from '../../../generated/prisma/client';
import { ChangeNoteDto } from './common.dto';

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,59}$/;
export const PROMPT_MAX_CHARS = 20_000;

export class PromptContentDto extends ChangeNoteDto {
  @ApiProperty({
    maxLength: PROMPT_MAX_CHARS,
    example:
      'You are {{assistantName}}. Answer in {{language}} using only these sources:\n{{context}}',
    description:
      'Template text. Placeholders use {{name}}; available values: assistantName, purpose, language, crops, context. Stored only; never executed.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PROMPT_MAX_CHARS)
  content: string;
}

export class CreatePromptTemplateDto extends PromptContentDto {
  @ApiProperty({ example: 'TOMATO_SYSTEM', description: 'Upper-case identifier; cannot change' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(CODE_PATTERN, { message: 'code must be upper-case letters, digits and underscores' })
  code: string;

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

  @ApiProperty({ enum: AiPromptCategory })
  @IsEnum(AiPromptCategory)
  category: AiPromptCategory;

  @ApiProperty({ enum: Language })
  @IsEnum(Language)
  language: Language;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  purpose?: string;
}

/** Metadata only; content changes create a new version. */
export class UpdatePromptTemplateDto {
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

  @ApiPropertyOptional({ enum: AiPromptCategory })
  @IsOptional()
  @IsEnum(AiPromptCategory)
  category?: AiPromptCategory;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  purpose?: string;
}

export class CreatePromptVersionDto extends PromptContentDto {
  @ApiPropertyOptional({ default: false, description: 'Make the new version the default' })
  @IsOptional()
  @IsBoolean()
  makeDefault?: boolean;
}

export class SetDefaultPromptVersionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  versionId: string;
}

export class ListPromptTemplatesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AiPromptCategory })
  @IsOptional()
  @IsEnum(AiPromptCategory)
  category?: AiPromptCategory;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({ enum: AiRecordStatus })
  @IsOptional()
  @IsEnum(AiRecordStatus)
  status?: AiRecordStatus;

  @ApiPropertyOptional({ description: 'Matches code or name' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class PromptVersionResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) templateId: string;
  @ApiProperty() versionNumber: number;
  @ApiProperty() content: string;
  @ApiProperty({ type: String, isArray: true }) variables: string[];
  @ApiPropertyOptional({ type: String, nullable: true }) changeNote: string | null;
  @ApiProperty() isDefault: boolean;
  @ApiProperty({ format: 'uuid' }) createdById: string;
  @ApiProperty() createdAt: Date;
}

export class PromptTemplateResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ enum: AiPromptCategory }) category: AiPromptCategory;
  @ApiProperty({ enum: Language }) language: Language;
  @ApiPropertyOptional({ type: String, nullable: true }) purpose: string | null;
  @ApiProperty({ enum: AiRecordStatus }) status: AiRecordStatus;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  defaultVersionId: string | null;
  @ApiProperty() latestVersionNumber: number;
  @ApiPropertyOptional({ type: PromptVersionResponseDto, nullable: true })
  defaultVersion: PromptVersionResponseDto | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) archivedAt: Date | null;
  @ApiProperty({ format: 'uuid' }) createdById: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class PromptTemplateListResponseDto {
  @ApiProperty({ type: PromptTemplateResponseDto, isArray: true })
  data: PromptTemplateResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}
