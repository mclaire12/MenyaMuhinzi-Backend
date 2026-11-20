import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsUUID, ValidateIf } from 'class-validator';
import { PublicationScope } from '../../../generated/prisma/client';
import { UserRefDto } from '../../groups/dto/admin-group.dto';

export class PublishCourseDto {
  @ApiProperty({
    enum: PublicationScope,
    example: PublicationScope.TARGETED,
    description: 'PLATFORM reaches every farmer group. TARGETED reaches the selected targeting groups.',
  })
  @IsEnum(PublicationScope)
  scope: PublicationScope;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Required when scope is TARGETED. Active administrator targeting groups.',
  })
  @ValidateIf((dto: PublishCourseDto) => dto.scope === PublicationScope.TARGETED)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  targetingGroupIds?: string[];
}

export class PublicationTargetDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Musanze tomato growers' })
  name: string;
}

export class CoursePublicationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  courseId: string;

  @ApiProperty({ enum: PublicationScope })
  scope: PublicationScope;

  @ApiProperty({ description: 'False once the course was unpublished or archived' })
  isCurrent: boolean;

  @ApiProperty()
  publishedAt: Date;

  @ApiPropertyOptional({ nullable: true, type: Date })
  unpublishedAt: Date | null;

  @ApiProperty({ type: UserRefDto })
  publishedBy: UserRefDto;

  @ApiPropertyOptional({ type: UserRefDto, nullable: true })
  unpublishedBy: UserRefDto | null;

  @ApiProperty({ type: PublicationTargetDto, isArray: true })
  targetingGroups: PublicationTargetDto[];
}
