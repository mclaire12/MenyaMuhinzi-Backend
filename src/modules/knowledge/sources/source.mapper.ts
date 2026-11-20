import type { Prisma } from '../../../generated/prisma/client';
import { cropSummarySelect } from '../../crops/crop.lookup';
import type { KnowledgeSourceResponseDto, KnowledgeVersionDto } from '../dto/knowledge-source.dto';

export const versionSelect = {
  id: true,
  versionNumber: true,
  storageKind: true,
  originalFilename: true,
  storageRef: true,
  fileSizeBytes: true,
  mimeType: true,
  checksumSha256: true,
  status: true,
  processingError: true,
  changeNote: true,
  createdById: true,
  submittedAt: true,
  reviewedById: true,
  reviewedAt: true,
  reviewReason: true,
  processedAt: true,
  createdAt: true,
} satisfies Prisma.KnowledgeSourceVersionSelect;

export const topicSummarySelect = {
  id: true,
  code: true,
  nameEn: true,
  nameRw: true,
} satisfies Prisma.KnowledgeTopicSelect;

export const sourceInclude = {
  crops: { include: { crop: { select: cropSummarySelect } }, orderBy: { crop: { nameEn: 'asc' } } },
  topics: {
    include: { topic: { select: topicSummarySelect } },
    orderBy: { topic: { nameEn: 'asc' } },
  },
  versions: { orderBy: { versionNumber: 'desc' }, select: versionSelect },
} satisfies Prisma.KnowledgeSourceInclude;

export type SourceRecord = Prisma.KnowledgeSourceGetPayload<{ include: typeof sourceInclude }>;

export const chunkSelect = {
  id: true,
  documentId: true,
  sourceId: true,
  versionId: true,
  chunkIndex: true,
  text: true,
  sectionTitle: true,
  pageNumber: true,
  language: true,
  cropCodes: true,
  topicCodes: true,
  metadata: true,
  status: true,
  createdAt: true,
} satisfies Prisma.KnowledgeChunkSelect;

/** Version details (file references, review notes) are only returned to administrators. */
export function toSourceResponse(
  source: SourceRecord,
  options: { admin: boolean; withVersions?: boolean },
): KnowledgeSourceResponseDto {
  const response: KnowledgeSourceResponseDto = {
    id: source.id,
    title: source.title,
    description: source.description,
    sourceType: source.sourceType,
    language: source.language,
    sourceOrganization: source.sourceOrganization,
    author: source.author,
    publicationDate: source.publicationDate
      ? source.publicationDate.toISOString().slice(0, 10)
      : null,
    status: source.status,
    isActive: source.isActive,
    latestVersionNumber: source.latestVersionNumber,
    approvedVersionId: source.approvedVersionId,
    approvedById: source.approvedById,
    approvedAt: source.approvedAt,
    archivedAt: source.archivedAt,
    createdById: source.createdById,
    crops: source.crops.map((link) => link.crop),
    topics: source.topics.map((link) => link.topic),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
  if (options.admin) {
    response.latestVersion = (source.versions[0] as KnowledgeVersionDto | undefined) ?? null;
    if (options.withVersions) response.versions = source.versions;
  }
  return response;
}
