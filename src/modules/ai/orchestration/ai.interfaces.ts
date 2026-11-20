import type { AiValidationStatus, Language } from '../../../generated/prisma/client';

/*
 * Contracts for the AI request pipeline:
 *   KnowledgeRetriever -> ContextBuilder -> PromptAssembler -> AiProvider -> ResponseValidator,
 * coordinated by AiOrchestratorService. No AiProvider is registered in this phase, so every
 * request ends with AI_PROVIDER_NOT_CONFIGURED. A real provider is added by implementing
 * AiProvider and binding it to AI_PROVIDERS; credentials are read by that implementation from
 * its own environment, never from model records.
 */

export const AI_PROVIDERS = Symbol('AI_PROVIDERS');
export const KNOWLEDGE_RETRIEVER = Symbol('KNOWLEDGE_RETRIEVER');
export const CONTEXT_BUILDER = Symbol('CONTEXT_BUILDER');
export const PROMPT_ASSEMBLER = Symbol('PROMPT_ASSEMBLER');
export const RESPONSE_VALIDATOR = Symbol('RESPONSE_VALIDATOR');

// ---------------------------------------------------------------- retrieval

export interface KnowledgeRetrievalQuery {
  text: string;
  language: Language;
  /** Crop codes of the assistant; chunks tagged with other crops are excluded. */
  cropCodes: string[];
  limit: number;
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  sourceId: string;
  versionId: string;
  sourceTitle: string;
  text: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  language: Language;
  /** Similarity reported by the vector store; null when retrieval did not score the chunk. */
  score: number | null;
}

export const RetrievalStatus = {
  /** Approved chunks were retrieved (possibly none matched). */
  Retrieved: 'RETRIEVED',
  /** The assistant does not use knowledge. */
  Disabled: 'DISABLED',
  /** No embedding provider and vector store are configured; nothing was searched. */
  Unavailable: 'UNAVAILABLE',
} as const;
export type RetrievalStatus = (typeof RetrievalStatus)[keyof typeof RetrievalStatus];

export interface KnowledgeRetrievalResult {
  status: RetrievalStatus;
  chunks: RetrievedChunk[];
  reason?: string;
}

/** Returns only approved, active knowledge (the Phase 4 retrieval rules). */
export interface KnowledgeRetriever {
  retrieve(query: KnowledgeRetrievalQuery): Promise<KnowledgeRetrievalResult>;
  /** Re-checks chunk ids against the retrieval rules; unknown or unapproved ids are dropped. */
  resolveApproved(chunkIds: string[]): Promise<RetrievedChunk[]>;
}

// ---------------------------------------------------------------- context

export interface KnowledgeContext {
  /** Numbered excerpts, e.g. "[1] Title (p. 3)\n...". Empty when nothing was retrieved. */
  text: string;
  /** References in citation order; index + 1 is the citation number. */
  references: RetrievedChunk[];
  truncated: boolean;
}

export interface ContextBuilder {
  build(chunks: RetrievedChunk[], options: { maxChars: number }): KnowledgeContext;
}

// ---------------------------------------------------------------- prompts

export interface PromptPart {
  promptVersionId: string;
  templateCode: string;
  content: string;
}

export interface PolicyInstruction {
  policyVersionId: string;
  policyCode: string;
  instructions: string;
  restrictions: string[];
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface PromptAssemblyInput {
  parts: PromptPart[];
  policies: PolicyInstruction[];
  variables: Record<string, string>;
  history: ConversationTurn[];
  question: string;
}

export interface AssembledPrompt {
  system: string;
  messages: ConversationTurn[];
  promptVersionIds: string[];
  policyVersionIds: string[];
  /** Placeholders used in templates that had no value. */
  missingVariables: string[];
}

export interface PromptAssembler {
  assemble(input: PromptAssemblyInput): AssembledPrompt;
}

// ---------------------------------------------------------------- providers

export interface AiModelDescriptor {
  id: string;
  provider: string;
  modelName: string;
  modelVersion: string;
  maxOutputTokens: number | null;
}

export interface AiGenerationInput {
  model: AiModelDescriptor;
  prompt: AssembledPrompt;
  /** Non-secret settings from the model configuration. */
  parameters: Record<string, unknown> | null;
  language: Language;
  requestId: string;
}

/** Usage as reported by the provider. Missing figures stay undefined; never estimate them. */
export interface AiProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cost?: number;
  currency?: string;
}

export interface AiGenerationResult {
  content: string;
  usage?: AiProviderUsage;
}

export interface AiProvider {
  /** Matches AiModel.provider. */
  readonly id: string;
  /**
   * True only for test doubles. Their output is stored with isTestData=true and must never
   * be presented as model-generated content.
   */
  readonly isTestDouble?: boolean;
  generate(input: AiGenerationInput): Promise<AiGenerationResult>;
}

/** Thrown by providers. Retryable errors (timeouts, rate limits) are retried by the queue. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code = 'AI_PROVIDER_ERROR',
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

// ---------------------------------------------------------------- validation

export interface ValidationCheck {
  check: string;
  result: 'PASS' | 'WARN' | 'FAIL';
  detail?: string;
  policyVersionId?: string;
}

export interface ResponseValidationInput {
  question: string;
  content: string;
  references: RetrievedChunk[];
  requireSourceReferences: boolean;
  policies: {
    policyVersionId: string;
    policyCode: string;
    triggerKeywords: string[];
    requiresEscalation: boolean;
  }[];
}

export interface ResponseValidationResult {
  validator: string;
  status: AiValidationStatus;
  checks: ValidationCheck[];
  warningCodes: string[];
  requiresEscalation: boolean;
}

/**
 * Rule-based checks on structure, citations and policy triggers. Passing these checks does
 * not establish that agricultural advice is correct or safe.
 */
export interface ResponseValidator {
  validate(input: ResponseValidationInput): ResponseValidationResult;
}
