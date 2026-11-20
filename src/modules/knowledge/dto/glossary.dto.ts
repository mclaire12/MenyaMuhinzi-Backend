import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Trim } from '../../../common/validation/validators';
import { RecordStatus } from '../../../generated/prisma/client';

function IsTextList(maxItems: number, maxLength: number): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }) =>
      Array.isArray(value)
        ? value.map((item: unknown) => (typeof item === 'string' ? item.trim() : item))
        : value,
    ),
    IsArray(),
    ArrayMaxSize(maxItems),
    IsString({ each: true }),
    IsNotEmpty({ each: true }),
    MaxLength(maxLength, { each: true }),
  );
}

const allowNull = () => ValidateIf((_, value) => value !== null);

export class CreateGlossaryTermDto {
  @ApiProperty({ maxLength: 200, example: 'Seedbed' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  termEn: string;

  @ApiProperty({ maxLength: 200, description: 'Provided by an administrator; never generated' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  termRw: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  descriptionEn?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  descriptionRw?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cropId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  topicId?: string;

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsTextList(20, 200)
  synonymsEn?: string[];

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    description: 'Several Kinyarwanda synonyms are allowed',
  })
  @IsOptional()
  @IsTextList(20, 200)
  synonymsRw?: string[];

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsTextList(20, 500)
  usageExamples?: string[];
}

export class UpdateGlossaryTermDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  termEn?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  termRw?: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @allowNull()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  descriptionEn?: string | null;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @allowNull()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  descriptionRw?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @allowNull()
  @IsOptional()
  @IsUUID()
  cropId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @allowNull()
  @IsOptional()
  @IsUUID()
  topicId?: string | null;

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsTextList(20, 200)
  synonymsEn?: string[];

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsTextList(20, 200)
  synonymsRw?: string[];

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsTextList(20, 500)
  usageExamples?: string[];

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class ListGlossaryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Matches English and Kinyarwanda terms, synonyms and descriptions',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cropId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  topicId?: string;

  @ApiPropertyOptional({
    enum: RecordStatus,
    description: 'Admin only; other users see active terms',
  })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class GlossaryTermResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() termEn: string;
  @ApiProperty() termRw: string;
  @ApiPropertyOptional({ type: String, nullable: true }) descriptionEn: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) descriptionRw: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) cropId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) topicId: string | null;
  @ApiProperty({ type: String, isArray: true }) synonymsEn: string[];
  @ApiProperty({ type: String, isArray: true }) synonymsRw: string[];
  @ApiProperty({ type: String, isArray: true }) usageExamples: string[];
  @ApiProperty({ enum: RecordStatus }) status: RecordStatus;
  @ApiProperty({ format: 'uuid' }) createdById: string;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) updatedById: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class GlossaryListResponseDto {
  @ApiProperty({ type: GlossaryTermResponseDto, isArray: true }) data: GlossaryTermResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}
