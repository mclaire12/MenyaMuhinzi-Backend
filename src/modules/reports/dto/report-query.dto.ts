import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsOptional, IsUUID, MaxLength } from 'class-validator';
import { Trim } from '../../../common/validation/validators';
import {
  FarmerCategory,
  FarmerType,
  LearningChannel,
  NotificationChannel,
  NotificationDeliveryStatus,
  Province,
} from '../../../generated/prisma/client';

/**
 * Shared filters. `startDate` is inclusive; `endDate` is exclusive (UTC).
 * Example: startDate=2026-01-01T00:00:00.000Z&endDate=2026-02-01T00:00:00.000Z covers January.
 */
export class ReportDateRangeDto {
  @ApiPropertyOptional({
    description: 'Inclusive lower bound (UTC). Counts events at or after this instant.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @ApiPropertyOptional({
    description: 'Exclusive upper bound (UTC). Counts events strictly before this instant.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;
}

export class ReportFilterQueryDto extends ReportDateRangeDto {
  @ApiPropertyOptional({ enum: Province })
  @IsOptional()
  @IsEnum(Province)
  province?: Province;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @MaxLength(100)
  district?: string;

  @ApiPropertyOptional({ enum: FarmerType })
  @IsOptional()
  @IsEnum(FarmerType)
  farmerType?: FarmerType;

  @ApiPropertyOptional({ enum: FarmerCategory })
  @IsOptional()
  @IsEnum(FarmerCategory)
  farmerCategory?: FarmerCategory;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  facilitatorId?: string;

  @ApiPropertyOptional({ enum: LearningChannel })
  @IsOptional()
  @IsEnum(LearningChannel)
  channel?: LearningChannel;

  @ApiPropertyOptional({ enum: NotificationChannel })
  @IsOptional()
  @IsEnum(NotificationChannel)
  notificationChannel?: NotificationChannel;

  @ApiPropertyOptional({ enum: NotificationDeliveryStatus })
  @IsOptional()
  @IsEnum(NotificationDeliveryStatus)
  deliveryStatus?: NotificationDeliveryStatus;

  @ApiPropertyOptional({
    enum: ['json', 'csv'],
    default: 'json',
    description: 'csv is only accepted on endpoints that document export support',
  })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv' = 'json';
}
