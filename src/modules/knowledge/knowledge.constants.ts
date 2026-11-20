import { KnowledgeSourceStatus, Prisma, RecordStatus } from '../../generated/prisma/client';

/**
 * Knowledge that retrieval may use: the source is active and not archived, and the
 * version is the approved one. Every non-admin read and any future retrieval API
 * must apply these filters.
 */
export const RETRIEVABLE_SOURCE_WHERE = {
  isActive: true,
  archivedAt: null,
  approvedVersionId: { not: null },
  approvedVersion: { is: { status: KnowledgeSourceStatus.APPROVED } },
} satisfies Prisma.KnowledgeSourceWhereInput;

export const RETRIEVABLE_CHUNK_WHERE = {
  version: { is: { status: KnowledgeSourceStatus.APPROVED } },
  source: { is: RETRIEVABLE_SOURCE_WHERE },
} satisfies Prisma.KnowledgeChunkWhereInput;

export const ACTIVE = RecordStatus.ACTIVE;

/** A new version cannot be added while the latest one is in one of these states. */
export const VERSION_BUSY_STATUSES: readonly KnowledgeSourceStatus[] = [
  KnowledgeSourceStatus.PROCESSING,
  KnowledgeSourceStatus.PENDING_REVIEW,
];

/** States from which processing may start. Anything else needs a new version. */
export const PROCESS_START_STATUSES: KnowledgeSourceStatus[] = [
  KnowledgeSourceStatus.DRAFT,
  KnowledgeSourceStatus.FAILED,
];

export const KnowledgeAuditAction = {
  SourceCreated: 'knowledge.source.created',
  SourceUpdated: 'knowledge.source.updated',
  SourceActivated: 'knowledge.source.activated',
  SourceDeactivated: 'knowledge.source.deactivated',
  SourceArchived: 'knowledge.source.archived',
  SourceDeleted: 'knowledge.source.deleted',
  VersionAdded: 'knowledge.version.added',
  ProcessingRequested: 'knowledge.processing.requested',
  ReviewSubmitted: 'knowledge.review.submitted',
  Approved: 'knowledge.review.approved',
  Rejected: 'knowledge.review.rejected',
  TopicCreated: 'knowledge.topic.created',
  TopicUpdated: 'knowledge.topic.updated',
  TopicDeactivated: 'knowledge.topic.deactivated',
  GlossaryCreated: 'knowledge.glossary.created',
  GlossaryUpdated: 'knowledge.glossary.updated',
  GlossaryDeactivated: 'knowledge.glossary.deactivated',
  EmbeddingConfigCreated: 'knowledge.embedding-config.created',
  EmbeddingConfigActivated: 'knowledge.embedding-config.activated',
  EmbeddingConfigDeactivated: 'knowledge.embedding-config.deactivated',
} as const;

export const AuditEntity = {
  Source: 'KnowledgeSource',
  Topic: 'KnowledgeTopic',
  Glossary: 'AgriculturalGlossaryTerm',
  EmbeddingConfiguration: 'EmbeddingConfiguration',
} as const;
