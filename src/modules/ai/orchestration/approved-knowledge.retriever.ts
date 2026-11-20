import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { RETRIEVABLE_CHUNK_WHERE } from '../../knowledge/knowledge.constants';
import { KnowledgeSearchService } from '../../knowledge/search/knowledge-search.service';
import {
  RetrievalStatus,
  type KnowledgeRetrievalQuery,
  type KnowledgeRetrievalResult,
  type KnowledgeRetriever,
  type RetrievedChunk,
} from './ai.interfaces';

const retrievedChunkSelect = {
  id: true,
  documentId: true,
  sourceId: true,
  versionId: true,
  text: true,
  pageNumber: true,
  sectionTitle: true,
  language: true,
  source: { select: { title: true } },
} satisfies Prisma.KnowledgeChunkSelect;

type RetrievedChunkRecord = Prisma.KnowledgeChunkGetPayload<{
  select: typeof retrievedChunkSelect;
}>;

/**
 * Retrieves approved knowledge through the Phase 4 semantic search. When no embedding
 * provider and vector store are configured it reports UNAVAILABLE instead of falling back to
 * keyword or random matches.
 */
@Injectable()
export class ApprovedKnowledgeRetriever implements KnowledgeRetriever {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: KnowledgeSearchService,
  ) {}

  async retrieve(query: KnowledgeRetrievalQuery): Promise<KnowledgeRetrievalResult> {
    if (query.limit <= 0) return { status: RetrievalStatus.Disabled, chunks: [] };
    const matches = await this.search.semanticMatches({
      text: query.text,
      topK: query.limit,
      language: query.language,
      cropCodes: query.cropCodes,
    });
    if (!matches) {
      return {
        status: RetrievalStatus.Unavailable,
        chunks: [],
        reason: 'No embedding provider and vector store are configured.',
      };
    }
    const scores = new Map(matches.map((match) => [match.chunk.id, match.score]));
    const approved = await this.load(matches.map((match) => match.chunk.id));
    const chunks = matches
      .filter((match) => approved.has(match.chunk.id))
      .map((match) => this.toChunk(approved.get(match.chunk.id)!, scores.get(match.chunk.id)!));
    return { status: RetrievalStatus.Retrieved, chunks };
  }

  async resolveApproved(chunkIds: string[]): Promise<RetrievedChunk[]> {
    const approved = await this.load(chunkIds);
    return chunkIds
      .filter((id) => approved.has(id))
      .map((id) => this.toChunk(approved.get(id)!, null));
  }

  private async load(ids: string[]): Promise<Map<string, RetrievedChunkRecord>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.knowledgeChunk.findMany({
      where: { id: { in: ids }, ...RETRIEVABLE_CHUNK_WHERE },
      select: retrievedChunkSelect,
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private toChunk(row: RetrievedChunkRecord, score: number | null): RetrievedChunk {
    return {
      chunkId: row.id,
      documentId: row.documentId,
      sourceId: row.sourceId,
      versionId: row.versionId,
      sourceTitle: row.source.title,
      text: row.text,
      pageNumber: row.pageNumber,
      sectionTitle: row.sectionTitle,
      language: row.language,
      score,
    };
  }
}
