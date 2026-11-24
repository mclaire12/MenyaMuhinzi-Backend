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

export class UssdCallbackDto {
  @ApiPropertyOptional({ description: 'Stable provider callback id for retry idempotency.' })
  @IsOptional()
  @IsString()
  callbackId?: string;

  @ApiProperty({ example: 'test-session-1' })
  @IsString()
  @MinLength(1)
  sessionId: string;

  @ApiProperty({ example: '+250788123456' })
  @IsString()
  phoneNumber: string;

  @ApiProperty({ example: '', description: 'Accumulated user input (empty on first dial).' })
  @IsString()
  text: string;

  @ApiPropertyOptional({ example: '*123#' })
  @IsOptional()
  @IsString()
  serviceCode?: string;

  @ApiPropertyOptional({ description: 'Gateway provider id when several are registered.' })
  @IsOptional()
  @IsString()
  providerId?: string;
}

export class ListUssdSessionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TelephonySessionStatus })
  @IsOptional()
  @IsEnum(TelephonySessionStatus)
  status?: TelephonySessionStatus;

  @ApiPropertyOptional({ example: '+250788123456' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

export class PatchUssdConfigurationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({ example: '*123#' })
  @IsOptional()
  @IsString()
  serviceCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3600)
  sessionTtlSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(500)
  maxScreenChars?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  menuVersion?: string;
}

export class UssdAnalyticsResponseDto {
  @ApiProperty()
  totalSessions: number;

  @ApiProperty()
  activeSessions: number;

  @ApiProperty()
  endedSessions: number;

  @ApiProperty()
  expiredSessions: number;

  @ApiProperty()
  testSessions: number;
}
