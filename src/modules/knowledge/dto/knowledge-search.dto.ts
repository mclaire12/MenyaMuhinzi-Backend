import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  IsNotEmpty,
  IsString,
} from 'class-validator';
import { PaginationMetaDto } from '../../../common/dto/pagination.dto';
import { Trim } from '../../../common/validation/validators';
import {
  KnowledgeChunkResponseDto,
  ListKnowledgeSourcesQueryDto,
  KnowledgeSourceResponseDto,
} from './knowledge-source.dto';

export const SearchMode = {
  Metadata: 'metadata',
  Semantic: 'semantic',
} as const;
export type SearchMode = (typeof SearchMode)[keyof typeof SearchMode];

export class KnowledgeSearchQueryDto extends ListKnowledgeSourcesQueryDto {
  @ApiPropertyOptional({
    enum: Object.values(SearchMode),
    default: SearchMode.Metadata,
    description:
      'metadata: filters sources by title, crop, topic, language, type, status and publication date. semantic: vector search over approved chunks; returns 501 until an embedding provider and vector store are configured.',
  })
  @IsOptional()
  @IsEnum(SearchMode)
  mode: SearchMode = SearchMode.Metadata;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 50,
    default: 10,
    description: 'Semantic mode: number of chunks',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topK: number = 10;

  @ValidateIf((dto: KnowledgeSearchQueryDto) => dto.mode === SearchMode.Semantic)
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'q is required for semantic search' })
  @MaxLength(200)
  declare q?: string;
}

export class SemanticMatchDto {
  @ApiProperty() score: number;
  @ApiProperty({ type: KnowledgeChunkResponseDto }) chunk: KnowledgeChunkResponseDto;
}

export class KnowledgeSearchResponseDto {
  @ApiProperty({ enum: Object.values(SearchMode) }) mode: SearchMode;
  @ApiPropertyOptional({
    type: KnowledgeSourceResponseDto,
    isArray: true,
    description: 'Metadata mode',
  })
  data?: KnowledgeSourceResponseDto[];
  @ApiPropertyOptional({ type: PaginationMetaDto }) meta?: PaginationMetaDto;
  @ApiPropertyOptional({ type: SemanticMatchDto, isArray: true, description: 'Semantic mode' })
  matches?: SemanticMatchDto[];
}
