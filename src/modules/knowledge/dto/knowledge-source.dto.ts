import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Trim } from '../../../common/validation/validators';
import {
  KnowledgeHistoryEvent,
  KnowledgeJobStatus,
  KnowledgeReviewAction,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
  KnowledgeStage,
  KnowledgeStorageKind,
  Language,
} from '../../../generated/prisma/client';

/** Multipart forms send lists as "a,b" or as a JSON array string. */
export const toStringList = ({ value }: { value: unknown }): unknown => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return [];
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return value;
    }
  }
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

class SourceMetadataFields {
  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({
    enum: Language,
    default: Language.rw,
    description: 'Language of the document. Authoritative over detection.',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({ maxLength: 200, example: 'Rwanda Agriculture Board' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  sourceOrganization?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  author?: string;

  @ApiPropertyOptional({ example: '2025-06-01', description: 'ISO date' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString({ strict: true })
  publicationDate?: string;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    format: 'uuid',
    description: 'Crops the source covers. Multipart: comma-separated or JSON array.',
  })
  @IsOptional()
  @Transform(toStringList)
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  cropIds?: string[];

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    format: 'uuid',
    description: 'Topics the source covers. Multipart: comma-separated or JSON array.',
  })
  @IsOptional()
  @Transform(toStringList)
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  topicIds?: string[];
}

class FileReferenceFields {
  @ApiPropertyOptional({
    maxLength: 1000,
    description:
      'Instead of uploading: a key of a file already in knowledge storage (e.g. `uploads/2026/11/<sha256>.pdf`), or an https URL for HTML, WEB_ARTICLE and OTHER sources.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  storageRef?: string;

  @ApiPropertyOptional({
    maxLength: 255,
    description: 'File name for a storage reference. Uploads use the uploaded name.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  originalFilename?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  changeNote?: string;

  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description: 'PDF, DOCX, TXT or HTML file (multipart only)',
  })
  @IsOptional()
  file?: unknown;
}

export class CreateKnowledgeSourceDto extends SourceMetadataFields {
  @ApiProperty({ maxLength: 300, example: 'Tomato irrigation guide' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title: string;

  @ApiProperty({ enum: KnowledgeSourceType })
  @IsEnum(KnowledgeSourceType)
  sourceType: KnowledgeSourceType;

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Storage key or https URL. Required when no file is uploaded.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  storageRef?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  originalFilename?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  changeNote?: string;

  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description: 'PDF, DOCX, TXT or HTML file (multipart only)',
  })
  @IsOptional()
  file?: unknown;
}

export class UpdateKnowledgeSourceDto extends SourceMetadataFields {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title?: string;
}

export class AddKnowledgeVersionDto extends FileReferenceFields {}

export class ProcessSourceDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Defaults to the latest version' })
  @IsOptional()
  @IsUUID()
  versionId?: string;
}

export class ApproveSourceDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class RejectSourceDto {
  @ApiProperty({
    maxLength: 2000,
    description: 'Shown to the administrator who submitted the version',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;
}

export class ListKnowledgeSourcesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ maxLength: 200, description: 'Matches title and description' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: KnowledgeSourceType })
  @IsOptional()
  @IsEnum(KnowledgeSourceType)
  sourceType?: KnowledgeSourceType;

  @ApiPropertyOptional({
    enum: KnowledgeSourceStatus,
    description: 'Admin only; other users only see approved knowledge',
  })
  @IsOptional()
  @IsEnum(KnowledgeSourceStatus)
  status?: KnowledgeSourceStatus;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cropId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  topicId?: string;

  @ApiPropertyOptional({ example: '2020-01-01' })
  @IsOptional()
  @IsDateString({ strict: true })
  publishedFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString({ strict: true })
  publishedTo?: string;
}

export class ListChunksQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Admin only. Defaults to the approved version, then the latest.',
  })
  @IsOptional()
  @IsUUID()
  versionId?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class CropTagDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'TOMATO' }) code: string;
  @ApiProperty({ example: 'Tomatoes' }) nameEn: string;
  @ApiProperty({ example: 'Inyanya' }) nameRw: string;
}

export class TopicTagDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'IRRIGATION' }) code: string;
  @ApiProperty({ example: 'Irrigation' }) nameEn: string;
  @ApiPropertyOptional({ type: String, nullable: true }) nameRw: string | null;
}

export class KnowledgeVersionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() versionNumber: number;
  @ApiProperty({ enum: KnowledgeStorageKind }) storageKind: KnowledgeStorageKind;
  @ApiPropertyOptional({ type: String, nullable: true }) originalFilename: string | null;
  @ApiProperty({ description: 'Storage key or external URL' }) storageRef: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) fileSizeBytes: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) mimeType: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) checksumSha256: string | null;
  @ApiProperty({ enum: KnowledgeSourceStatus }) status: KnowledgeSourceStatus;
  @ApiPropertyOptional({ type: String, nullable: true }) processingError: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) changeNote: string | null;
  @ApiProperty({ format: 'uuid' }) createdById: string;
  @ApiPropertyOptional({ type: Date, nullable: true }) submittedAt: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) reviewedById:
    string | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) reviewedAt: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) reviewReason: string | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) processedAt: Date | null;
  @ApiProperty() createdAt: Date;
}

export class KnowledgeSourceResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ enum: KnowledgeSourceType }) sourceType: KnowledgeSourceType;
  @ApiProperty({ enum: Language }) language: Language;
  @ApiPropertyOptional({ type: String, nullable: true }) sourceOrganization: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) author: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: '2025-06-01' }) publicationDate:
    string | null;
  @ApiProperty({
    enum: KnowledgeSourceStatus,
    description: 'Status of the latest version, or ARCHIVED',
  })
  status: KnowledgeSourceStatus;
  @ApiProperty() isActive: boolean;
  @ApiProperty() latestVersionNumber: number;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'uuid',
    description: 'Version used for retrieval',
  })
  approvedVersionId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) approvedById:
    string | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) approvedAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) archivedAt: Date | null;
  @ApiProperty({ format: 'uuid' }) createdById: string;
  @ApiProperty({ type: CropTagDto, isArray: true }) crops: CropTagDto[];
  @ApiProperty({ type: TopicTagDto, isArray: true }) topics: TopicTagDto[];
  @ApiPropertyOptional({ type: KnowledgeVersionDto, nullable: true, description: 'Admin only' })
  latestVersion?: KnowledgeVersionDto | null;
  @ApiPropertyOptional({
    type: KnowledgeVersionDto,
    isArray: true,
    description: 'Admin only; included on detail',
  })
  versions?: KnowledgeVersionDto[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class KnowledgeSourceListResponseDto {
  @ApiProperty({ type: KnowledgeSourceResponseDto, isArray: true })
  data: KnowledgeSourceResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

export class KnowledgeChunkResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) documentId: string;
  @ApiProperty({ format: 'uuid' }) sourceId: string;
  @ApiProperty({ format: 'uuid' }) versionId: string;
  @ApiProperty() chunkIndex: number;
  @ApiProperty() text: string;
  @ApiPropertyOptional({ type: String, nullable: true }) sectionTitle: string | null;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'First page; null for formats without pages',
  })
  pageNumber: number | null;
  @ApiProperty({ enum: Language }) language: Language;
  @ApiProperty({ type: String, isArray: true }) cropCodes: string[];
  @ApiProperty({ type: String, isArray: true }) topicCodes: string[];
  @ApiProperty({
    description: 'headingPath, pageEnd, overlapChars, charCount',
    type: 'object',
    additionalProperties: true,
  })
  metadata: unknown;
  @ApiProperty() status: string;
  @ApiProperty() createdAt: Date;
}

export class KnowledgeChunkListResponseDto {
  @ApiProperty({ type: KnowledgeChunkResponseDto, isArray: true })
  data: KnowledgeChunkResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

export class ProcessingJobDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) versionId: string;
  @ApiProperty({ enum: KnowledgeStage }) stage: KnowledgeStage;
  @ApiProperty({ enum: KnowledgeJobStatus }) status: KnowledgeJobStatus;
  @ApiProperty() runNumber: number;
  @ApiProperty() attempts: number;
  @ApiProperty() maxAttempts: number;
  @ApiPropertyOptional({ type: String, nullable: true }) error: string | null;
  @ApiProperty() queuedAt: Date;
  @ApiPropertyOptional({ type: Date, nullable: true }) startedAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) finishedAt: Date | null;
}

export class DocumentStatsDto {
  @ApiPropertyOptional({ type: Number, nullable: true }) pageCount: number | null;
  @ApiProperty() characterCount: number;
  @ApiProperty() wordCount: number;
  @ApiPropertyOptional({ enum: Language, nullable: true }) detectedLanguage: Language | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) languageConfidence: number | null;
  @ApiProperty({ type: String, isArray: true }) detectedCropCodes: string[];
  @ApiProperty({ type: String, isArray: true }) detectedTopicCodes: string[];
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  extractedMetadata: unknown;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  chunkingOptions: unknown;
  @ApiProperty() extractedAt: Date;
  @ApiPropertyOptional({ type: Date, nullable: true }) normalizedAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) metadataProcessedAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) chunkedAt: Date | null;
}

export class EmbeddingCountsDto {
  @ApiProperty() pending: number;
  @ApiProperty() processing: number;
  @ApiProperty() completed: number;
  @ApiProperty() failed: number;
}

export class ProcessingStatusResponseDto {
  @ApiProperty({ format: 'uuid' }) sourceId: string;
  @ApiProperty({ enum: KnowledgeSourceStatus }) sourceStatus: KnowledgeSourceStatus;
  @ApiProperty({ type: KnowledgeVersionDto }) version: KnowledgeVersionDto;
  @ApiProperty({ type: ProcessingJobDto, isArray: true }) jobs: ProcessingJobDto[];
  @ApiPropertyOptional({ type: DocumentStatsDto, nullable: true })
  document: DocumentStatsDto | null;
  @ApiProperty() chunkCount: number;
  @ApiProperty({ type: EmbeddingCountsDto }) embeddings: EmbeddingCountsDto;
}

export class ProcessResponseDto {
  @ApiProperty({ format: 'uuid' }) versionId: string;
  @ApiProperty({ format: 'uuid' }) jobId: string;
  @ApiProperty({ enum: KnowledgeSourceStatus }) status: KnowledgeSourceStatus;
}

export class ApprovalEntryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) versionId: string | null;
  @ApiProperty({ enum: KnowledgeReviewAction }) action: KnowledgeReviewAction;
  @ApiProperty({ format: 'uuid' }) actorId: string;
  @ApiPropertyOptional({ type: String, nullable: true }) reason: string | null;
  @ApiProperty() createdAt: Date;
}

export class ProcessingHistoryEntryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) versionId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) jobId: string | null;
  @ApiPropertyOptional({ enum: KnowledgeStage, nullable: true }) stage: KnowledgeStage | null;
  @ApiProperty({ enum: KnowledgeHistoryEvent }) event: KnowledgeHistoryEvent;
  @ApiProperty() message: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  details: unknown;
  @ApiProperty() createdAt: Date;
}

export class AuditEntryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) actorId: string | null;
  @ApiProperty() action: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  details: unknown;
  @ApiProperty() createdAt: Date;
}

export class SourceHistoryResponseDto {
  @ApiProperty({ type: KnowledgeVersionDto, isArray: true }) versions: KnowledgeVersionDto[];
  @ApiProperty({ type: ApprovalEntryDto, isArray: true }) approvals: ApprovalEntryDto[];
  @ApiProperty({ type: ProcessingHistoryEntryDto, isArray: true })
  processing: ProcessingHistoryEntryDto[];
  @ApiProperty({ type: AuditEntryDto, isArray: true }) audit: AuditEntryDto[];
}
