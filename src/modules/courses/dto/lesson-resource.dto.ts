import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Trim } from '../../../common/validation/validators';
import { Language, ResourceType } from '../../../generated/prisma/client';

export class CreateLessonResourceDto {
  @ApiProperty({ enum: ResourceType })
  @IsEnum(ResourceType)
  resourceType: ResourceType;

  @ApiProperty({
    example: 'media/lessons/nursery.mp4',
    description: 'Storage key or external URL. The file itself is not stored in PostgreSQL.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  contentRef: string;

  @ApiProperty({ example: 'Nursery walkthrough', maxLength: 200 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: Language, default: Language.rw })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({ minimum: 0, description: 'Appended at the end when omitted' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Bytes, when known' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  fileSizeBytes?: number;

  @ApiPropertyOptional({ example: 'video/mp4' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  mimeType?: string;
}

export class UpdateLessonResourceDto {
  @ApiPropertyOptional({ enum: ResourceType })
  @IsOptional()
  @IsEnum(ResourceType)
  resourceType?: ResourceType;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  contentRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  fileSizeBytes?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  mimeType?: string | null;
}

export class LessonResourceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  lessonId: string;

  @ApiProperty({ enum: ResourceType })
  resourceType: ResourceType;

  @ApiProperty()
  contentRef: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ enum: Language })
  language: Language;

  @ApiProperty()
  displayOrder: number;

  @ApiPropertyOptional({ nullable: true, type: Number })
  fileSizeBytes: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  mimeType: string | null;

  @ApiProperty()
  createdAt: Date;
}
