import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { RecordStatus } from '../../../generated/prisma/client';
import { Trim } from '../../../common/validation/validators';

export class ListCropsQueryDto {
  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class CreateCropDto {
  @ApiProperty({ example: 'ONION', description: 'Stable uppercase code. Cannot be changed later.' })
  @Trim()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/, { message: 'code must be uppercase letters, digits or underscores' })
  code: string;

  @ApiProperty({ example: 'Onions' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameEn: string;

  @ApiProperty({ example: 'Ibitunguru' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameRw: string;

  @ApiPropertyOptional({ example: 'Onion production, from nursery to curing.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateCropDto {
  @ApiPropertyOptional({ example: 'Onions' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameEn?: string;

  @ApiPropertyOptional({ example: 'Ibitunguru' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameRw?: string;

  @ApiPropertyOptional({ nullable: true, description: 'null clears the description' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class CropResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'TOMATO' })
  code: string;

  @ApiProperty({ example: 'Tomatoes' })
  nameEn: string;

  @ApiProperty({ example: 'Inyanya' })
  nameRw: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ enum: RecordStatus })
  status: RecordStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class CropSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'TOMATO' })
  code: string;

  @ApiProperty({ example: 'Tomatoes' })
  nameEn: string;

  @ApiProperty({ example: 'Inyanya' })
  nameRw: string;
}
