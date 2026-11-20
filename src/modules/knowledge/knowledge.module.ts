import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { knowledgeConfig } from '../../config/configuration';
import { EmbeddingConfigurationsService } from './embeddings/embedding-configurations.service';
import { EMBEDDING_PROVIDERS, VECTOR_STORE } from './embeddings/embedding.interfaces';
import { GlossaryService } from './glossary/glossary.service';
import {
  EmbeddingConfigurationsController,
  GlossaryController,
  KnowledgeSearchController,
  KnowledgeTopicsController,
} from './knowledge-catalog.controller';
import { KnowledgeJobsService } from './pipeline/knowledge-jobs.service';
import { KnowledgePipelineService } from './pipeline/knowledge-pipeline.service';
import { KnowledgeWorker } from './pipeline/knowledge.worker';
import { KnowledgeSearchService } from './search/knowledge-search.service';
import { KnowledgeReviewService } from './sources/knowledge-review.service';
import { KnowledgeSourcesController } from './sources/knowledge-sources.controller';
import { KnowledgeSourcesService } from './sources/knowledge-sources.service';
import { KnowledgeStorageService } from './storage/knowledge-storage.service';
import { KnowledgeTopicsService } from './topics/knowledge-topics.service';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [knowledgeConfig.KEY],
      // No `dest` or `storage`: uploads stay in memory until validated, then go to knowledge storage.
      useFactory: (config: ConfigType<typeof knowledgeConfig>) => ({
        limits: { fileSize: config.maxFileBytes, files: 1, fields: 30, fieldSize: 64 * 1024 },
      }),
    }),
  ],
  controllers: [
    KnowledgeSourcesController,
    KnowledgeTopicsController,
    GlossaryController,
    KnowledgeSearchController,
    EmbeddingConfigurationsController,
  ],
  providers: [
    KnowledgeStorageService,
    KnowledgeJobsService,
    KnowledgePipelineService,
    KnowledgeWorker,
    KnowledgeSourcesService,
    KnowledgeReviewService,
    KnowledgeTopicsService,
    GlossaryService,
    KnowledgeSearchService,
    EmbeddingConfigurationsService,
    // No embedding model or vector store is connected in this phase.
    { provide: EMBEDDING_PROVIDERS, useValue: [] },
    { provide: VECTOR_STORE, useValue: null },
  ],
  exports: [KnowledgeSourcesService, KnowledgePipelineService, KnowledgeSearchService],
})
export class KnowledgeModule {}
