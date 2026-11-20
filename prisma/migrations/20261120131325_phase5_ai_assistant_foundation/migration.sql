-- CreateEnum
CREATE TYPE "AiRecordStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AiCapability" AS ENUM ('TEXT_GENERATION', 'EMBEDDINGS', 'CLASSIFICATION', 'TRANSLATION', 'SUMMARIZATION');

-- CreateEnum
CREATE TYPE "AiPromptCategory" AS ENUM ('SYSTEM', 'AGRICULTURAL_ASSISTANCE', 'CROP_GUIDANCE', 'LEARNING_SUPPORT', 'ASSESSMENT_SUPPORT', 'SAFETY', 'GENERAL');

-- CreateEnum
CREATE TYPE "AiConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "AiMessageStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiRequestStatus" AS ENUM ('CREATED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiSafetyCategory" AS ENUM ('AGRICULTURAL_ADVICE', 'PEST_CONTROL', 'DISEASE_MANAGEMENT', 'CHEMICAL_USAGE', 'GENERAL_SAFETY', 'HUMAN_ESCALATION');

-- CreateEnum
CREATE TYPE "AiUsageStatus" AS ENUM ('RECORDED', 'NOT_AVAILABLE');

-- CreateEnum
CREATE TYPE "AiValidationStatus" AS ENUM ('PASSED', 'WARNING', 'FAILED');

-- CreateTable
CREATE TABLE "ai_assistants" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "assistantType" VARCHAR(60) NOT NULL,
    "purpose" VARCHAR(1000) NOT NULL,
    "description" VARCHAR(5000),
    "supportedLanguages" "Language"[],
    "defaultLanguage" "Language" NOT NULL,
    "allowedRoles" TEXT[],
    "knowledgeAccess" BOOLEAN NOT NULL DEFAULT false,
    "maxKnowledgeChunks" INTEGER NOT NULL DEFAULT 5,
    "requireSourceReferences" BOOLEAN NOT NULL DEFAULT false,
    "status" "AiRecordStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_assistants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_assistant_crops" (
    "assistantId" UUID NOT NULL,
    "cropId" UUID NOT NULL,

    CONSTRAINT "ai_assistant_crops_pkey" PRIMARY KEY ("assistantId","cropId")
);

-- CreateTable
CREATE TABLE "ai_assistant_versions" (
    "id" UUID NOT NULL,
    "assistantId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeNote" VARCHAR(1000),
    "changedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_assistant_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(100) NOT NULL,
    "modelName" VARCHAR(200) NOT NULL,
    "modelVersion" VARCHAR(100) NOT NULL,
    "displayName" VARCHAR(200) NOT NULL,
    "capabilities" "AiCapability"[],
    "supportedLanguages" "Language"[],
    "contextWindowTokens" INTEGER,
    "maxOutputTokens" INTEGER,
    "metadata" JSONB,
    "status" "AiRecordStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_versions" (
    "id" UUID NOT NULL,
    "modelId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeNote" VARCHAR(1000),
    "changedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_assistant_model_configurations" (
    "id" UUID NOT NULL,
    "assistantId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "primaryModelId" UUID NOT NULL,
    "fallbackModelId" UUID,
    "requiredCapabilities" "AiCapability"[],
    "parameters" JSONB,
    "status" "RecordStatus" NOT NULL DEFAULT 'INACTIVE',
    "effectiveFrom" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "changeNote" VARCHAR(1000),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_assistant_model_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompt_templates" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(2000),
    "category" "AiPromptCategory" NOT NULL,
    "language" "Language" NOT NULL,
    "purpose" VARCHAR(1000),
    "status" "AiRecordStatus" NOT NULL DEFAULT 'DRAFT',
    "defaultVersionId" UUID,
    "latestVersionNumber" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompt_versions" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "variables" TEXT[],
    "changeNote" VARCHAR(1000),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_assistant_prompts" (
    "assistantId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "pinnedVersionId" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_assistant_prompts_pkey" PRIMARY KEY ("assistantId","templateId")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "assistantId" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "language" "Language" NOT NULL,
    "status" "AiConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "status" "AiMessageStatus" NOT NULL DEFAULT 'COMPLETED',
    "clientRequestId" VARCHAR(100),
    "metadata" JSONB,
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_requests" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "assistantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "userMessageId" UUID NOT NULL,
    "assistantMessageId" UUID,
    "modelConfigurationId" UUID,
    "promptVersionId" UUID,
    "promptVersionIds" UUID[],
    "policyVersionIds" UUID[],
    "status" "AiRequestStatus" NOT NULL DEFAULT 'CREATED',
    "errorCode" VARCHAR(100),
    "errorMessage" VARCHAR(1000),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_request_knowledge_references" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "sourceId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "chunkId" UUID NOT NULL,
    "sourceTitle" VARCHAR(300) NOT NULL,
    "pageNumber" INTEGER,
    "pageEnd" INTEGER,
    "sectionTitle" VARCHAR(300),
    "relevanceScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_request_knowledge_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_records" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "assistantId" UUID NOT NULL,
    "modelConfigurationId" UUID,
    "modelId" UUID,
    "provider" VARCHAR(100),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "estimatedCost" DECIMAL(14,6),
    "currency" VARCHAR(3),
    "durationMs" INTEGER,
    "status" "AiUsageStatus" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_safety_policies" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(2000),
    "category" "AiSafetyCategory" NOT NULL,
    "status" "AiRecordStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" UUID,
    "latestVersionNumber" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_safety_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_safety_policy_versions" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "instructions" TEXT NOT NULL,
    "restrictions" TEXT[],
    "triggerKeywords" TEXT[],
    "requiresEscalation" BOOLEAN NOT NULL DEFAULT false,
    "escalationGuidance" VARCHAR(2000),
    "changeNote" VARCHAR(1000),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_safety_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_response_validations" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "messageId" UUID,
    "validator" VARCHAR(100) NOT NULL,
    "status" "AiValidationStatus" NOT NULL,
    "checks" JSONB NOT NULL,
    "warningCodes" TEXT[],
    "requiresEscalation" BOOLEAN NOT NULL DEFAULT false,
    "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_response_validations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_assistants_code_key" ON "ai_assistants"("code");

-- CreateIndex
CREATE INDEX "ai_assistants_status_idx" ON "ai_assistants"("status");

-- CreateIndex
CREATE INDEX "ai_assistants_assistantType_idx" ON "ai_assistants"("assistantType");

-- CreateIndex
CREATE INDEX "ai_assistant_crops_cropId_idx" ON "ai_assistant_crops"("cropId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_assistant_versions_assistantId_version_key" ON "ai_assistant_versions"("assistantId", "version");

-- CreateIndex
CREATE INDEX "ai_models_status_idx" ON "ai_models"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_provider_modelName_modelVersion_key" ON "ai_models"("provider", "modelName", "modelVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_versions_modelId_version_key" ON "ai_model_versions"("modelId", "version");

-- CreateIndex
CREATE INDEX "ai_assistant_model_configurations_primaryModelId_idx" ON "ai_assistant_model_configurations"("primaryModelId");

-- CreateIndex
CREATE INDEX "ai_assistant_model_configurations_fallbackModelId_idx" ON "ai_assistant_model_configurations"("fallbackModelId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_assistant_model_configurations_assistantId_version_key" ON "ai_assistant_model_configurations"("assistantId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_templates_code_key" ON "ai_prompt_templates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_templates_defaultVersionId_key" ON "ai_prompt_templates"("defaultVersionId");

-- CreateIndex
CREATE INDEX "ai_prompt_templates_category_idx" ON "ai_prompt_templates"("category");

-- CreateIndex
CREATE INDEX "ai_prompt_templates_status_idx" ON "ai_prompt_templates"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_versions_templateId_versionNumber_key" ON "ai_prompt_versions"("templateId", "versionNumber");

-- CreateIndex
CREATE INDEX "ai_assistant_prompts_templateId_idx" ON "ai_assistant_prompts"("templateId");

-- CreateIndex
CREATE INDEX "ai_conversations_userId_status_lastActivityAt_idx" ON "ai_conversations"("userId", "status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "ai_conversations_assistantId_idx" ON "ai_conversations"("assistantId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_messages_conversationId_sequence_key" ON "ai_messages"("conversationId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ai_messages_conversationId_clientRequestId_key" ON "ai_messages"("conversationId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_requests_userMessageId_key" ON "ai_requests"("userMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_requests_assistantMessageId_key" ON "ai_requests"("assistantMessageId");

-- CreateIndex
CREATE INDEX "ai_requests_userId_createdAt_idx" ON "ai_requests"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_requests_assistantId_createdAt_idx" ON "ai_requests"("assistantId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_requests_status_idx" ON "ai_requests"("status");

-- CreateIndex
CREATE INDEX "ai_request_knowledge_references_chunkId_idx" ON "ai_request_knowledge_references"("chunkId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_request_knowledge_references_requestId_chunkId_key" ON "ai_request_knowledge_references"("requestId", "chunkId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_records_requestId_key" ON "ai_usage_records"("requestId");

-- CreateIndex
CREATE INDEX "ai_usage_records_assistantId_recordedAt_idx" ON "ai_usage_records"("assistantId", "recordedAt");

-- CreateIndex
CREATE INDEX "ai_usage_records_provider_recordedAt_idx" ON "ai_usage_records"("provider", "recordedAt");

-- CreateIndex
CREATE INDEX "ai_usage_records_status_idx" ON "ai_usage_records"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_safety_policies_code_key" ON "ai_safety_policies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ai_safety_policies_currentVersionId_key" ON "ai_safety_policies"("currentVersionId");

-- CreateIndex
CREATE INDEX "ai_safety_policies_category_idx" ON "ai_safety_policies"("category");

-- CreateIndex
CREATE INDEX "ai_safety_policies_status_idx" ON "ai_safety_policies"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_safety_policy_versions_policyId_versionNumber_key" ON "ai_safety_policy_versions"("policyId", "versionNumber");

-- CreateIndex
CREATE INDEX "ai_response_validations_requestId_idx" ON "ai_response_validations"("requestId");

-- AddForeignKey
ALTER TABLE "ai_assistants" ADD CONSTRAINT "ai_assistants_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_crops" ADD CONSTRAINT "ai_assistant_crops_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "ai_assistants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_crops" ADD CONSTRAINT "ai_assistant_crops_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_versions" ADD CONSTRAINT "ai_assistant_versions_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "ai_assistants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_versions" ADD CONSTRAINT "ai_assistant_versions_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_versions" ADD CONSTRAINT "ai_model_versions_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ai_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_versions" ADD CONSTRAINT "ai_model_versions_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_model_configurations" ADD CONSTRAINT "ai_assistant_model_configurations_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "ai_assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_model_configurations" ADD CONSTRAINT "ai_assistant_model_configurations_primaryModelId_fkey" FOREIGN KEY ("primaryModelId") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_model_configurations" ADD CONSTRAINT "ai_assistant_model_configurations_fallbackModelId_fkey" FOREIGN KEY ("fallbackModelId") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_model_configurations" ADD CONSTRAINT "ai_assistant_model_configurations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_defaultVersionId_fkey" FOREIGN KEY ("defaultVersionId") REFERENCES "ai_prompt_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ai_prompt_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_prompts" ADD CONSTRAINT "ai_assistant_prompts_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "ai_assistants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_prompts" ADD CONSTRAINT "ai_assistant_prompts_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ai_prompt_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_prompts" ADD CONSTRAINT "ai_assistant_prompts_pinnedVersionId_fkey" FOREIGN KEY ("pinnedVersionId") REFERENCES "ai_prompt_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "ai_assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "ai_assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_userMessageId_fkey" FOREIGN KEY ("userMessageId") REFERENCES "ai_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_assistantMessageId_fkey" FOREIGN KEY ("assistantMessageId") REFERENCES "ai_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_modelConfigurationId_fkey" FOREIGN KEY ("modelConfigurationId") REFERENCES "ai_assistant_model_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_promptVersionId_fkey" FOREIGN KEY ("promptVersionId") REFERENCES "ai_prompt_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_request_knowledge_references" ADD CONSTRAINT "ai_request_knowledge_references_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ai_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_request_knowledge_references" ADD CONSTRAINT "ai_request_knowledge_references_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_request_knowledge_references" ADD CONSTRAINT "ai_request_knowledge_references_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "knowledge_source_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_request_knowledge_references" ADD CONSTRAINT "ai_request_knowledge_references_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_request_knowledge_references" ADD CONSTRAINT "ai_request_knowledge_references_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "knowledge_chunks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ai_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "ai_assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_modelConfigurationId_fkey" FOREIGN KEY ("modelConfigurationId") REFERENCES "ai_assistant_model_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_safety_policies" ADD CONSTRAINT "ai_safety_policies_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_safety_policies" ADD CONSTRAINT "ai_safety_policies_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ai_safety_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_safety_policy_versions" ADD CONSTRAINT "ai_safety_policy_versions_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ai_safety_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_safety_policy_versions" ADD CONSTRAINT "ai_safety_policy_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_response_validations" ADD CONSTRAINT "ai_response_validations_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ai_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_response_validations" ADD CONSTRAINT "ai_response_validations_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ai_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one active model configuration per assistant.
CREATE UNIQUE INDEX "ai_assistant_model_configurations_one_active"
  ON "ai_assistant_model_configurations" ("assistantId")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "ai_assistant_model_configurations"
  ADD CONSTRAINT "ai_model_config_distinct_fallback" CHECK ("fallbackModelId" IS NULL OR "fallbackModelId" <> "primaryModelId");
ALTER TABLE "ai_assistants"
  ADD CONSTRAINT "ai_assistants_default_language_supported" CHECK ("defaultLanguage" = ANY ("supportedLanguages")),
  ADD CONSTRAINT "ai_assistants_max_chunks_range" CHECK ("maxKnowledgeChunks" BETWEEN 0 AND 50);
ALTER TABLE "ai_models"
  ADD CONSTRAINT "ai_models_token_limits_positive" CHECK (
    ("contextWindowTokens" IS NULL OR "contextWindowTokens" > 0) AND ("maxOutputTokens" IS NULL OR "maxOutputTokens" > 0));
ALTER TABLE "ai_usage_records"
  ADD CONSTRAINT "ai_usage_non_negative" CHECK (
    ("inputTokens" IS NULL OR "inputTokens" >= 0) AND ("outputTokens" IS NULL OR "outputTokens" >= 0)
    AND ("totalTokens" IS NULL OR "totalTokens" >= 0) AND ("estimatedCost" IS NULL OR "estimatedCost" >= 0)
    AND ("durationMs" IS NULL OR "durationMs" >= 0));
ALTER TABLE "ai_usage_records"
  ADD CONSTRAINT "ai_usage_cost_has_currency" CHECK ("estimatedCost" IS NULL OR "currency" IS NOT NULL);
