import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../../common/validation/validators';
import { RecordStatus, VectorDistanceMetric } from '../../../generated/prisma/client';

export class CreateEmbeddingConfigurationDto {
  @ApiProperty({ maxLength: 150, example: 'Multilingual small' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiProperty({
    maxLength: 100,
    example: 'local',
    description: 'Id of the EmbeddingProvider that will produce vectors',
  })
  @Trim()
  @Matches(/^[a-z0-9][a-z0-9._-]{0,99}$/, { message: 'provider must be a lower-case identifier' })
  provider: string;

  @ApiProperty({ maxLength: 200, example: 'multilingual-e5-small' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  model: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  modelVersion?: string;

  @ApiProperty({ minimum: 1, maximum: 8192, example: 384 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8192)
  dimensions: number;

  @ApiPropertyOptional({ enum: VectorDistanceMetric, default: VectorDistanceMetric.COSINE })
  @IsOptional()
  @IsEnum(VectorDistanceMetric)
  distanceMetric?: VectorDistanceMetric;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Provider settings. Never put API keys here.',
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class EmbeddingConfigurationResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() provider: string;
  @ApiProperty() model: string;
  @ApiPropertyOptional({ type: String, nullable: true }) modelVersion: string | null;
  @ApiProperty() dimensions: number;
  @ApiProperty({ enum: VectorDistanceMetric }) distanceMetric: VectorDistanceMetric;
  @ApiProperty({ description: 'Increases for each configuration of the same provider and model' })
  version: number;
  @ApiProperty({ enum: RecordStatus }) status: RecordStatus;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  settings: unknown;
  @ApiProperty({
    description: 'Whether a provider with this id is registered in the running application',
  })
  providerAvailable: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
