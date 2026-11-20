import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Trim } from '../../../common/validation/validators';
import {
  AiConversationStatus,
  AiMessageRole,
  AiMessageStatus,
  AiRequestStatus,
  AiValidationStatus,
  Language,
} from '../../../generated/prisma/client';
import { ProviderNoticeDto } from './common.dto';
import { UsageRecordResponseDto } from './usage.dto';

export const MESSAGE_MAX_CHARS = 4000;

export class StartConversationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  assistantId: string;

  @ApiPropertyOptional({ maxLength: 200, example: 'Tomato leaf spots' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    enum: Language,
    description: "Must be supported by the assistant; defaults to the assistant's default language",
  })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;
}

export class RenameConversationDto {
  @ApiProperty({ maxLength: 200 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;
}

export class ListConversationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AiConversationStatus })
  @IsOptional()
  @IsEnum(AiConversationStatus)
  status?: AiConversationStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assistantId?: string;
}

export class AdminListConversationsQueryDto extends ListConversationsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class PostMessageDto {
  @ApiProperty({ maxLength: MESSAGE_MAX_CHARS, example: 'Why do my tomato leaves turn yellow?' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_MAX_CHARS)
  content: string;

  @ApiPropertyOptional({ enum: Language, description: 'Defaults to the conversation language' })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'Client-generated id; resending the same id returns the original message',
  })
  @IsOptional()
  @Matches(/^[A-Za-z0-9._:-]{1,100}$/, {
    message: 'clientRequestId may contain letters, digits, ".", "_", ":" and "-"',
  })
  clientRequestId?: string;
}

export class AssistantRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
}

export class ConversationResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty({ type: AssistantRefDto }) assistant: AssistantRefDto;
  @ApiProperty() title: string;
  @ApiProperty({ enum: Language }) language: Language;
  @ApiProperty({ enum: AiConversationStatus }) status: AiConversationStatus;
  @ApiProperty() messageCount: number;
  @ApiProperty() lastActivityAt: Date;
  @ApiPropertyOptional({ type: Date, nullable: true }) archivedAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) closedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ConversationListResponseDto {
  @ApiProperty({ type: ConversationResponseDto, isArray: true }) data: ConversationResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

export class MessageResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) conversationId: string;
  @ApiProperty({ description: 'Position in the conversation, starting at 1' }) sequence: number;
  @ApiProperty({ enum: AiMessageRole }) role: AiMessageRole;
  @ApiProperty() content: string;
  @ApiProperty({ enum: Language }) language: Language;
  @ApiProperty({ enum: AiMessageStatus }) status: AiMessageStatus;
  @ApiPropertyOptional({ type: String, nullable: true }) clientRequestId: string | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  metadata: unknown;
  @ApiProperty({ description: 'True when the content came from a test double, not an AI model' })
  isTestData: boolean;
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'AI request created for (user) or answered by (assistant) this message',
  })
  requestId: string | null;
  @ApiProperty() createdAt: Date;
}

export class MessageListResponseDto {
  @ApiProperty({ type: MessageResponseDto, isArray: true }) data: MessageResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

export class ConversationDetailResponseDto extends ConversationResponseDto {
  @ApiProperty({
    type: MessageResponseDto,
    isArray: true,
    description: 'Most recent 50, oldest first',
  })
  messages: MessageResponseDto[];
}

// ------------------------------------------------------------------ requests

export class KnowledgeReferenceDto {
  @ApiProperty({ description: 'Citation number used in the response, starting at 1' })
  rank: number;
  @ApiProperty({ format: 'uuid' }) sourceId: string;
  @ApiProperty({ format: 'uuid' }) versionId: string;
  @ApiProperty({ format: 'uuid' }) documentId: string;
  @ApiProperty({ format: 'uuid' }) chunkId: string;
  @ApiProperty() sourceTitle: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) pageNumber: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) pageEnd: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) sectionTitle: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) relevanceScore: number | null;
}

export class ResponseValidationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() validator: string;
  @ApiProperty({ enum: AiValidationStatus }) status: AiValidationStatus;
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  checks: unknown;
  @ApiProperty({ type: String, isArray: true }) warningCodes: string[];
  @ApiProperty() requiresEscalation: boolean;
  @ApiProperty() validatedAt: Date;
}

export class AiRequestResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) conversationId: string;
  @ApiProperty({ format: 'uuid' }) assistantId: string;
  @ApiProperty({ format: 'uuid' }) userMessageId: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  assistantMessageId: string | null;
  @ApiProperty({ enum: AiRequestStatus }) status: AiRequestStatus;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'AI_PROVIDER_NOT_CONFIGURED' })
  errorCode: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) errorMessage: string | null;
  @ApiProperty() attempts: number;
  @ApiPropertyOptional({ type: Date, nullable: true }) queuedAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) startedAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) completedAt: Date | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) durationMs: number | null;
  @ApiProperty({ type: KnowledgeReferenceDto, isArray: true }) references: KnowledgeReferenceDto[];
  @ApiProperty({ type: ResponseValidationDto, isArray: true }) validations: ResponseValidationDto[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class AdminAiRequestResponseDto extends AiRequestResponseDto {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  modelConfigurationId: string | null;
  @ApiProperty({ type: String, isArray: true }) promptVersionIds: string[];
  @ApiProperty({ type: String, isArray: true }) policyVersionIds: string[];
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  metadata: unknown;
  @ApiPropertyOptional({ type: UsageRecordResponseDto, nullable: true })
  usage: UsageRecordResponseDto | null;
}

export class AdminAiRequestListResponseDto {
  @ApiProperty({ type: AdminAiRequestResponseDto, isArray: true })
  data: AdminAiRequestResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

export class AdminListRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AiRequestStatus })
  @IsOptional()
  @IsEnum(AiRequestStatus)
  status?: AiRequestStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assistantId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Created at or after' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'Created before' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class PostMessageResponseDto {
  @ApiProperty({ type: MessageResponseDto }) message: MessageResponseDto;
  @ApiProperty({ type: AiRequestResponseDto }) request: AiRequestResponseDto;
  @ApiProperty({ type: ProviderNoticeDto }) execution: ProviderNoticeDto;
  @ApiProperty({ description: 'True when clientRequestId matched an earlier message' })
  duplicate: boolean;
}
