-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('PDF', 'DOCX', 'TXT', 'HTML', 'WEB_ARTICLE', 'OTHER');

-- CreateEnum
CREATE TYPE "KnowledgeSourceStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "KnowledgeStorageKind" AS ENUM ('UPLOAD', 'STORAGE_REFERENCE', 'EXTERNAL_URL');

-- CreateEnum
CREATE TYPE "KnowledgeReviewAction" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'ARCHIVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "KnowledgeStage" AS ENUM ('EXTRACTION', 'NORMALIZATION', 'METADATA', 'CHUNKING', 'EMBEDDING');

-- CreateEnum
CREATE TYPE "KnowledgeJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "KnowledgeHistoryEvent" AS ENUM ('QUEUED', 'STARTED', 'COMPLETED', 'FAILED', 'RETRYING', 'SKIPPED', 'WARNING');

-- CreateEnum
CREATE TYPE "KnowledgeChunkStatus" AS ENUM ('CHUNKED', 'EMBEDDING_PENDING', 'EMBEDDED', 'EMBEDDING_FAILED');

-- CreateEnum
CREATE TYPE "EmbeddingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "VectorDistanceMetric" AS ENUM ('COSINE', 'DOT_PRODUCT', 'EUCLIDEAN');

-- CreateTable
CREATE TABLE "knowledge_topics" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "nameEn" VARCHAR(150) NOT NULL,
    "nameRw" VARCHAR(150),
    "description" VARCHAR(2000),
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "description" VARCHAR(5000),
    "sourceType" "KnowledgeSourceType" NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'rw',
    "sourceOrganization" VARCHAR(200),
    "author" VARCHAR(200),
    "publicationDate" DATE,
    "status" "KnowledgeSourceStatus" NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "latestVersionNumber" INTEGER NOT NULL DEFAULT 0,
    "approvedVersionId" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_source_versions" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "storageKind" "KnowledgeStorageKind" NOT NULL,
    "originalFilename" VARCHAR(255),
    "storageRef" VARCHAR(1000) NOT NULL,
    "fileSizeBytes" INTEGER,
    "mimeType" VARCHAR(150),
    "checksumSha256" VARCHAR(64),
    "status" "KnowledgeSourceStatus" NOT NULL DEFAULT 'DRAFT',
    "processingError" VARCHAR(2000),
    "changeNote" VARCHAR(1000),
    "createdById" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" VARCHAR(2000),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_source_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "rawText" TEXT NOT NULL,
    "pages" JSONB NOT NULL,
    "normalizedText" TEXT,
    "blocks" JSONB,
    "pageCount" INTEGER,
    "characterCount" INTEGER NOT NULL DEFAULT 0,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "detectedLanguage" "Language",
    "languageConfidence" DOUBLE PRECISION,
    "detectedCropCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "detectedTopicCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "extractedMetadata" JSONB,
    "chunkingOptions" JSONB,
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "normalizedAt" TIMESTAMP(3),
    "metadataProcessedAt" TIMESTAMP(3),
    "chunkedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "sectionTitle" VARCHAR(300),
    "pageNumber" INTEGER,
    "language" "Language" NOT NULL,
    "cropCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "topicCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB NOT NULL,
    "status" "KnowledgeChunkStatus" NOT NULL DEFAULT 'CHUNKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_source_crops" (
    "sourceId" UUID NOT NULL,
    "cropId" UUID NOT NULL,

    CONSTRAINT "knowledge_source_crops_pkey" PRIMARY KEY ("sourceId","cropId")
);

-- CreateTable
CREATE TABLE "knowledge_source_topics" (
    "sourceId" UUID NOT NULL,
    "topicId" UUID NOT NULL,

    CONSTRAINT "knowledge_source_topics_pkey" PRIMARY KEY ("sourceId","topicId")
);

-- CreateTable
CREATE TABLE "agricultural_glossary_terms" (
    "id" UUID NOT NULL,
    "termEn" VARCHAR(200) NOT NULL,
    "termRw" VARCHAR(200) NOT NULL,
    "descriptionEn" VARCHAR(2000),
    "descriptionRw" VARCHAR(2000),
    "cropId" UUID,
    "topicId" UUID,
    "synonymsEn" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "synonymsRw" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "usageExamples" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agricultural_glossary_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_approvals" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "versionId" UUID,
    "action" "KnowledgeReviewAction" NOT NULL,
    "actorId" UUID NOT NULL,
    "reason" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_processing_jobs" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "stage" "KnowledgeStage" NOT NULL,
    "status" "KnowledgeJobStatus" NOT NULL DEFAULT 'QUEUED',
    "runNumber" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "queueJobId" VARCHAR(200),
    "error" VARCHAR(2000),
    "requestedById" UUID,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "knowledge_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_processing_history" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "versionId" UUID,
    "jobId" UUID,
    "stage" "KnowledgeStage",
    "event" "KnowledgeHistoryEvent" NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_processing_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embedding_configurations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "provider" VARCHAR(100) NOT NULL,
    "model" VARCHAR(200) NOT NULL,
    "modelVersion" VARCHAR(100),
    "dimensions" INTEGER NOT NULL,
    "distanceMetric" "VectorDistanceMetric" NOT NULL DEFAULT 'COSINE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "RecordStatus" NOT NULL DEFAULT 'INACTIVE',
    "settings" JSONB,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "embedding_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_embeddings" (
    "id" UUID NOT NULL,
    "chunkId" UUID NOT NULL,
    "configurationId" UUID NOT NULL,
    "status" "EmbeddingStatus" NOT NULL DEFAULT 'PENDING',
    "contentHash" VARCHAR(64) NOT NULL,
    "dimensions" INTEGER,
    "vectorStore" VARCHAR(100),
    "vectorRef" VARCHAR(500),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(2000),
    "embeddedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(100) NOT NULL,
    "entityId" VARCHAR(100),
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_topics_code_key" ON "knowledge_topics"("code");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_topics_nameEn_key" ON "knowledge_topics"("nameEn");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_topics_nameRw_key" ON "knowledge_topics"("nameRw");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_sources_approvedVersionId_key" ON "knowledge_sources"("approvedVersionId");

-- CreateIndex
CREATE INDEX "knowledge_sources_status_idx" ON "knowledge_sources"("status");

-- CreateIndex
CREATE INDEX "knowledge_sources_sourceType_idx" ON "knowledge_sources"("sourceType");

-- CreateIndex
CREATE INDEX "knowledge_sources_language_idx" ON "knowledge_sources"("language");

-- CreateIndex
CREATE INDEX "knowledge_sources_publicationDate_idx" ON "knowledge_sources"("publicationDate");

-- CreateIndex
CREATE INDEX "knowledge_sources_createdAt_idx" ON "knowledge_sources"("createdAt");

-- CreateIndex
CREATE INDEX "knowledge_source_versions_status_idx" ON "knowledge_source_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_source_versions_sourceId_versionNumber_key" ON "knowledge_source_versions"("sourceId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_source_versions_sourceId_checksumSha256_key" ON "knowledge_source_versions"("sourceId", "checksumSha256");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_versionId_key" ON "knowledge_documents"("versionId");

-- CreateIndex
CREATE INDEX "knowledge_documents_sourceId_idx" ON "knowledge_documents"("sourceId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_sourceId_idx" ON "knowledge_chunks"("sourceId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_versionId_idx" ON "knowledge_chunks"("versionId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_language_idx" ON "knowledge_chunks"("language");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_documentId_chunkIndex_key" ON "knowledge_chunks"("documentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "knowledge_source_crops_cropId_idx" ON "knowledge_source_crops"("cropId");

-- CreateIndex
CREATE INDEX "knowledge_source_topics_topicId_idx" ON "knowledge_source_topics"("topicId");

-- CreateIndex
CREATE INDEX "agricultural_glossary_terms_cropId_idx" ON "agricultural_glossary_terms"("cropId");

-- CreateIndex
CREATE INDEX "agricultural_glossary_terms_topicId_idx" ON "agricultural_glossary_terms"("topicId");

-- CreateIndex
CREATE INDEX "agricultural_glossary_terms_status_idx" ON "agricultural_glossary_terms"("status");

-- CreateIndex
CREATE UNIQUE INDEX "agricultural_glossary_terms_termEn_termRw_key" ON "agricultural_glossary_terms"("termEn", "termRw");

-- CreateIndex
CREATE INDEX "knowledge_approvals_sourceId_createdAt_idx" ON "knowledge_approvals"("sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "knowledge_processing_jobs_versionId_stage_idx" ON "knowledge_processing_jobs"("versionId", "stage");

-- CreateIndex
CREATE INDEX "knowledge_processing_jobs_status_idx" ON "knowledge_processing_jobs"("status");

-- CreateIndex
CREATE INDEX "knowledge_processing_history_sourceId_createdAt_idx" ON "knowledge_processing_history"("sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "knowledge_processing_history_versionId_idx" ON "knowledge_processing_history"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "embedding_configurations_provider_model_version_key" ON "embedding_configurations"("provider", "model", "version");

-- CreateIndex
CREATE INDEX "knowledge_embeddings_configurationId_status_idx" ON "knowledge_embeddings"("configurationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_embeddings_chunkId_configurationId_key" ON "knowledge_embeddings"("chunkId", "configurationId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_approvedVersionId_fkey" FOREIGN KEY ("approvedVersionId") REFERENCES "knowledge_source_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_source_versions" ADD CONSTRAINT "knowledge_source_versions_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_source_versions" ADD CONSTRAINT "knowledge_source_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_source_versions" ADD CONSTRAINT "knowledge_source_versions_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "knowledge_source_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "knowledge_source_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_source_crops" ADD CONSTRAINT "knowledge_source_crops_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_source_crops" ADD CONSTRAINT "knowledge_source_crops_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_source_topics" ADD CONSTRAINT "knowledge_source_topics_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_source_topics" ADD CONSTRAINT "knowledge_source_topics_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "knowledge_topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agricultural_glossary_terms" ADD CONSTRAINT "agricultural_glossary_terms_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agricultural_glossary_terms" ADD CONSTRAINT "agricultural_glossary_terms_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "knowledge_topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agricultural_glossary_terms" ADD CONSTRAINT "agricultural_glossary_terms_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agricultural_glossary_terms" ADD CONSTRAINT "agricultural_glossary_terms_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_approvals" ADD CONSTRAINT "knowledge_approvals_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_approvals" ADD CONSTRAINT "knowledge_approvals_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "knowledge_source_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_approvals" ADD CONSTRAINT "knowledge_approvals_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_processing_jobs" ADD CONSTRAINT "knowledge_processing_jobs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_processing_jobs" ADD CONSTRAINT "knowledge_processing_jobs_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "knowledge_source_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_processing_jobs" ADD CONSTRAINT "knowledge_processing_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_processing_history" ADD CONSTRAINT "knowledge_processing_history_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_processing_history" ADD CONSTRAINT "knowledge_processing_history_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "knowledge_source_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_processing_history" ADD CONSTRAINT "knowledge_processing_history_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "knowledge_processing_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embedding_configurations" ADD CONSTRAINT "embedding_configurations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "embedding_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one queued or running job per version and stage.
CREATE UNIQUE INDEX "knowledge_processing_jobs_one_open_per_stage"
  ON "knowledge_processing_jobs" ("versionId", "stage")
  WHERE "status" IN ('QUEUED', 'RUNNING');

-- At most one active embedding configuration.
CREATE UNIQUE INDEX "embedding_configurations_one_active"
  ON "embedding_configurations" ((true))
  WHERE "status" = 'ACTIVE';

-- Array filters used by metadata search and future retrieval.
CREATE INDEX "knowledge_chunks_cropCodes_gin" ON "knowledge_chunks" USING GIN ("cropCodes");
CREATE INDEX "knowledge_chunks_topicCodes_gin" ON "knowledge_chunks" USING GIN ("topicCodes");

ALTER TABLE "knowledge_source_versions"
  ADD CONSTRAINT "knowledge_source_versions_version_positive" CHECK ("versionNumber" > 0);
ALTER TABLE "knowledge_source_versions"
  ADD CONSTRAINT "knowledge_source_versions_size_non_negative" CHECK ("fileSizeBytes" IS NULL OR "fileSizeBytes" >= 0);
ALTER TABLE "embedding_configurations"
  ADD CONSTRAINT "embedding_configurations_dimensions_positive" CHECK ("dimensions" > 0);
