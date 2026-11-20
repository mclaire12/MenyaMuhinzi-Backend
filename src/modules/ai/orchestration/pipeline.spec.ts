import { AiValidationStatus, Language } from '../../../generated/prisma/client';
import { RetrievalStatus, type RetrievedChunk } from './ai.interfaces';
import { ApprovedKnowledgeRetriever } from './approved-knowledge.retriever';
import { DefaultContextBuilder } from './context-builder';
import { extractVariables, TemplatePromptAssembler } from './prompt-assembler';
import { BasicResponseValidator, ValidationCode } from './response-validator';

const chunk = (n: number, text = `Excerpt ${n}`): RetrievedChunk => ({
  chunkId: `chunk-${n}`,
  documentId: 'doc',
  sourceId: 'source',
  versionId: 'version',
  sourceTitle: 'Tomato guide',
  text,
  pageNumber: n,
  sectionTitle: 'Irrigation',
  language: Language.en,
  score: 0.9,
});

describe('TemplatePromptAssembler', () => {
  const assembler = new TemplatePromptAssembler();

  it('extracts placeholders once, in order', () => {
    expect(extractVariables('{{ language }} {{context}} {{language}} {{ 9bad }}')).toEqual([
      'language',
      'context',
    ]);
  });

  it('substitutes variables, appends policies and reports missing values', () => {
    const prompt = assembler.assemble({
      parts: [
        { promptVersionId: 'p1', templateCode: 'SYS', content: 'You are {{assistantName}}.' },
        {
          promptVersionId: 'p2',
          templateCode: 'CTX',
          content: 'Sources:\n{{context}} {{unknown}}',
        },
      ],
      policies: [
        {
          policyVersionId: 'v1',
          policyCode: 'PEST',
          instructions: 'Refer pesticide questions to an agronomist.',
          restrictions: ['Do not state doses'],
        },
      ],
      variables: { assistantName: 'Tomato advisor', context: '[1] Excerpt' },
      history: [{ role: 'user', content: 'Earlier question' }],
      question: 'How often should I water?',
    });

    expect(prompt.system).toContain('You are Tomato advisor.');
    expect(prompt.system).toContain('[1] Excerpt');
    expect(prompt.system).toContain('Safety policies:\nRefer pesticide questions');
    expect(prompt.system).toContain('- Do not state doses');
    expect(prompt.system).not.toContain('{{');
    expect(prompt.missingVariables).toEqual(['unknown']);
    expect(prompt.promptVersionIds).toEqual(['p1', 'p2']);
    expect(prompt.policyVersionIds).toEqual(['v1']);
    expect(prompt.messages).toEqual([
      { role: 'user', content: 'Earlier question' },
      { role: 'user', content: 'How often should I water?' },
    ]);
  });
});

describe('DefaultContextBuilder', () => {
  const builder = new DefaultContextBuilder();

  it('numbers excerpts with source, section and page', () => {
    const context = builder.build([chunk(1), chunk(2)], { maxChars: 1000 });
    expect(context.text).toBe(
      '[1] Tomato guide — Irrigation — p. 1\nExcerpt 1\n\n[2] Tomato guide — Irrigation — p. 2\nExcerpt 2',
    );
    expect(context.references.map((ref) => ref.chunkId)).toEqual(['chunk-1', 'chunk-2']);
    expect(context.truncated).toBe(false);
  });

  it('leaves out whole excerpts that exceed the budget', () => {
    const context = builder.build([chunk(1), chunk(2, 'x'.repeat(500)), chunk(3)], {
      maxChars: 120,
    });
    expect(context.references.map((ref) => ref.chunkId)).toEqual(['chunk-1', 'chunk-3']);
    expect(context.text).toContain('[2] Tomato guide');
    expect(context.truncated).toBe(true);
  });

  it('returns an empty context when nothing was retrieved', () => {
    expect(builder.build([], { maxChars: 100 })).toEqual({
      text: '',
      references: [],
      truncated: false,
    });
  });
});

describe('BasicResponseValidator', () => {
  const validator = new BasicResponseValidator();
  const base = {
    question: 'How should I water tomatoes?',
    references: [chunk(1), chunk(2)],
    requireSourceReferences: false,
    policies: [],
  };

  it('passes a cited answer', () => {
    const result = validator.validate({ ...base, content: 'Water at the base [1].' });
    expect(result.status).toBe(AiValidationStatus.PASSED);
    expect(result.warningCodes).toEqual([]);
    expect(result.checks.map((check) => check.check)).toEqual([
      'STRUCTURE',
      'CITATIONS',
      'UNSUPPORTED_CLAIMS',
    ]);
  });

  it('fails empty responses and citations of sources that were not provided', () => {
    expect(validator.validate({ ...base, content: '   ' }).warningCodes).toContain(
      ValidationCode.EmptyResponse,
    );
    const invented = validator.validate({ ...base, content: 'See [3] and [1].' });
    expect(invented.status).toBe(AiValidationStatus.FAILED);
    expect(invented.warningCodes).toEqual([ValidationCode.UnknownReference]);
  });

  it('fails uncited answers when sources are required', () => {
    const uncited = validator.validate({
      ...base,
      requireSourceReferences: true,
      content: 'Water daily.',
    });
    expect(uncited.status).toBe(AiValidationStatus.FAILED);
    expect(uncited.warningCodes).toContain(ValidationCode.MissingSources);

    const noSources = validator.validate({
      ...base,
      references: [],
      requireSourceReferences: true,
      content: 'Water daily.',
    });
    expect(noSources.status).toBe(AiValidationStatus.FAILED);
  });

  it('warns about uncited quantities', () => {
    const result = validator.validate({ ...base, content: 'Apply 20 ml per litre.' });
    expect(result.status).toBe(AiValidationStatus.WARNING);
    expect(result.warningCodes).toEqual([ValidationCode.UnsupportedQuantitativeClaim]);
  });

  it('flags policy keywords and escalation', () => {
    const result = validator.validate({
      ...base,
      question: 'Which PESTICIDE should I use?',
      content: 'Ask your agronomist [1].',
      policies: [
        {
          policyVersionId: 'v1',
          policyCode: 'PEST',
          triggerKeywords: ['pesticide'],
          requiresEscalation: true,
        },
        {
          policyVersionId: 'v2',
          policyCode: 'FIRE',
          triggerKeywords: ['burn'],
          requiresEscalation: true,
        },
      ],
    });
    expect(result.status).toBe(AiValidationStatus.WARNING);
    expect(result.requiresEscalation).toBe(true);
    expect(result.warningCodes).toEqual([
      ValidationCode.PolicyTriggered,
      ValidationCode.EscalationRequired,
    ]);
    expect(result.checks.filter((check) => check.check === 'SAFETY_POLICY')).toEqual([
      expect.objectContaining({ policyVersionId: 'v1', result: 'WARN' }),
    ]);
  });
});

describe('ApprovedKnowledgeRetriever', () => {
  const approvedRow = {
    id: 'chunk-1',
    documentId: 'doc',
    sourceId: 'source',
    versionId: 'version',
    text: 'Approved excerpt',
    pageNumber: 1,
    sectionTitle: null,
    language: Language.en,
    source: { title: 'Tomato guide' },
  };

  function setup(matches: { score: number; chunk: { id: string } }[] | null) {
    const prisma = { knowledgeChunk: { findMany: jest.fn().mockResolvedValue([approvedRow]) } };
    const search = { semanticMatches: jest.fn().mockResolvedValue(matches) };
    const retriever = new ApprovedKnowledgeRetriever(prisma as never, search as never);
    return { retriever, prisma, search };
  }

  const query = { text: 'water', language: Language.en, cropCodes: ['TOMATO'], limit: 3 };

  it('reports UNAVAILABLE instead of guessing when vector search is not configured', async () => {
    const { retriever, prisma } = setup(null);
    await expect(retriever.retrieve(query)).resolves.toEqual({
      status: RetrievalStatus.Unavailable,
      chunks: [],
      reason: expect.any(String),
    });
    expect(prisma.knowledgeChunk.findMany).not.toHaveBeenCalled();
  });

  it('does not search when the limit is zero', async () => {
    const { retriever, search } = setup([]);
    await expect(retriever.retrieve({ ...query, limit: 0 })).resolves.toEqual({
      status: RetrievalStatus.Disabled,
      chunks: [],
    });
    expect(search.semanticMatches).not.toHaveBeenCalled();
  });

  it('keeps only chunks that pass the approved-knowledge filter', async () => {
    const { retriever, prisma, search } = setup([
      { score: 0.9, chunk: { id: 'chunk-1' } },
      { score: 0.8, chunk: { id: 'chunk-unapproved' } },
    ]);
    const result = await retriever.retrieve(query);
    expect(search.semanticMatches).toHaveBeenCalledWith({
      text: 'water',
      topK: 3,
      language: Language.en,
      cropCodes: ['TOMATO'],
    });
    const where = prisma.knowledgeChunk.findMany.mock.calls[0][0].where;
    expect(where.version).toEqual({ is: { status: 'APPROVED' } });
    expect(where.source.is).toMatchObject({ isActive: true, archivedAt: null });
    expect(result.status).toBe(RetrievalStatus.Retrieved);
    expect(result.chunks).toEqual([
      expect.objectContaining({ chunkId: 'chunk-1', sourceTitle: 'Tomato guide', score: 0.9 }),
    ]);
  });

  it('resolveApproved drops unknown ids without querying for an empty list', async () => {
    const { retriever, prisma } = setup([]);
    await expect(retriever.resolveApproved([])).resolves.toEqual([]);
    expect(prisma.knowledgeChunk.findMany).not.toHaveBeenCalled();
    const resolved = await retriever.resolveApproved(['chunk-1', 'missing']);
    expect(resolved.map((c) => c.chunkId)).toEqual(['chunk-1']);
  });
});
