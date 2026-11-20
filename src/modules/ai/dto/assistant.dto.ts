import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
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
import { AiRecordStatus, Language } from '../../../generated/prisma/client';
import { CropSummaryDto } from '../../crops/dto/crop.dto';
import { ALL_ROLE_CODES, type RoleCode } from '../../roles/rbac.constants';
import { ASSISTANT_TYPE_PATTERN, AssistantType } from '../ai.constants';
import { ChangeNoteDto } from './common.dto';

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,59}$/;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateAiAssistantDto extends ChangeNoteDto {
  @ApiProperty({ example: 'TOMATO_ADVISOR', description: 'Upper-case identifier; cannot change' })
  @Transform(upper)
  @Matches(CODE_PATTERN, { message: 'code must be upper-case letters, digits and underscores' })
  code: string;

  @ApiProperty({ maxLength: 150, example: 'Tomato advisor' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiProperty({
    example: AssistantType.CropSpecific,
    description: `Built-in types: ${Object.values(AssistantType).join(', ')}. Other upper-case identifiers are accepted for new types.`,
  })
  @Transform(upper)
  @Matches(ASSISTANT_TYPE_PATTERN, { message: 'assistantType must be an upper-case identifier' })
  assistantType: string;

  @ApiProperty({
    maxLength: 1000,
    example: 'Answers tomato growing questions from approved guides',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  purpose: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({ enum: Language, isArray: true, example: [Language.rw, Language.en] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(Language, { each: true })
  supportedLanguages: Language[];

  @ApiPropertyOptional({
    enum: Language,
    description: 'Must be one of supportedLanguages; defaults to the first',
  })
  @IsOptional()
  @IsEnum(Language)
  defaultLanguage?: Language;

  @ApiPropertyOptional({
    enum: ALL_ROLE_CODES,
    isArray: true,
    description: 'Roles whose users may use the assistant; defaults to all roles',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(ALL_ROLE_CODES, { each: true })
  allowedRoles?: RoleCode[];

  @ApiPropertyOptional({ type: String, format: 'uuid', isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  cropIds?: string[];

  @ApiPropertyOptional({ default: false, description: 'May use approved knowledge sources' })
  @IsOptional()
  @IsBoolean()
  knowledgeAccess?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 20, default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  maxKnowledgeChunks?: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Responses must cite approved sources; requires knowledgeAccess',
  })
  @IsOptional()
  @IsBoolean()
  requireSourceReferences?: boolean;
}

export class UpdateAiAssistantDto extends PartialType(OmitType(CreateAiAssistantDto, ['code'])) {}

export class ListAiAssistantsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AiRecordStatus })
  @IsOptional()
  @IsEnum(AiRecordStatus)
  status?: AiRecordStatus;

  @ApiPropertyOptional({ example: AssistantType.GeneralAgriculture })
  @IsOptional()
  @Transform(upper)
  @Matches(ASSISTANT_TYPE_PATTERN)
  assistantType?: string;

  @ApiPropertyOptional({ description: 'Matches code or name' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class AssistantPromptLinkDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  templateId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Pin a specific version; otherwise the template default is used',
  })
  @IsOptional()
  @IsUUID()
  pinnedVersionId?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  position?: number;
}

export class SetAssistantPromptsDto extends ChangeNoteDto {
  @ApiProperty({ type: AssistantPromptLinkDto, isArray: true })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AssistantPromptLinkDto)
  prompts: AssistantPromptLinkDto[];
}

export class AssistantPromptDto {
  @ApiProperty({ format: 'uuid' }) templateId: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: AiRecordStatus }) status: AiRecordStatus;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  pinnedVersionId: string | null;
  @ApiProperty() position: number;
}

/** Fields visible to every user allowed to use the assistant. */
export class AiAssistantSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty() assistantType: string;
  @ApiProperty() purpose: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ enum: Language, isArray: true }) supportedLanguages: Language[];
  @ApiProperty({ enum: Language }) defaultLanguage: Language;
  @ApiProperty() knowledgeAccess: boolean;
  @ApiProperty() requireSourceReferences: boolean;
  @ApiProperty({ type: CropSummaryDto, isArray: true }) crops: CropSummaryDto[];
}

export class AiAssistantSummaryListResponseDto {
  @ApiProperty({ type: AiAssistantSummaryDto, isArray: true }) data: AiAssistantSummaryDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

export class AiAssistantResponseDto extends AiAssistantSummaryDto {
  @ApiProperty({ type: String, isArray: true }) allowedRoles: string[];
  @ApiProperty() maxKnowledgeChunks: number;
  @ApiProperty({ enum: AiRecordStatus }) status: AiRecordStatus;
  @ApiProperty() currentVersion: number;
  @ApiPropertyOptional({ type: Date, nullable: true }) archivedAt: Date | null;
  @ApiProperty({ format: 'uuid' }) createdById: string;
  @ApiProperty({ type: AssistantPromptDto, isArray: true }) prompts: AssistantPromptDto[];
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  activeModelConfigurationId: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class AiAssistantListResponseDto {
  @ApiProperty({ type: AiAssistantResponseDto, isArray: true }) data: AiAssistantResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}
