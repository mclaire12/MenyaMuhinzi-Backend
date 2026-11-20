import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Uniform error envelope returned by every endpoint.
 */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: ['email must be an email'],
  })
  message: string | string[];

  @ApiProperty({ example: '/api/v1/health' })
  path: string;

  @ApiProperty({ example: 'GET' })
  method: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiPropertyOptional({ example: '4f1c2a0e-7c1b-4b8e-9d3a-0f1e2d3c4b5a' })
  requestId?: string;
}
