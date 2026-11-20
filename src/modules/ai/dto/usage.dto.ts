import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { AiUsageStatus } from '../../../generated/prisma/client';

export class UsageFilterQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assistantId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  modelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[a-z0-9][a-z0-9._-]{0,99}$/)
  provider?: string;

  @ApiPropertyOptional({ enum: AiUsageStatus })
  @IsOptional()
  @IsEnum(AiUsageStatus)
  status?: AiUsageStatus;

  @ApiPropertyOptional({ description: 'Recorded at or after' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'Recorded before' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class UsageRecordResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) requestId: string;
  @ApiProperty({ format: 'uuid' }) assistantId: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  modelConfigurationId: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) modelId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) provider: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Null unless reported' })
  inputTokens: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) outputTokens: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) totalTokens: number | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '0.001200',
    description: 'Decimal string; null unless reported by the provider',
  })
  estimatedCost: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'USD' }) currency: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) durationMs: number | null;
  @ApiProperty({ enum: AiUsageStatus }) status: AiUsageStatus;
  @ApiProperty() recordedAt: Date;
}

export class UsageListResponseDto {
  @ApiProperty({ type: UsageRecordResponseDto, isArray: true }) data: UsageRecordResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

export class UsageCostDto {
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ example: '0.004500' }) amount: string;
}

export class UsageGroupDto {
  @ApiProperty({ description: 'Assistant id or provider identifier' }) key: string;
  @ApiProperty() records: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) totalTokens: number | null;
}

export class UsageSummaryResponseDto {
  @ApiProperty() records: number;
  @ApiProperty({ description: 'Records with provider-reported figures' }) recorded: number;
  @ApiProperty({ description: 'Records without usage figures' }) notAvailable: number;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Sum of reported values; null when none were reported',
  })
  inputTokens: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) outputTokens: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) totalTokens: number | null;
  @ApiProperty({ type: UsageCostDto, isArray: true, description: 'Reported cost per currency' })
  costs: UsageCostDto[];
  @ApiProperty({ type: UsageGroupDto, isArray: true }) byAssistant: UsageGroupDto[];
  @ApiProperty({ type: UsageGroupDto, isArray: true }) byProvider: UsageGroupDto[];
}
