import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { TelephonySessionStatus } from '../../../generated/prisma/client';

export class IvrCallbackDto {
  @ApiPropertyOptional({ description: 'Stable provider callback id for retry idempotency.' })
  @IsOptional()
  @IsString()
  callbackId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  sessionId: string;

  @ApiProperty({ example: '+250788123456' })
  @IsString()
  phoneNumber: string;

  @ApiProperty({ example: '1', description: 'DTMF digits collected on this callback.' })
  @IsString()
  digits: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  callSid?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  providerId?: string;
}

export class ListIvrSessionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TelephonySessionStatus })
  @IsOptional()
  @IsEnum(TelephonySessionStatus)
  status?: TelephonySessionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

export class PatchIvrConfigurationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({ example: '+250800000000' })
  @IsOptional()
  @IsString()
  accessNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(7200)
  sessionTtlSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  menuVersion?: string;
}

export class IvrAnalyticsResponseDto {
  @ApiProperty()
  totalSessions: number;

  @ApiProperty()
  activeSessions: number;

  @ApiProperty()
  audioUnavailableCallbacks: number;
}
