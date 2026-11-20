import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Trim } from '../../../common/validation/validators';
import { CourseStatus, EnrollmentStatus, Language } from '../../../generated/prisma/client';

export class ListEnrollmentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiPropertyOptional({ enum: EnrollmentStatus })
  @IsOptional()
  @IsEnum(EnrollmentStatus)
  status?: EnrollmentStatus;
}

export class UpdateEnrollmentStatusDto {
  @ApiProperty({ enum: EnrollmentStatus })
  @IsEnum(EnrollmentStatus)
  status: EnrollmentStatus;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class EnrollmentEventDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({ enum: EnrollmentStatus, nullable: true })
  fromStatus: EnrollmentStatus | null;

  @ApiProperty({ enum: EnrollmentStatus })
  toStatus: EnrollmentStatus;

  @ApiPropertyOptional({ nullable: true, type: String })
  reason: string | null;

  @ApiProperty({ format: 'uuid' })
  actorId: string;

  @ApiProperty()
  createdAt: Date;
}

export class EnrollmentCourseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: Language })
  language: Language;

  @ApiProperty()
  estimatedDurationMinutes: number;

  @ApiProperty({ enum: CourseStatus })
  status: CourseStatus;
}

export class EnrollmentUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  fullName: string;
}

export class EnrollmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ format: 'uuid' })
  courseId: string;

  @ApiProperty({ enum: EnrollmentStatus })
  status: EnrollmentStatus;

  @ApiProperty()
  enrolledAt: Date;

  @ApiPropertyOptional({ nullable: true, type: Date })
  completedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  withdrawnAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  suspendedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  statusReason: string | null;

  @ApiProperty({ type: EnrollmentUserDto })
  user: EnrollmentUserDto;

  @ApiProperty({ type: EnrollmentCourseDto })
  course: EnrollmentCourseDto;

  @ApiPropertyOptional({ type: EnrollmentEventDto, isArray: true })
  events?: EnrollmentEventDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class EnrollmentListResponseDto {
  @ApiProperty({ type: EnrollmentResponseDto, isArray: true })
  data: EnrollmentResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
