import type { Prisma } from '../../../generated/prisma/client';
import type {
  AdminAiRequestResponseDto,
  AiRequestResponseDto,
  ConversationResponseDto,
  MessageResponseDto,
} from '../dto/conversation.dto';
import type { UsageRecordResponseDto } from '../dto/usage.dto';

export const messageInclude = {
  requestAsUser: { select: { id: true } },
  requestAsAnswer: { select: { id: true } },
} satisfies Prisma.AiMessageInclude;
export type MessageRecord = Prisma.AiMessageGetPayload<{ include: typeof messageInclude }>;

export const conversationInclude = {
  assistant: { select: { id: true, code: true, name: true } },
} satisfies Prisma.AiConversationInclude;
export type ConversationRecord = Prisma.AiConversationGetPayload<{
  include: typeof conversationInclude;
}>;

export const requestInclude = {
  references: { orderBy: { rank: 'asc' } },
  validations: { orderBy: { validatedAt: 'asc' } },
  usage: true,
} satisfies Prisma.AiRequestInclude;
export type RequestRecord = Prisma.AiRequestGetPayload<{ include: typeof requestInclude }>;

export function toMessageResponse(row: MessageRecord): MessageResponseDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    sequence: row.sequence,
    role: row.role,
    content: row.content,
    language: row.language,
    status: row.status,
    clientRequestId: row.clientRequestId,
    metadata: row.metadata,
    isTestData: row.isTestData,
    requestId: row.requestAsUser?.id ?? row.requestAsAnswer?.id ?? null,
    createdAt: row.createdAt,
  };
}

export function toConversationResponse(row: ConversationRecord): ConversationResponseDto {
  return {
    id: row.id,
    userId: row.userId,
    assistant: row.assistant,
    title: row.title,
    language: row.language,
    status: row.status,
    messageCount: row.messageCount,
    lastActivityAt: row.lastActivityAt,
    archivedAt: row.archivedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toUsageResponse(
  row: Prisma.AiUsageRecordGetPayload<object>,
): UsageRecordResponseDto {
  return {
    id: row.id,
    requestId: row.requestId,
    assistantId: row.assistantId,
    modelConfigurationId: row.modelConfigurationId,
    modelId: row.modelId,
    provider: row.provider,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    estimatedCost: row.estimatedCost?.toFixed(6) ?? null,
    currency: row.currency,
    durationMs: row.durationMs,
    status: row.status,
    recordedAt: row.recordedAt,
  };
}

/** What the requesting user may see: status, safe error, sources and validation outcome. */
export function toRequestResponse(row: RequestRecord): AiRequestResponseDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    assistantId: row.assistantId,
    userMessageId: row.userMessageId,
    assistantMessageId: row.assistantMessageId,
    status: row.status,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    attempts: row.attempts,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    durationMs: row.durationMs,
    references: row.references.map((ref) => ({
      rank: ref.rank,
      sourceId: ref.sourceId,
      versionId: ref.versionId,
      documentId: ref.documentId,
      chunkId: ref.chunkId,
      sourceTitle: ref.sourceTitle,
      pageNumber: ref.pageNumber,
      pageEnd: ref.pageEnd,
      sectionTitle: ref.sectionTitle,
      relevanceScore: ref.relevanceScore,
    })),
    validations: row.validations.map((validation) => ({
      id: validation.id,
      validator: validation.validator,
      status: validation.status,
      checks: validation.checks,
      warningCodes: validation.warningCodes,
      requiresEscalation: validation.requiresEscalation,
      validatedAt: validation.validatedAt,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toAdminRequestResponse(row: RequestRecord): AdminAiRequestResponseDto {
  return {
    ...toRequestResponse(row),
    userId: row.userId,
    modelConfigurationId: row.modelConfigurationId,
    promptVersionIds: row.promptVersionIds,
    policyVersionIds: row.policyVersionIds,
    metadata: row.metadata,
    usage: row.usage ? toUsageResponse(row.usage) : null,
  };
}
