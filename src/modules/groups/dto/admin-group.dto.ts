import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNotEmptyObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TargetingLocationDto } from '../../../common/dto/location.dto';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Trim } from '../../../common/validation/validators';
import { Province, RecordStatus, TargetAudience } from '../../../generated/prisma/client';
import { CropSummaryDto } from '../../crops/dto/crop.dto';

export class UserRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'MenyaMuhinzi Administrator' })
  fullName: string;
}

export class CreateAdminGroupDto {
  @ApiProperty({ example: 'Musanze tomato growers', maxLength: 150 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ example: 'Smallholders growing tomatoes in Musanze district' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  cropId: string;

  @ApiProperty({ enum: TargetAudience, example: TargetAudience.ALL_FARMERS })
  @IsEnum(TargetAudience)
  targetAudience: TargetAudience;

  @ApiProperty({ type: TargetingLocationDto, description: 'Sector is optional and limits the group to one sector' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => TargetingLocationDto)
  location: TargetingLocationDto;

  @ApiPropertyOptional({ example: 1200, minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  estimatedFarmerCount?: number;
}

export class UpdateAdminGroupDto {
  @ApiPropertyOptional({ example: 'Musanze tomato growers' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ nullable: true, description: 'null clears the description' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cropId?: string;

  @ApiPropertyOptional({ enum: TargetAudience })
  @IsOptional()
  @IsEnum(TargetAudience)
  targetAudience?: TargetAudience;

  @ApiPropertyOptional({ type: TargetingLocationDto, description: 'Replaces province, district and sector' })
  @IsOptional()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => TargetingLocationDto)
  location?: TargetingLocationDto;

  @ApiPropertyOptional({ example: 1500, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  estimatedFarmerCount?: number;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class ListAdminGroupsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'tomato' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;

  @ApiPropertyOptional({ enum: Province })
  @IsOptional()
  @IsEnum(Province)
  province?: Province;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cropId?: string;
}

export class AdminGroupResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Musanze tomato growers' })
  name: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ type: CropSummaryDto })
  crop: CropSummaryDto;

  @ApiProperty({ enum: TargetAudience })
  targetAudience: TargetAudience;

  @ApiProperty({ enum: Province })
  province: Province;

  @ApiProperty({ example: 'Musanze' })
  district: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'Muhoza' })
  sector: string | null;

  @ApiProperty({ example: 1200, description: 'Estimate only. These groups have no member list.' })
  estimatedFarmerCount: number;

  @ApiProperty({ enum: RecordStatus })
  status: RecordStatus;

  @ApiProperty({ type: UserRefDto })
  createdBy: UserRefDto;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class AdminGroupListResponseDto {
  @ApiProperty({ type: AdminGroupResponseDto, isArray: true })
  data: AdminGroupResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
