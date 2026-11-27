import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Trim } from '../../../common/validation/validators';
import {
  CourseCategory,
  CourseGenerationScope,
  CourseGenerationStatus,
  DifficultyLevel,
  Language,
  LearningFormat,
  TargetAudience,
} from '../../../generated/prisma/client';

export const MAX_CHAPTERS = 20;
export const MAX_SUB_CHAPTERS = 30;

export class SubChapterOutlineDto {
  @ApiProperty({ example: 'Choosing a nursery site', maxLength: 200 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 'Shade, water access and drainage', maxLength: 2000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class ChapterOutlineDto {
  @ApiProperty({ example: 'Preparing the nursery', maxLength: 200 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ type: SubChapterOutlineDto, isArray: true, minItems: 1, maxItems: MAX_SUB_CHAPTERS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SUB_CHAPTERS)
  @ValidateNested({ each: true })
  @Type(() => SubChapterOutlineDto)
  subChapters: SubChapterOutlineDto[];
}

/**
 * A course designed by an administrator or a facilitator and written by the AI model.
 * Facilitator courses are later published to one or more of their own groups only. The structure is fixed by the requester: chapters and their
 * sub-chapters. Each sub-chapter is offered in the requested learning formats.
 */
export class CreateCourseGenerationDto {
  @ApiProperty({ example: 'Tomato nursery management', maxLength: 200 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Raise healthy tomato seedlings.', maxLength: 500 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  shortDescription: string;

  @ApiProperty({
    example: 'Smallholders in Musanze; focus on low-cost practices and local seed varieties.',
    maxLength: 10_000,
    description: 'Instructions for the model: goals, audience details, practices to cover or avoid',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  brief: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  cropId: string;

  @ApiProperty({ enum: CourseCategory })
  @IsEnum(CourseCategory)
  category: CourseCategory;

  @ApiProperty({ enum: TargetAudience })
  @IsEnum(TargetAudience)
  targetAudience: TargetAudience;

  @ApiProperty({ enum: DifficultyLevel })
  @IsEnum(DifficultyLevel)
  difficulty: DifficultyLevel;

  @ApiPropertyOptional({ enum: Language, default: Language.rw })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiProperty({ type: String, isArray: true, minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(300, { each: true })
  learningObjectives: string[];

  @ApiProperty({ example: 120, minimum: 1, maximum: 100_000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  estimatedDurationMinutes: number;

  @ApiProperty({ type: ChapterOutlineDto, isArray: true, minItems: 1, maxItems: MAX_CHAPTERS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CHAPTERS)
  @ValidateNested({ each: true })
  @Type(() => ChapterOutlineDto)
  chapters: ChapterOutlineDto[];

  @ApiProperty({
    enum: LearningFormat,
    isArray: true,
    description: 'How farmers can study each sub-chapter. TEXT is always included.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(LearningFormat, { each: true })
  contentFormats: LearningFormat[];

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    format: 'uuid',
    description: 'Approved Knowledge Base sources the model must draw on (in addition to its training)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  knowledgeSourceIds?: string[];
}

export class ListCourseGenerationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CourseGenerationStatus })
  @IsOptional()
  @IsEnum(CourseGenerationStatus)
  status?: CourseGenerationStatus;

  @ApiPropertyOptional({ enum: CourseGenerationScope })
  @IsOptional()
  @IsEnum(CourseGenerationScope)
  scope?: CourseGenerationScope;
}

class SourceRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
}

export class CourseGenerationResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: CourseGenerationScope }) scope: CourseGenerationScope;
  @ApiProperty({ enum: CourseGenerationStatus }) status: CourseGenerationStatus;
  @ApiPropertyOptional({ type: String, nullable: true }) statusMessage: string | null;
  @ApiProperty() brief: string;
  @ApiProperty({ type: ChapterOutlineDto, isArray: true }) chapters: ChapterOutlineDto[];
  @ApiProperty({ enum: LearningFormat, isArray: true }) contentFormats: LearningFormat[];
  @ApiProperty({ type: SourceRefDto, isArray: true }) knowledgeSources: SourceRefDto[];
  @ApiProperty() course: { id: string; title: string; status: string };
  @ApiProperty() requestedBy: { id: string; fullName: string };
  @ApiPropertyOptional({ type: Date, nullable: true }) startedAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) completedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class CourseGenerationListResponseDto {
  @ApiProperty({ type: CourseGenerationResponseDto, isArray: true }) data: CourseGenerationResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}
