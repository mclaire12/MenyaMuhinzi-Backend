import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { aiConfig } from '../../../config/configuration';
import {
  AiMessageRole,
  AiMessageStatus,
  AiRecordStatus,
  AiRequestStatus,
  AiUsageStatus,
  AiValidationStatus,
  Language,
  Prisma,
  RecordStatus,
  type AiModel,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { QueueName } from '../../../infrastructure/queue/queue.constants';
import {
  AiErrorCode,
  AiErrorMessage,
  HISTORY_MESSAGE_LIMIT,
  TERMINAL_REQUEST_STATUSES,
} from '../ai.constants';
import { AiModelConfigurationsService } from '../models/ai-model-configurations.service';
import { AiSafetyPoliciesService } from '../safety/ai-safety-policies.service';
import { AiProviderRegistry } from './ai-provider.registry';
import {
  AiProviderError,
  CONTEXT_BUILDER,
  KNOWLEDGE_RETRIEVER,
  PROMPT_ASSEMBLER,
  RESPONSE_VALIDATOR,
  RetrievalStatus,
  type AiGenerationResult,
  type AiProvider,
  type AiProviderUsage,
  type ContextBuilder,
  type ConversationTurn,
  type KnowledgeContext,
  type KnowledgeRetriever,
  type PromptAssembler,
  type ResponseValidator,
} from './ai.interfaces';

export interface AiJobData {
  /** AiRequest.id; also the BullMQ job id, so a request is queued at most once. */
  requestId: string;
}

/** Configuration captured when a message is submitted, before anything is queued. */
export interface RequestPlan {
  configurationId: string | null;
  promptVersionIds: string[];
  policyVersionIds: string[];
  providerConfigured: boolean;
}

export interface ExecutionOutcome {
  status: AiRequestStatus;
  errorCode?: string;
  /** True when the request was already finished or cancelled and nothing ran. */
  skipped?: boolean;
}

const executionInclude = {
  assistant: {
    include: { crops: { include: { crop: { select: { code: true, nameEn: true } } } } },
  },
  conversation: true,
  userMessage: true,
  modelConfiguration: { include: { primaryModel: true, fallbackModel: true } },
} satisfies Prisma.AiRequestInclude;

const LANGUAGE_NAMES: Record<Language, string> = { rw: 'Kinyarwanda', en: 'English' };

/**
 * Runs AI requests: plan at submission, then retrieval, context, prompt assembly, provider
 * call and validation in the queue worker. With no AiProvider registered (the case in this
 * phase) execution stops with AI_PROVIDER_NOT_CONFIGURED and no assistant message is stored.
 */
@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configurations: AiModelConfigurationsService,
    private readonly safety: AiSafetyPoliciesService,
    private readonly providers: AiProviderRegistry,
    @Inject(KNOWLEDGE_RETRIEVER) private readonly retriever: KnowledgeRetriever,
    @Inject(CONTEXT_BUILDER) private readonly contextBuilder: ContextBuilder,
    @Inject(PROMPT_ASSEMBLER) private readonly assembler: PromptAssembler,
    @Inject(RESPONSE_VALIDATOR) private readonly validator: ResponseValidator,
    @Inject(aiConfig.KEY) private readonly config: ConfigType<typeof aiConfig>,
    @InjectQueue(QueueName.AiGeneration) private readonly queue: Queue<AiJobData>,
  ) {}

  async plan(assistantId: string): Promise<RequestPlan> {
    const [configuration, links, policies] = await Promise.all([
      this.configurations.activeFor(assistantId),
      this.prisma.aiAssistantPrompt.findMany({
        where: { assistantId, template: { status: AiRecordStatus.ACTIVE } },
        include: { template: { select: { defaultVersionId: true } } },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      this.safety.activeVersions(),
    ]);
    const promptVersionIds = links
      .map((link) => link.pinnedVersionId ?? link.template.defaultVersionId)
      .filter((id): id is string => id !== null);
    return {
      configurationId: configuration?.id ?? null,
      promptVersionIds,
      policyVersionIds: policies.map((policy) => policy.id),
      providerConfigured: configuration
        ? this.usableModels(configuration).some((model) =>
            this.providers.isRegistered(model.provider),
          )
        : false,
    };
  }

  /** Queues a newly created request, or fails it at once when no model is configured. */
  async dispatch(requestId: string, plan: RequestPlan): Promise<void> {
    if (!plan.configurationId) {
      await this.fail(requestId, AiErrorCode.ModelConfigurationMissing, { startedAt: null });
      return;
    }
    try {
      await this.queue.add(
        'generate',
        { requestId },
        {
          jobId: requestId,
          attempts: this.config.requestAttempts,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      );
    } catch (error) {
      this.logger.error(`AI queue unavailable: ${(error as Error).message}`);
      await this.fail(requestId, AiErrorCode.QueueUnavailable, { startedAt: null });
      return;
    }
    await this.prisma.aiRequest.updateMany({
      where: { id: requestId, status: AiRequestStatus.CREATED },
      data: { status: AiRequestStatus.QUEUED, queuedAt: new Date() },
    });
  }

  /**
   * Executes one attempt. Permanent failures are recorded and returned as FAILED; transient
   * provider errors are rethrown so the queue retries them.
   */
  async execute(
    requestId: string,
    attempt: { attempt: number; maxAttempts: number },
  ): Promise<ExecutionOutcome> {
    const request = await this.prisma.aiRequest.findUnique({
      where: { id: requestId },
      include: executionInclude,
    });
    if (!request)
      return {
        status: AiRequestStatus.FAILED,
        errorCode: AiErrorCode.RequestNotFound,
        skipped: true,
      };
    if (TERMINAL_REQUEST_STATUSES.includes(request.status)) {
      return { status: request.status, skipped: true };
    }
    const startedAt = request.startedAt ?? new Date();
    const claimed = await this.prisma.aiRequest.updateMany({
      where: { id: requestId, status: { notIn: [...TERMINAL_REQUEST_STATUSES] } },
      data: { status: AiRequestStatus.PROCESSING, startedAt, attempts: attempt.attempt },
    });
    if (claimed.count === 0) {
      const current = await this.prisma.aiRequest.findUniqueOrThrow({ where: { id: requestId } });
      return { status: current.status, skipped: true };
    }

    if (request.assistant.status !== AiRecordStatus.ACTIVE) {
      return this.fail(requestId, AiErrorCode.AssistantUnavailable, { startedAt });
    }
    const configuration = request.modelConfiguration;
    const models =
      configuration && configuration.status === RecordStatus.ACTIVE
        ? this.usableModels(configuration)
        : [];
    if (!configuration || models.length === 0) {
      return this.fail(requestId, AiErrorCode.ModelConfigurationInvalid, { startedAt });
    }
    const usageBase = { configurationId: configuration.id, model: models[0] };
    const candidates = models
      .map((model) => ({ model, provider: this.providers.find(model.provider) }))
      .filter((c): c is { model: AiModel; provider: AiProvider } => c.provider !== undefined);
    if (candidates.length === 0) {
      return this.fail(requestId, AiErrorCode.ProviderNotConfigured, {
        startedAt,
        usage: usageBase,
      });
    }

    // Retrieval: approved knowledge only, and never a substitute when vector search is missing.
    const assistant = request.assistant;
    let context: KnowledgeContext = { text: '', references: [], truncated: false };
    let retrievalStatus: string = RetrievalStatus.Disabled;
    if (assistant.knowledgeAccess && assistant.maxKnowledgeChunks > 0) {
      const retrieval = await this.retriever.retrieve({
        text: request.userMessage.content,
        language: request.userMessage.language,
        cropCodes: assistant.crops.map((link) => link.crop.code),
        limit: assistant.maxKnowledgeChunks,
      });
      retrievalStatus = retrieval.status;
      if (retrieval.status === RetrievalStatus.Unavailable && assistant.requireSourceReferences) {
        return this.fail(requestId, AiErrorCode.KnowledgeUnavailable, {
          startedAt,
          usage: usageBase,
        });
      }
      context = this.contextBuilder.build(retrieval.chunks, {
        maxChars: this.config.contextMaxChars,
      });
    }

    const [parts, policies, history] = await Promise.all([
      this.loadPromptParts(request.promptVersionIds),
      this.loadPolicies(request.policyVersionIds),
      this.loadHistory(request.conversationId, request.userMessage.sequence),
    ]);
    const prompt = this.assembler.assemble({
      parts,
      policies: policies.map((policy) => ({
        policyVersionId: policy.id,
        policyCode: policy.policy.code,
        instructions: policy.instructions,
        restrictions: policy.restrictions,
      })),
      variables: {
        assistantName: assistant.name,
        purpose: assistant.purpose,
        language: LANGUAGE_NAMES[request.userMessage.language],
        crops: assistant.crops.map((link) => link.crop.nameEn).join(', '),
        context: context.text,
      },
      history,
      question: request.userMessage.content,
    });

    let generated: { result: AiGenerationResult; model: AiModel; provider: AiProvider } | null =
      null;
    for (const [index, candidate] of candidates.entries()) {
      try {
        const result = await candidate.provider.generate({
          model: {
            id: candidate.model.id,
            provider: candidate.model.provider,
            modelName: candidate.model.modelName,
            modelVersion: candidate.model.modelVersion,
            maxOutputTokens: candidate.model.maxOutputTokens,
          },
          prompt,
          parameters: (configuration.parameters as Record<string, unknown> | null) ?? null,
          language: request.userMessage.language,
          requestId,
        });
        generated = { result, model: candidate.model, provider: candidate.provider };
        break;
      } catch (error) {
        const retryable = !(error instanceof AiProviderError) || error.retryable;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `AI provider ${candidate.provider.id} failed for ${requestId}: ${message}`,
        );
        if (retryable && attempt.attempt < attempt.maxAttempts) {
          await this.prisma.aiRequest.update({
            where: { id: requestId },
            data: {
              status: AiRequestStatus.QUEUED,
              errorCode: AiErrorCode.ProviderError,
              errorMessage: AiErrorMessage[AiErrorCode.ProviderError],
            },
          });
          throw error instanceof Error ? error : new Error(message);
        }
        if (index === candidates.length - 1) {
          return this.fail(requestId, AiErrorCode.ProviderError, {
            startedAt,
            usage: { configurationId: configuration.id, model: candidate.model },
          });
        }
      }
    }
    if (!generated) {
      return this.fail(requestId, AiErrorCode.ProviderError, { startedAt, usage: usageBase });
    }

    const validation = this.validator.validate({
      question: request.userMessage.content,
      content: generated.result.content,
      references: context.references,
      requireSourceReferences: assistant.requireSourceReferences,
      policies: policies.map((policy) => ({
        policyVersionId: policy.id,
        policyCode: policy.policy.code,
        triggerKeywords: policy.triggerKeywords,
        requiresEscalation: policy.requiresEscalation,
      })),
    });
    // Re-check at write time so a source unapproved meanwhile is never cited.
    const approved = await this.retriever.resolveApproved(
      context.references.map((reference) => reference.chunkId),
    );
    const approvedIds = new Set(approved.map((chunk) => chunk.chunkId));
    const references = context.references.filter((reference) => approvedIds.has(reference.chunkId));
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const usage = this.usageFigures(generated.result.usage);
    const metadata = {
      retrievalStatus,
      contextTruncated: context.truncated,
      missingPromptVariables: prompt.missingVariables,
      providerId: generated.provider.id,
      modelId: generated.model.id,
      testDouble: generated.provider.isTestDouble === true,
    };

    const passed = validation.status !== AiValidationStatus.FAILED;
    await this.prisma.$transaction(async (tx) => {
      let messageId: string | null = null;
      if (passed) {
        const conversation = await tx.aiConversation.update({
          where: { id: request.conversationId },
          data: { messageCount: { increment: 1 }, lastActivityAt: completedAt },
          select: { messageCount: true },
        });
        const message = await tx.aiMessage.create({
          data: {
            conversationId: request.conversationId,
            sequence: conversation.messageCount,
            role: AiMessageRole.ASSISTANT,
            content: generated.result.content,
            language: request.userMessage.language,
            status: AiMessageStatus.COMPLETED,
            isTestData: generated.provider.isTestDouble === true,
            metadata: {
              generatedBy: generated.provider.isTestDouble ? 'TEST_DOUBLE' : 'AI_PROVIDER',
              providerId: generated.provider.id,
              modelId: generated.model.id,
              references: references.map((reference, index) => ({
                rank: index + 1,
                sourceId: reference.sourceId,
                chunkId: reference.chunkId,
                sourceTitle: reference.sourceTitle,
              })),
              validationStatus: validation.status,
              warningCodes: validation.warningCodes,
              requiresEscalation: validation.requiresEscalation,
            },
          },
        });
        messageId = message.id;
        if (references.length > 0) {
          await tx.aiRequestKnowledgeReference.createMany({
            data: references.map((reference) => ({
              requestId,
              rank: context.references.indexOf(reference) + 1,
              sourceId: reference.sourceId,
              versionId: reference.versionId,
              documentId: reference.documentId,
              chunkId: reference.chunkId,
              sourceTitle: reference.sourceTitle.slice(0, 300),
              pageNumber: reference.pageNumber,
              sectionTitle: reference.sectionTitle?.slice(0, 300) ?? null,
              relevanceScore: reference.score,
            })),
          });
        }
      }
      await tx.aiResponseValidation.create({
        data: {
          requestId,
          messageId,
          validator: validation.validator,
          status: validation.status,
          checks: validation.checks as unknown as Prisma.InputJsonValue,
          warningCodes: validation.warningCodes,
          requiresEscalation: validation.requiresEscalation,
        },
      });
      await tx.aiUsageRecord.upsert({
        where: { requestId },
        create: {
          requestId,
          assistantId: request.assistantId,
          modelConfigurationId: configuration.id,
          modelId: generated.model.id,
          provider: generated.provider.id,
          ...usage,
          durationMs,
        },
        update: { ...usage, durationMs },
      });
      await tx.aiRequest.update({
        where: { id: requestId },
        data: passed
          ? {
              status: AiRequestStatus.COMPLETED,
              assistantMessageId: messageId,
              errorCode: null,
              errorMessage: null,
              completedAt,
              durationMs,
              metadata,
            }
          : {
              status: AiRequestStatus.FAILED,
              errorCode: AiErrorCode.ResponseValidationFailed,
              errorMessage: AiErrorMessage[AiErrorCode.ResponseValidationFailed],
              completedAt,
              durationMs,
              metadata,
            },
      });
    });
    return passed
      ? { status: AiRequestStatus.COMPLETED }
      : { status: AiRequestStatus.FAILED, errorCode: AiErrorCode.ResponseValidationFailed };
  }

  /** Whether a provider is registered for any active model of the configuration. */
  async providerConfiguredFor(configurationId: string | null): Promise<boolean> {
    if (!configurationId) return false;
    const configuration = await this.prisma.aiAssistantModelConfiguration.findUnique({
      where: { id: configurationId },
      include: { primaryModel: true, fallbackModel: true },
    });
    return configuration
      ? this.usableModels(configuration).some((model) =>
          this.providers.isRegistered(model.provider),
        )
      : false;
  }

  private usableModels(configuration: {
    primaryModel: AiModel;
    fallbackModel: AiModel | null;
  }): AiModel[] {
    return [configuration.primaryModel, configuration.fallbackModel].filter(
      (model): model is AiModel => model !== null && model.status === AiRecordStatus.ACTIVE,
    );
  }

  private async fail(
    requestId: string,
    code: string,
    options: {
      startedAt: Date | null;
      usage?: { configurationId: string; model: AiModel };
    },
  ): Promise<ExecutionOutcome> {
    const completedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.aiRequest.update({
        where: { id: requestId },
        data: {
          status: AiRequestStatus.FAILED,
          errorCode: code,
          errorMessage: AiErrorMessage[code] ?? 'The request failed.',
          completedAt,
          durationMs: options.startedAt
            ? completedAt.getTime() - options.startedAt.getTime()
            : null,
        },
        select: { assistantId: true },
      });
      if (options.usage) {
        // Nothing was generated, so there are no usage figures to record.
        await tx.aiUsageRecord.upsert({
          where: { requestId },
          create: {
            requestId,
            assistantId: request.assistantId,
            modelConfigurationId: options.usage.configurationId,
            modelId: options.usage.model.id,
            provider: options.usage.model.provider,
            status: AiUsageStatus.NOT_AVAILABLE,
          },
          update: {},
        });
      }
    });
    return { status: AiRequestStatus.FAILED, errorCode: code };
  }

  /** Keeps only well-formed figures reported by the provider; nothing is estimated. */
  private usageFigures(usage: AiProviderUsage | undefined) {
    const count = (value: number | undefined) =>
      Number.isInteger(value) && value! >= 0 ? value! : null;
    const inputTokens = count(usage?.inputTokens);
    const outputTokens = count(usage?.outputTokens);
    const totalTokens = count(usage?.totalTokens);
    const currency =
      typeof usage?.currency === 'string' && /^[A-Z]{3}$/.test(usage.currency)
        ? usage.currency
        : null;
    const estimatedCost =
      currency && typeof usage?.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0
        ? new Prisma.Decimal(usage.cost)
        : null;
    const reported = [inputTokens, outputTokens, totalTokens, estimatedCost].some(
      (v) => v !== null,
    );
    return {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCost,
      currency: estimatedCost ? currency : null,
      status: reported ? AiUsageStatus.RECORDED : AiUsageStatus.NOT_AVAILABLE,
    };
  }

  private async loadPromptParts(ids: string[]) {
    if (ids.length === 0) return [];
    const versions = await this.prisma.aiPromptVersion.findMany({
      where: { id: { in: ids } },
      include: { template: { select: { code: true } } },
    });
    const byId = new Map(versions.map((version) => [version.id, version]));
    return ids
      .filter((id) => byId.has(id))
      .map((id) => ({
        promptVersionId: id,
        templateCode: byId.get(id)!.template.code,
        content: byId.get(id)!.content,
      }));
  }

  private loadPolicies(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.aiSafetyPolicyVersion.findMany({
      where: { id: { in: ids } },
      include: { policy: { select: { code: true } } },
      orderBy: { policy: { code: 'asc' } },
    });
  }

  private async loadHistory(
    conversationId: string,
    beforeSequence: number,
  ): Promise<ConversationTurn[]> {
    const rows = await this.prisma.aiMessage.findMany({
      where: {
        conversationId,
        sequence: { lt: beforeSequence },
        status: AiMessageStatus.COMPLETED,
        role: { in: [AiMessageRole.USER, AiMessageRole.ASSISTANT] },
      },
      orderBy: { sequence: 'desc' },
      take: HISTORY_MESSAGE_LIMIT,
      select: { role: true, content: true },
    });
    return rows.reverse().map((row) => ({
      role: row.role === AiMessageRole.USER ? 'user' : 'assistant',
      content: row.content,
    }));
  }
}
