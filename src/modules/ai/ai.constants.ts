import { AiRequestStatus } from '../../generated/prisma/client';

/** Built-in assistant types. The column is a free identifier so new types need no migration. */
export const AssistantType = {
  GeneralAgriculture: 'GENERAL_AGRICULTURE',
  CropSpecific: 'CROP_SPECIFIC',
  FarmerLearning: 'FARMER_LEARNING',
  FacilitatorSupport: 'FACILITATOR_SUPPORT',
} as const;

export const ASSISTANT_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{1,59}$/;

/** Machine-readable reasons stored on failed AI requests. Messages are safe to show to users. */
export const AiErrorCode = {
  ProviderNotConfigured: 'AI_PROVIDER_NOT_CONFIGURED',
  ModelConfigurationMissing: 'AI_MODEL_CONFIGURATION_MISSING',
  ModelConfigurationInvalid: 'AI_MODEL_CONFIGURATION_INVALID',
  AssistantUnavailable: 'AI_ASSISTANT_UNAVAILABLE',
  KnowledgeUnavailable: 'AI_KNOWLEDGE_UNAVAILABLE',
  PromptIncomplete: 'AI_PROMPT_INCOMPLETE',
  ProviderError: 'AI_PROVIDER_ERROR',
  ResponseValidationFailed: 'AI_RESPONSE_VALIDATION_FAILED',
  QueueUnavailable: 'AI_QUEUE_UNAVAILABLE',
  RequestNotFound: 'AI_REQUEST_NOT_FOUND',
} as const;

export const AiErrorMessage: Record<string, string> = {
  AI_PROVIDER_NOT_CONFIGURED:
    'No AI provider is configured for this assistant; no response was generated.',
  AI_MODEL_CONFIGURATION_MISSING:
    'The assistant has no active model configuration; no response was generated.',
  AI_MODEL_CONFIGURATION_INVALID:
    'The assistant model configuration is no longer valid; no response was generated.',
  AI_ASSISTANT_UNAVAILABLE: 'The assistant is no longer available.',
  AI_KNOWLEDGE_UNAVAILABLE:
    'This assistant requires approved knowledge sources, but knowledge retrieval is not configured.',
  AI_PROMPT_INCOMPLETE: 'The assistant prompt configuration is incomplete.',
  AI_PROVIDER_ERROR: 'The AI provider could not complete the request.',
  AI_RESPONSE_VALIDATION_FAILED: 'The generated response did not pass validation and was withheld.',
  AI_QUEUE_UNAVAILABLE: 'The AI processing queue is unavailable.',
  AI_REQUEST_NOT_FOUND: 'The AI request no longer exists.',
};

export const PROVIDER_NOT_CONFIGURED_NOTICE =
  'No AI provider is configured; no AI response will be generated.';

export const TERMINAL_REQUEST_STATUSES: readonly AiRequestStatus[] = [
  AiRequestStatus.COMPLETED,
  AiRequestStatus.FAILED,
  AiRequestStatus.CANCELLED,
];

export const CANCELLABLE_REQUEST_STATUSES: AiRequestStatus[] = [
  AiRequestStatus.CREATED,
  AiRequestStatus.QUEUED,
];

/** Earlier messages passed to a provider as conversation history. */
export const HISTORY_MESSAGE_LIMIT = 10;

export const AiAuditAction = {
  AssistantCreated: 'ai.assistant.created',
  AssistantUpdated: 'ai.assistant.updated',
  AssistantPromptsUpdated: 'ai.assistant.prompts-updated',
  AssistantActivated: 'ai.assistant.activated',
  AssistantDeactivated: 'ai.assistant.deactivated',
  AssistantArchived: 'ai.assistant.archived',
  ModelRegistered: 'ai.model.registered',
  ModelUpdated: 'ai.model.updated',
  ModelActivated: 'ai.model.activated',
  ModelDeactivated: 'ai.model.deactivated',
  ModelArchived: 'ai.model.archived',
  ModelConfigurationCreated: 'ai.model-configuration.created',
  ModelConfigurationActivated: 'ai.model-configuration.activated',
  ModelConfigurationDeactivated: 'ai.model-configuration.deactivated',
  PromptCreated: 'ai.prompt.created',
  PromptUpdated: 'ai.prompt.updated',
  PromptVersionAdded: 'ai.prompt.version-added',
  PromptDefaultVersionSet: 'ai.prompt.default-version-set',
  PromptActivated: 'ai.prompt.activated',
  PromptDeactivated: 'ai.prompt.deactivated',
  PromptArchived: 'ai.prompt.archived',
  SafetyPolicyCreated: 'ai.safety-policy.created',
  SafetyPolicyUpdated: 'ai.safety-policy.updated',
  SafetyPolicyActivated: 'ai.safety-policy.activated',
  SafetyPolicyDeactivated: 'ai.safety-policy.deactivated',
  SafetyPolicyArchived: 'ai.safety-policy.archived',
  ConversationViewed: 'ai.conversation.viewed',
  RequestViewed: 'ai.request.viewed',
} as const;

export const AiAuditEntity = {
  Assistant: 'AiAssistant',
  Model: 'AiModel',
  ModelConfiguration: 'AiAssistantModelConfiguration',
  Prompt: 'AiPromptTemplate',
  SafetyPolicy: 'AiSafetyPolicy',
  Conversation: 'AiConversation',
  Request: 'AiRequest',
} as const;
