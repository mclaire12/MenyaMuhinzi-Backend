import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type HealthStatus = 'ok' | 'error';
export type DependencyStatus = 'up' | 'down';

export class DependencyHealthDto {
  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  status: DependencyStatus;

  @ApiProperty({ example: 3, description: 'Round-trip time of the check in milliseconds' })
  latencyMs: number;

  @ApiPropertyOptional({ example: 'connect ECONNREFUSED 127.0.0.1:5432' })
  error?: string;
}

export class HealthChecksDto {
  @ApiProperty({ type: DependencyHealthDto })
  database: DependencyHealthDto;

  @ApiProperty({ type: DependencyHealthDto })
  redis: DependencyHealthDto;
}

export class LivenessResponseDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status: 'ok';

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 42.1, description: 'Process uptime in seconds' })
  uptimeSeconds: number;
}

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status: HealthStatus;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 42.1, description: 'Process uptime in seconds' })
  uptimeSeconds: number;

  @ApiProperty({ type: HealthChecksDto })
  checks: HealthChecksDto;
}
