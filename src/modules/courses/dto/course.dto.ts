import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Trim } from '../../../common/validation/validators';
import {
  CourseCategory,
  CourseStatus,
  DifficultyLevel,
  Language,
  TargetAudience,
} from '../../../generated/prisma/client';
import { CropSummaryDto } from '../../crops/dto/crop.dto';
import { UserRefDto } from '../../groups/dto/admin-group.dto';

const trimList = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item.trim() : item)) : value;

/** Status values a client may set. PUBLISHED is only reached through the publish endpoint. */
export const COURSE_OWNERSHIP = ['GROUP', 'PLATFORM'] as const;

export const SETTABLE_COURSE_STATUSES = [CourseStatus.DRAFT, CourseStatus.UNDER_REVIEW, CourseStatus.ARCHIVED] as const;

export class CreateCourseDto {
  @ApiProperty({ example: 'Tomato nursery management', maxLength: 200 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Raise healthy tomato seedlings before transplanting.', maxLength: 500 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  shortDescription: string;

  @ApiProperty({ example: 'Covers nursery site selection, sowing depth, watering and hardening off.' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  detailedDescription: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  cropId: string;

  @ApiProperty({ enum: CourseCategory, example: CourseCategory.CROP_PRODUCTION })
  @IsEnum(CourseCategory)
  category: CourseCategory;

  @ApiProperty({ enum: TargetAudience, example: TargetAudience.ALL_FARMERS })
  @IsEnum(TargetAudience)
  targetAudience: TargetAudience;

  @ApiProperty({ enum: DifficultyLevel, example: DifficultyLevel.BEGINNER })
  @IsEnum(DifficultyLevel)
  difficulty: DifficultyLevel;

  @ApiProperty({ example: ['Prepare a nursery bed', 'Transplant at the right stage'], maxItems: 20 })
  @Transform(trimList)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(300, { each: true })
  learningObjectives: string[];

  @ApiProperty({ example: 90, description: 'Minutes', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  estimatedDurationMinutes: number;

  @ApiPropertyOptional({ enum: Language, default: Language.rw })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({ example: 'media/covers/tomato-nursery.jpg', description: 'Cover image reference' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  coverImageRef?: string;
}

export class UpdateCourseDto {
  @ApiPropertyOptional({ example: 'Tomato nursery management' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  shortDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  detailedDescription?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cropId?: string;

  @ApiPropertyOptional({ enum: CourseCategory })
  @IsOptional()
  @IsEnum(CourseCategory)
  category?: CourseCategory;

  @ApiPropertyOptional({ enum: TargetAudience })
  @IsOptional()
  @IsEnum(TargetAudience)
  targetAudience?: TargetAudience;

  @ApiPropertyOptional({ enum: DifficultyLevel })
  @IsOptional()
  @IsEnum(DifficultyLevel)
  difficulty?: DifficultyLevel;

  @ApiPropertyOptional({ maxItems: 20, description: 'Replaces the whole list' })
  @IsOptional()
  @Transform(trimList)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(300, { each: true })
  learningObjectives?: string[];

  @ApiPropertyOptional({ minimum: 1, description: 'Minutes' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  estimatedDurationMinutes?: number;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({ nullable: true, description: 'null removes the cover reference' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  coverImageRef?: string | null;

  @ApiPropertyOptional({
    enum: SETTABLE_COURSE_STATUSES,
    description: 'ARCHIVED closes a current publication. Publishing uses POST /courses/:id/publish.',
  })
  @IsOptional()
  @IsIn(SETTABLE_COURSE_STATUSES)
  status?: (typeof SETTABLE_COURSE_STATUSES)[number];
}

export class ListCoursesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'nursery' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: CourseStatus,
    description: 'Administrators and facilitators (their own group courses can be drafts). Farmers only see published courses.',
  })
  @IsOptional()
  @IsEnum(CourseStatus)
  status?: CourseStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cropId?: string;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({ enum: CourseCategory })
  @IsOptional()
  @IsEnum(CourseCategory)
  category?: CourseCategory;

  @ApiPropertyOptional({ enum: DifficultyLevel })
  @IsOptional()
  @IsEnum(DifficultyLevel)
  difficulty?: DifficultyLevel;

  @ApiPropertyOptional({
    enum: COURSE_OWNERSHIP,
    description: 'GROUP: facilitator group courses only; PLATFORM: platform courses only',
  })
  @IsOptional()
  @IsIn(COURSE_OWNERSHIP)
  ownership?: (typeof COURSE_OWNERSHIP)[number];
}

export class PublishToGroupsDto {
  @ApiProperty({ type: String, isArray: true, format: 'uuid', minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  groupIds: string[];
}

export class CourseResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Tomato nursery management' })
  title: string;

  @ApiProperty()
  shortDescription: string;

  @ApiProperty()
  detailedDescription: string;

  @ApiProperty({ type: CropSummaryDto })
  crop: CropSummaryDto;

  @ApiProperty({ enum: CourseCategory })
  category: CourseCategory;

  @ApiProperty({ enum: TargetAudience })
  targetAudience: TargetAudience;

  @ApiProperty({ enum: DifficultyLevel })
  difficulty: DifficultyLevel;

  @ApiProperty({ isArray: true, type: String })
  learningObjectives: string[];

  @ApiProperty({ example: 90 })
  estimatedDurationMinutes: number;

  @ApiProperty({ enum: Language })
  language: Language;

  @ApiPropertyOptional({ nullable: true, type: String })
  coverImageRef: string | null;

  @ApiProperty({ enum: CourseStatus })
  status: CourseStatus;

  @ApiPropertyOptional({ nullable: true, type: Date })
  publishedAt: Date | null;

  @ApiProperty({ type: UserRefDto })
  createdBy: UserRefDto;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Set for courses a facilitator generated; they are published to that facilitator\'s groups only',
  })
  facilitatorOwner: { id: string; fullName: string } | null;

  @ApiProperty({
    description: 'Groups a facilitator course is published to (administrators and the owner only)',
    isArray: true,
  })
  sharedWithGroups: { id: string; name: string }[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'The AI generation request that produced this course',
  })
  generation: { id: string; status: string } | null;
}

export class CourseListResponseDto {
  @ApiProperty({ type: CourseResponseDto, isArray: true })
  data: CourseResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
