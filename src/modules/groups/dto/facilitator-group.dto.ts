import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNotEmptyObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { FarmerLocationDto, LocationResponseDto } from '../../../common/dto/location.dto';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Trim } from '../../../common/validation/validators';
import { FarmerType, Province, RecordStatus, UserStatus } from '../../../generated/prisma/client';
import { CourseStatus, Language } from '../../../generated/prisma/client';
import { CropSummaryDto } from '../../crops/dto/crop.dto';
import { UserRefDto } from './admin-group.dto';

export class CreateFacilitatorGroupDto {
  @ApiProperty({ example: 'Kinigi tomato group', maxLength: 150 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ example: 'Weekly follow-up group for Kinigi tomato farmers' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  cropId: string;

  @ApiProperty({ type: FarmerLocationDto })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => FarmerLocationDto)
  location: FarmerLocationDto;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Required when an administrator creates the group. Facilitators are assigned to themselves.',
  })
  @IsOptional()
  @IsUUID()
  facilitatorId?: string;
}

export class UpdateFacilitatorGroupDto {
  @ApiPropertyOptional({ example: 'Kinigi tomato group' })
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

  @ApiPropertyOptional({ type: FarmerLocationDto, description: 'Replaces the whole location' })
  @IsOptional()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => FarmerLocationDto)
  location?: FarmerLocationDto;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Reassigns the group. Administrators only.',
  })
  @IsOptional()
  @IsUUID()
  facilitatorId?: string;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class ListFacilitatorGroupsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'kinigi' })
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

  @ApiPropertyOptional({ format: 'uuid', description: 'Administrators can filter by facilitator' })
  @IsOptional()
  @IsUUID()
  facilitatorId?: string;
}

export class FacilitatorGroupResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Kinigi tomato group' })
  name: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ type: UserRefDto })
  facilitator: UserRefDto;

  @ApiProperty({ type: CropSummaryDto })
  crop: CropSummaryDto;

  @ApiProperty({ type: LocationResponseDto })
  location: LocationResponseDto;

  @ApiProperty({ enum: RecordStatus })
  status: RecordStatus;

  @ApiProperty({ example: 12, description: 'Registered farmers currently in the group' })
  memberCount: number;

  @ApiProperty({ type: UserRefDto })
  createdBy: UserRefDto;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class FacilitatorGroupListResponseDto {
  @ApiProperty({ type: FacilitatorGroupResponseDto, isArray: true })
  data: FacilitatorGroupResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

export class AddGroupMembersDto {
  @ApiProperty({ type: [String], format: 'uuid', description: 'User ids of active farmers' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  userIds: string[];
}

export class ListGroupMembersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches name, phone number or email' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: FarmerType })
  @IsOptional()
  @IsEnum(FarmerType)
  farmerType?: FarmerType;
}

export class GroupMemberResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ example: 'Uwimana Jeanne' })
  fullName: string;

  @ApiProperty({ example: '+250788123456' })
  phoneNumber: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  email: string | null;

  @ApiProperty({ enum: FarmerType })
  farmerType: FarmerType;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiProperty()
  addedAt: Date;
}

export class GroupMemberListResponseDto {
  @ApiProperty({ type: GroupMemberResponseDto, isArray: true })
  data: GroupMemberResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

export class AssignGroupCourseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  courseId: string;
}

export class GroupCourseSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Tomato nursery management' })
  title: string;

  @ApiProperty({ enum: CourseStatus })
  status: CourseStatus;

  @ApiProperty({ enum: Language })
  language: Language;

  @ApiProperty({ type: CropSummaryDto })
  crop: CropSummaryDto;
}

export class GroupCourseResponseDto {
  @ApiProperty({ type: GroupCourseSummaryDto })
  course: GroupCourseSummaryDto;

  @ApiProperty()
  assignedAt: Date;

  @ApiProperty({ type: UserRefDto })
  assignedBy: UserRefDto;
}
