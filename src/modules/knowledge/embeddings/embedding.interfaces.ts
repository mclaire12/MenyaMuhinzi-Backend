import type { VectorDistanceMetric } from '../../../generated/prisma/client';

export interface EmbeddingModelConfig {
  provider: string;
  model: string;
  modelVersion: string | null;
  dimensions: number;
  distanceMetric: VectorDistanceMetric;
  settings: unknown;
}

/**
 * Turns text into vectors. No implementation is registered in this phase; a real
 * provider is added later by binding it to EMBEDDING_PROVIDERS.
 */
export interface EmbeddingProvider {
  /** Matches EmbeddingConfiguration.provider. */
  readonly id: string;
  embed(texts: string[], config: EmbeddingModelConfig): Promise<number[][]>;
}

export interface VectorRecord {
  chunkId: string;
  configurationId: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface VectorMatch {
  chunkId: string;
  score: number;
}

/**
 * Stores and queries vectors. PostgreSQL has no pgvector extension here, so vectors
 * are kept outside the relational schema; KnowledgeEmbedding records where they live.
 */
export interface VectorStore {
  readonly id: string;
  upsert(records: VectorRecord[]): Promise<string[]>;
  query(
    configurationId: string,
    vector: number[],
    limit: number,
    filter: { chunkIds?: string[] },
  ): Promise<VectorMatch[]>;
  remove(configurationId: string, chunkIds: string[]): Promise<void>;
}

export const EMBEDDING_PROVIDERS = Symbol('EMBEDDING_PROVIDERS');
export const VECTOR_STORE = Symbol('VECTOR_STORE');
