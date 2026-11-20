import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AiAssistantsService } from './assistants/ai-assistants.service';
import {
  AdminAiAssistantsController,
  AdminAiModelConfigurationsController,
  AdminAiModelsController,
} from './controllers/admin-ai-config.controller';
import {
  AdminAiOversightController,
  AdminAiPromptsController,
  AdminAiSafetyPoliciesController,
  AdminAiUsageController,
} from './controllers/admin-ai-content.controller';
import {
  AiAssistantsController,
  AiConversationsController,
  AiRequestsController,
} from './controllers/ai.controller';
import { AiConversationsService } from './conversations/ai-conversations.service';
import { AiRequestsService } from './conversations/ai-requests.service';
import { AiModelConfigurationsService } from './models/ai-model-configurations.service';
import { AiModelsService } from './models/ai-models.service';
import { AiOrchestratorService } from './orchestration/ai-orchestrator.service';
import { AiProviderRegistry } from './orchestration/ai-provider.registry';
import { AiRequestWorker } from './orchestration/ai-request.worker';
import {
  AI_PROVIDERS,
  CONTEXT_BUILDER,
  KNOWLEDGE_RETRIEVER,
  PROMPT_ASSEMBLER,
  RESPONSE_VALIDATOR,
} from './orchestration/ai.interfaces';
import { ApprovedKnowledgeRetriever } from './orchestration/approved-knowledge.retriever';
import { DefaultContextBuilder } from './orchestration/context-builder';
import { TemplatePromptAssembler } from './orchestration/prompt-assembler';
import { BasicResponseValidator } from './orchestration/response-validator';
import { AiPromptsService } from './prompts/ai-prompts.service';
import { AiSafetyPoliciesService } from './safety/ai-safety-policies.service';
import { AiUsageService } from './usage/ai-usage.service';

@Module({
  imports: [KnowledgeModule],
  controllers: [
    AdminAiAssistantsController,
    AdminAiModelsController,
    AdminAiModelConfigurationsController,
    AdminAiPromptsController,
    AdminAiSafetyPoliciesController,
    AdminAiUsageController,
    AdminAiOversightController,
    AiAssistantsController,
    AiConversationsController,
    AiRequestsController,
  ],
  providers: [
    AiAssistantsService,
    AiModelsService,
    AiModelConfigurationsService,
    AiPromptsService,
    AiSafetyPoliciesService,
    AiConversationsService,
    AiRequestsService,
    AiUsageService,
    AiProviderRegistry,
    AiOrchestratorService,
    AiRequestWorker,
    // No AI provider is integrated: requests fail with AI_PROVIDER_NOT_CONFIGURED.
    { provide: AI_PROVIDERS, useValue: [] },
    { provide: KNOWLEDGE_RETRIEVER, useClass: ApprovedKnowledgeRetriever },
    { provide: CONTEXT_BUILDER, useClass: DefaultContextBuilder },
    { provide: PROMPT_ASSEMBLER, useClass: TemplatePromptAssembler },
    { provide: RESPONSE_VALIDATOR, useClass: BasicResponseValidator },
  ],
  exports: [AiOrchestratorService],
})
export class AiModule {}
