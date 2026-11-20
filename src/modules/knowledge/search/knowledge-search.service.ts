import { Injectable, NotImplementedException } from '@nestjs/common';
import { paginated, paginationArgs } from '../../../common/dto/pagination.dto';
import type { Language, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { isAdmin } from '../../groups/facilitator-groups.service';
import {
  SearchMode,
  type KnowledgeSearchQueryDto,
  type KnowledgeSearchResponseDto,
} from '../dto/knowledge-search.dto';
import { EmbeddingConfigurationsService } from '../embeddings/embedding-configurations.service';
import { RETRIEVABLE_CHUNK_WHERE } from '../knowledge.constants';
import { chunkSelect, sourceInclude, toSourceResponse } from '../sources/source.mapper';
import { KnowledgeSourcesService } from '../sources/knowledge-sources.service';

@Injectable()
export class KnowledgeSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: KnowledgeSourcesService,
    private readonly embeddings: EmbeddingConfigurationsService,
  ) {}

  async search(
    query: KnowledgeSearchQueryDto,
    actor: AuthenticatedUser,
  ): Promise<KnowledgeSearchResponseDto> {
    return query.mode === SearchMode.Semantic ? this.semantic(query) : this.metadata(query, actor);
  }

  private async metadata(
    query: KnowledgeSearchQueryDto,
    actor: AuthenticatedUser,
  ): Promise<KnowledgeSearchResponseDto> {
    const where = this.sources.listWhere(query, actor);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.knowledgeSource.count({ where }),
      this.prisma.knowledgeSource.findMany({
        where,
        include: sourceInclude,
        orderBy: [
          { publicationDate: { sort: 'desc', nulls: 'last' } },
          { title: 'asc' },
          { id: 'asc' },
        ],
        ...paginationArgs(query),
      }),
    ]);
    const admin = isAdmin(actor);
    const page = paginated(
      rows.map((row) => toSourceResponse(row, { admin })),
      total,
      query,
    );
    return { mode: SearchMode.Metadata, ...page };
  }

  /** Only approved, active knowledge is searched, for every role. */
  private async semantic(query: KnowledgeSearchQueryDto): Promise<KnowledgeSearchResponseDto> {
    const matches = await this.semanticMatches({
      text: query.q!,
      topK: query.topK,
      language: query.language,
    });
    if (!matches) {
      throw new NotImplementedException(
        'Semantic search is not available: no active embedding configuration with a registered embedding provider and vector store.',
      );
    }
    return { mode: SearchMode.Semantic, matches };
  }

  /**
   * Vector matches restricted to retrievable (approved, active) chunks, best first.
   * Returns null when no embedding provider and vector store are configured.
   */
  async semanticMatches(params: {
    text: string;
    topK: number;
    language?: Language;
    cropCodes?: string[];
  }): Promise<{ score: number; chunk: ChunkRecord }[] | null> {
    const runtime = await this.embeddings.activeRuntime();
    if (!runtime) return null;
    const [vector] = await runtime.provider.embed([params.text], runtime.configuration);
    const candidates = await runtime.store.query(
      runtime.configuration.id,
      vector,
      params.topK * 3,
      {},
    );
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: {
        id: { in: candidates.map((candidate) => candidate.chunkId) },
        ...RETRIEVABLE_CHUNK_WHERE,
        ...(params.language ? { language: params.language } : {}),
        ...(params.cropCodes?.length
          ? { OR: [{ cropCodes: { hasSome: params.cropCodes } }, { cropCodes: { isEmpty: true } }] }
          : {}),
      },
      select: chunkSelect,
    });
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    return candidates
      .filter((candidate) => byId.has(candidate.chunkId))
      .slice(0, params.topK)
      .map((candidate) => ({ score: candidate.score, chunk: byId.get(candidate.chunkId)! }));
  }
}

type ChunkRecord = Prisma.KnowledgeChunkGetPayload<{ select: typeof chunkSelect }>;
