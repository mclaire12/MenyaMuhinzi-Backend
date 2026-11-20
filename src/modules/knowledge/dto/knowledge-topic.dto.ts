import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../../common/validation/validators';
import { RecordStatus } from '../../../generated/prisma/client';

export class CreateKnowledgeTopicDto {
  @ApiProperty({
    example: 'SOIL_TESTING',
    description: 'Upper-case letters, digits and underscores',
  })
  @Trim()
  @Matches(/^[A-Z][A-Z0-9_]{1,59}$/, {
    message: 'code must be 2-60 upper-case letters, digits or underscores',
  })
  code: string;

  @ApiProperty({ maxLength: 150, example: 'Soil testing' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nameEn: string;

  @ApiPropertyOptional({
    maxLength: 150,
    description: 'Kinyarwanda name, entered by an administrator',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nameRw?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    description: 'Words that suggest this topic during processing',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(100, { each: true })
  keywords?: string[];
}

export class UpdateKnowledgeTopicDto {
  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nameEn?: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nameRw?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(100, { each: true })
  keywords?: string[];

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class ListKnowledgeTopicsQueryDto {
  @ApiPropertyOptional({
    enum: RecordStatus,
    description: 'Admin only; other users see active topics',
  })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class KnowledgeTopicResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() code: string;
  @ApiProperty() nameEn: string;
  @ApiPropertyOptional({ type: String, nullable: true }) nameRw: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: String, isArray: true }) keywords: string[];
  @ApiProperty({ enum: RecordStatus }) status: RecordStatus;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
