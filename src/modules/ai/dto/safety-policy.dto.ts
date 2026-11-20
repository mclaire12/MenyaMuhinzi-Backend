import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Trim } from '../../../common/validation/validators';
import { AiRecordStatus, AiSafetyCategory } from '../../../generated/prisma/client';
import { ChangeNoteDto } from './common.dto';

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,59}$/;
const trimEach = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : item))
    : value;

/** Fields that define the policy rules; changing any of them creates a new version. */
export class SafetyPolicyRulesDto extends ChangeNoteDto {
  @ApiPropertyOptional({
    type: String,
    isArray: true,
    example: ['Do not state pesticide doses'],
    description: 'Things a response must not do',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @Transform(trimEach)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(500, { each: true })
  restrictions?: string[];

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    example: ['pesticide', 'umuti wica udukoko'],
    description: 'Words in a question or response that make this policy relevant',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @Transform(trimEach)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(100, { each: true })
  triggerKeywords?: string[];

  @ApiPropertyOptional({ default: false, description: 'Matching requests need a human expert' })
  @IsOptional()
  @IsBoolean()
  requiresEscalation?: boolean;

  @ApiPropertyOptional({ maxLength: 2000, example: 'Refer the farmer to the sector agronomist.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  escalationGuidance?: string;
}

export class CreateSafetyPolicyDto extends SafetyPolicyRulesDto {
  @ApiProperty({ example: 'PESTICIDE_CAUTION' })
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

  @ApiProperty({ enum: AiSafetyCategory })
  @IsEnum(AiSafetyCategory)
  category: AiSafetyCategory;

  @ApiProperty({
    maxLength: 10000,
    example: 'Recommend contacting an agronomist before any pesticide use.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  instructions: string;
}

export class UpdateSafetyPolicyDto extends SafetyPolicyRulesDto {
  @ApiPropertyOptional({ maxLength: 10000 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  instructions?: string;

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

  @ApiPropertyOptional({ enum: AiSafetyCategory })
  @IsOptional()
  @IsEnum(AiSafetyCategory)
  category?: AiSafetyCategory;
}

export class ListSafetyPoliciesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AiSafetyCategory })
  @IsOptional()
  @IsEnum(AiSafetyCategory)
  category?: AiSafetyCategory;

  @ApiPropertyOptional({ enum: AiRecordStatus })
  @IsOptional()
  @IsEnum(AiRecordStatus)
  status?: AiRecordStatus;
}

export class SafetyPolicyVersionResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) policyId: string;
  @ApiProperty() versionNumber: number;
  @ApiProperty() instructions: string;
  @ApiProperty({ type: String, isArray: true }) restrictions: string[];
  @ApiProperty({ type: String, isArray: true }) triggerKeywords: string[];
  @ApiProperty() requiresEscalation: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) escalationGuidance: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) changeNote: string | null;
  @ApiProperty({ format: 'uuid' }) createdById: string;
  @ApiProperty() createdAt: Date;
}

export class SafetyPolicyResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ enum: AiSafetyCategory }) category: AiSafetyCategory;
  @ApiProperty({ enum: AiRecordStatus }) status: AiRecordStatus;
  @ApiProperty() latestVersionNumber: number;
  @ApiPropertyOptional({ type: SafetyPolicyVersionResponseDto, nullable: true })
  currentVersion: SafetyPolicyVersionResponseDto | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) archivedAt: Date | null;
  @ApiProperty({ format: 'uuid' }) createdById: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class SafetyPolicyListResponseDto {
  @ApiProperty({ type: SafetyPolicyResponseDto, isArray: true }) data: SafetyPolicyResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}
