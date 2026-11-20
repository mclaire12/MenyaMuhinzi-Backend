import {
  AiMessageRole,
  AiRequestStatus,
  AiUsageStatus,
  AiValidationStatus,
} from '../../src/generated/prisma/client';
import { QueueName } from '../../src/infrastructure/queue/queue.constants';
import { AiAuditAction } from '../../src/modules/ai/ai.constants';
import { AiOrchestratorService } from '../../src/modules/ai/orchestration/ai-orchestrator.service';
import { AI_PROVIDERS } from '../../src/modules/ai/orchestration/ai.interfaces';
import {
  EMBEDDING_PROVIDERS,
  VECTOR_STORE,
} from '../../src/modules/knowledge/embeddings/embedding.interfaces';
import { RoleCode } from '../../src/modules/roles/rbac.constants';
import {
  TEST_AI_PROVIDER_ID,
  TEST_EMBEDDING_PROVIDER_ID,
  TEST_FIXTURE_RESPONSE,
  TestDoubleAiProvider,
  TestEmbeddingProvider,
  TestVectorStore,
} from '../fixtures/ai-test-doubles';
import {
  API,
  bearer,
  createTestContext,
  drainAiQueue,
  drainKnowledgeQueue,
  resetDatabase,
  seedAndLogin,
  skipQueuedAiJobs,
  skipQueuedKnowledgeJobs,
  type LoginResult,
  type SeededUser,
  type TestContext,
} from './helpers';

/** A model id no AiProvider is registered for, as in production. */
const UNREGISTERED_PROVIDER = 'example-provider';

const GUIDE = [
  'Irrigation',
  'Water tomatoes early in the morning so leaves dry before evening. Drip lines save water and keep the leaves dry, which lowers disease.',
  '',
  'Harvesting',
  'Harvest tomatoes when they start to turn red. Pick in the cool morning and keep the fruit in the shade.',
].join('\n');

const DRAFT_GUIDE = [
  'Unreviewed notes',
  'UNAPPROVED-MARKER draft text that has not been reviewed and must never reach an assistant prompt or a source reference.',
].join('\n');

describe('AI assistant management and orchestration foundation (integration)', () => {
  let ctx: TestContext;
  let admin: SeededUser & LoginResult;
  let facilitator: SeededUser & LoginResult;
  let farmer: SeededUser & LoginResult;
  let otherFarmer: SeededUser & LoginResult;
  let tomatoId: string;
  const provider = new TestDoubleAiProvider();
  const vectorStore = new TestVectorStore();

  beforeAll(async () => {
    ctx = await createTestContext({
      overrides: [
        { token: AI_PROVIDERS, value: [provider] },
        { token: EMBEDDING_PROVIDERS, value: [new TestEmbeddingProvider()] },
        { token: VECTOR_STORE, value: vectorStore },
      ],
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    skipQueuedKnowledgeJobs(ctx);
    skipQueuedAiJobs(ctx);
    provider.reset();
    vectorStore.candidates = [];
    admin = await seedAndLogin(ctx, [RoleCode.Admin]);
    facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
    farmer = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
    otherFarmer = await seedAndLogin(ctx, [RoleCode.BasicPhoneFarmer]);
    tomatoId = (await ctx.prisma.crop.findUniqueOrThrow({ where: { code: 'TOMATO' } })).id;
  });

  const as = (user: LoginResult) => bearer(user.accessToken);
  const aiQueue = () => ctx.queues[QueueName.AiGeneration];

  // ---------------------------------------------------------------- builders

  async function createAssistant(fields: Record<string, unknown> = {}) {
    const res = await ctx
      .http()
      .post(`${API}/admin/ai/assistants`)
      .set(...as(admin))
      .send({
        code: 'TOMATO_ADVISOR',
        name: 'Tomato advisor',
        assistantType: 'CROP_SPECIFIC',
        purpose: 'Answers tomato questions from approved guides',
        supportedLanguages: ['en', 'rw'],
        cropIds: [tomatoId],
        ...fields,
      });
    expect([res.status, res.status === 201 ? null : res.body]).toEqual([201, null]);
    return res.body as { id: string; currentVersion: number; status: string };
  }

  async function activeAssistant(fields: Record<string, unknown> = {}) {
    const assistant = await createAssistant(fields);
    await ctx
      .http()
      .post(`${API}/admin/ai/assistants/${assistant.id}/activate`)
      .set(...as(admin))
      .expect(200);
    return assistant;
  }

  async function registerModel(fields: Record<string, unknown> = {}, activate = true) {
    const res = await ctx
      .http()
      .post(`${API}/admin/ai/models`)
      .set(...as(admin))
      .send({
        provider: UNREGISTERED_PROVIDER,
        modelName: 'example-model',
        modelVersion: '2026-01',
        displayName: 'Example model',
        capabilities: ['TEXT_GENERATION'],
        supportedLanguages: ['en', 'rw'],
        ...fields,
      });
    expect([res.status, res.status === 201 ? null : res.body]).toEqual([201, null]);
    if (activate) {
      await ctx
        .http()
        .post(`${API}/admin/ai/models/${res.body.id}/activate`)
        .set(...as(admin))
        .expect(200);
    }
    return res.body as { id: string; providerRegistered: boolean };
  }

  async function configure(assistantId: string, primaryModelId: string, extra = {}) {
    const created = await ctx
      .http()
      .post(`${API}/admin/ai/model-configurations`)
      .set(...as(admin))
      .send({ assistantId, primaryModelId, ...extra })
      .expect(201);
    await ctx
      .http()
      .post(`${API}/admin/ai/model-configurations/${created.body.id}/activate`)
      .set(...as(admin))
      .expect(200);
    return created.body as { id: string; version: number };
  }

  async function readyAssistant(
    options: { provider?: string; assistant?: Record<string, unknown> } = {},
  ) {
    const assistant = await activeAssistant(options.assistant);
    const model = await registerModel({ provider: options.provider ?? UNREGISTERED_PROVIDER });
    const configuration = await configure(assistant.id, model.id);
    return { assistant, model, configuration };
  }

  async function startConversation(user: LoginResult, assistantId: string, body = {}) {
    const res = await ctx
      .http()
      .post(`${API}/ai/conversations`)
      .set(...as(user))
      .send({ assistantId, ...body });
    expect([res.status, res.status === 201 ? null : res.body]).toEqual([201, null]);
    return res.body as { id: string; language: string };
  }

  function send(user: LoginResult, conversationId: string, body: Record<string, unknown>) {
    return ctx
      .http()
      .post(`${API}/ai/conversations/${conversationId}/messages`)
      .set(...as(user))
      .send(body);
  }

  async function auditActions(entityId: string) {
    const rows = await ctx.prisma.auditLog.findMany({
      where: { entityId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => row.action);
  }

  // ---------------------------------------------------------------- access control

  describe('access control', () => {
    const adminRoutes = [
      '/admin/ai/assistants',
      '/admin/ai/models',
      '/admin/ai/model-configurations',
      '/admin/ai/prompts',
      '/admin/ai/safety-policies',
      '/admin/ai/usage',
      '/admin/ai/usage/summary',
      '/admin/ai/requests',
      '/admin/ai/conversations',
    ];

    it('requires authentication', async () => {
      for (const path of [...adminRoutes, '/ai/assistants', '/ai/conversations']) {
        await ctx.http().get(`${API}${path}`).expect(401);
      }
    });

    it('denies administration to farmers and facilitators', async () => {
      for (const user of [farmer, otherFarmer, facilitator]) {
        for (const path of adminRoutes) {
          await ctx
            .http()
            .get(`${API}${path}`)
            .set(...as(user))
            .expect(403);
        }
      }
      await ctx
        .http()
        .post(`${API}/admin/ai/assistants`)
        .set(...as(farmer))
        .send({ code: 'X' })
        .expect(403);
    });

    it('grants farmers and facilitators only assistant reading and their own conversations', async () => {
      const permissions = await ctx.prisma.rolePermission.findMany({
        where: {
          role: { code: RoleCode.SmartphoneFarmer },
          permission: { code: { startsWith: 'ai-' } },
        },
        include: { permission: true },
      });
      expect(permissions.map((p) => p.permission.code).sort()).toEqual([
        'ai-assistants:read',
        'ai-conversations:manage',
      ]);
      for (const user of [farmer, otherFarmer, facilitator]) {
        await ctx
          .http()
          .get(`${API}/ai/assistants`)
          .set(...as(user))
          .expect(200);
        await ctx
          .http()
          .get(`${API}/ai/conversations`)
          .set(...as(user))
          .expect(200);
      }
    });
  });

  // ---------------------------------------------------------------- assistants

  describe('assistants', () => {
    it('creates a draft assistant with an initial configuration version and audit entry', async () => {
      const assistant = await createAssistant({ allowedRoles: ['SMARTPHONE_FARMER'] });
      const detail = await ctx
        .http()
        .get(`${API}/admin/ai/assistants/${assistant.id}`)
        .set(...as(admin))
        .expect(200);
      expect(detail.body).toMatchObject({
        code: 'TOMATO_ADVISOR',
        assistantType: 'CROP_SPECIFIC',
        status: 'DRAFT',
        supportedLanguages: ['en', 'rw'],
        defaultLanguage: 'en',
        allowedRoles: ['SMARTPHONE_FARMER'],
        knowledgeAccess: false,
        requireSourceReferences: false,
        currentVersion: 1,
        crops: [{ code: 'TOMATO' }],
        activeModelConfigurationId: null,
      });
      expect(await auditActions(assistant.id)).toEqual([AiAuditAction.AssistantCreated]);
    });

    it('accepts new assistant types without schema changes', async () => {
      const assistant = await createAssistant({ assistantType: 'livestock_support' });
      expect(assistant).toMatchObject({ assistantType: 'LIVESTOCK_SUPPORT' });
    });

    it('rejects invalid configurations', async () => {
      const post = (body: Record<string, unknown>) =>
        ctx
          .http()
          .post(`${API}/admin/ai/assistants`)
          .set(...as(admin))
          .send({
            code: 'BAD',
            name: 'Bad',
            assistantType: 'GENERAL_AGRICULTURE',
            purpose: 'x',
            supportedLanguages: ['en'],
            ...body,
          });
      await post({ defaultLanguage: 'rw' }).expect(400);
      await post({ requireSourceReferences: true }).expect(400);
      await post({ supportedLanguages: [] }).expect(400);
      await post({ supportedLanguages: ['fr'] }).expect(400);
      await post({ allowedRoles: ['SUPERUSER'] }).expect(400);
      await post({ maxKnowledgeChunks: 99 }).expect(400);
      await post({ assistantType: 'bad type!' }).expect(400);
      await post({ status: 'ACTIVE' }).expect(400);
      await post({ cropIds: ['00000000-0000-4000-8000-000000000000'] }).expect(400);
      await post({ code: 'TWICE' }).expect(201);
      await post({ code: 'twice' }).expect(409);
      expect(await ctx.prisma.aiAssistant.count()).toBe(1);
    });

    it('versions every change and exposes the history', async () => {
      const assistant = await createAssistant();
      const updated = await ctx
        .http()
        .patch(`${API}/admin/ai/assistants/${assistant.id}`)
        .set(...as(admin))
        .send({
          name: 'Tomato advisor v2',
          knowledgeAccess: true,
          requireSourceReferences: true,
          changeNote: 'Use approved guides',
        })
        .expect(200);
      expect(updated.body).toMatchObject({ currentVersion: 2, requireSourceReferences: true });
      await ctx
        .http()
        .post(`${API}/admin/ai/assistants/${assistant.id}/activate`)
        .set(...as(admin))
        .expect(200);

      const history = await ctx
        .http()
        .get(`${API}/admin/ai/assistants/${assistant.id}/history`)
        .set(...as(admin))
        .expect(200);
      expect(history.body.versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
      expect(history.body.versions[1]).toMatchObject({
        changeNote: 'Use approved guides',
        snapshot: { name: 'Tomato advisor v2', knowledgeAccess: true },
      });
      expect(history.body.versions[2].snapshot).toMatchObject({ name: 'Tomato advisor' });
      expect(history.body.audit.map((a: { action: string }) => a.action)).toEqual([
        AiAuditAction.AssistantCreated,
        AiAuditAction.AssistantUpdated,
        AiAuditAction.AssistantActivated,
      ]);
    });

    it('offers only active assistants, and only to allowed roles', async () => {
      const draft = await createAssistant({ code: 'DRAFT_ONE' });
      const forFarmers = await activeAssistant({
        code: 'FARMERS_ONLY',
        allowedRoles: ['SMARTPHONE_FARMER', 'BASIC_PHONE_FARMER'],
      });
      const list = await ctx
        .http()
        .get(`${API}/ai/assistants`)
        .set(...as(farmer))
        .expect(200);
      expect(list.body.data.map((a: { code: string }) => a.code)).toEqual(['FARMERS_ONLY']);
      expect(list.body.data[0]).not.toHaveProperty('allowedRoles');

      const facilitatorList = await ctx
        .http()
        .get(`${API}/ai/assistants`)
        .set(...as(facilitator))
        .expect(200);
      expect(facilitatorList.body.data).toEqual([]);
      await ctx
        .http()
        .get(`${API}/ai/assistants/${forFarmers.id}`)
        .set(...as(facilitator))
        .expect(404);
      await ctx
        .http()
        .get(`${API}/ai/assistants/${draft.id}`)
        .set(...as(farmer))
        .expect(404);
    });

    it('blocks inactive and archived assistants, and freezes archived ones', async () => {
      const assistant = await activeAssistant();
      const conversation = await startConversation(farmer, assistant.id);
      await ctx
        .http()
        .post(`${API}/admin/ai/assistants/${assistant.id}/deactivate`)
        .set(...as(admin))
        .expect(200);
      await ctx
        .http()
        .post(`${API}/ai/conversations`)
        .set(...as(farmer))
        .send({ assistantId: assistant.id })
        .expect(409);
      await send(farmer, conversation.id, { content: 'Hello' }).expect(409);

      await ctx
        .http()
        .post(`${API}/admin/ai/assistants/${assistant.id}/archive`)
        .set(...as(admin))
        .expect(200);
      for (const action of ['activate', 'deactivate']) {
        await ctx
          .http()
          .post(`${API}/admin/ai/assistants/${assistant.id}/${action}`)
          .set(...as(admin))
          .expect(409);
      }
      await ctx
        .http()
        .patch(`${API}/admin/ai/assistants/${assistant.id}`)
        .set(...as(admin))
        .send({ name: 'Renamed' })
        .expect(409);
    });
  });

  // ---------------------------------------------------------------- models and configurations

  describe('model registry and configurations', () => {
    it('registers models without contacting them and without storing secrets', async () => {
      const model = await registerModel(
        { metadata: { region: 'eu', notes: 'descriptive' } },
        false,
      );
      expect(model).toMatchObject({
        provider: UNREGISTERED_PROVIDER,
        status: 'DRAFT',
        providerRegistered: false,
        metadata: { region: 'eu', notes: 'descriptive' },
      });

      const secretKey = await ctx
        .http()
        .post(`${API}/admin/ai/models`)
        .set(...as(admin))
        .send({
          provider: 'other',
          modelName: 'm',
          modelVersion: '1',
          displayName: 'M',
          capabilities: ['TEXT_GENERATION'],
          metadata: { auth: { apiKey: 'abc' } },
        })
        .expect(400);
      expect(JSON.stringify(secretKey.body)).not.toContain('abc');

      const secretValue = await ctx
        .http()
        .patch(`${API}/admin/ai/models/${model.id}`)
        .set(...as(admin))
        .send({ metadata: { note: 'sk-live0123456789abcdefghij' } })
        .expect(400);
      expect(JSON.stringify(secretValue.body)).not.toContain('sk-live');
      expect(await ctx.prisma.aiModel.count()).toBe(1);

      await ctx
        .http()
        .post(`${API}/admin/ai/models`)
        .set(...as(admin))
        .send({
          provider: UNREGISTERED_PROVIDER,
          modelName: 'example-model',
          modelVersion: '2026-01',
          displayName: 'Duplicate',
          capabilities: ['TEXT_GENERATION'],
        })
        .expect(409);
    });

    it('records model metadata history', async () => {
      const model = await registerModel({}, false);
      await ctx
        .http()
        .patch(`${API}/admin/ai/models/${model.id}`)
        .set(...as(admin))
        .send({ displayName: 'Renamed', contextWindowTokens: 8000, changeNote: 'Docs' })
        .expect(200);
      const history = await ctx
        .http()
        .get(`${API}/admin/ai/models/${model.id}/history`)
        .set(...as(admin))
        .expect(200);
      expect(history.body.versions).toHaveLength(2);
      expect(history.body.versions[0]).toMatchObject({
        version: 2,
        changeNote: 'Docs',
        snapshot: { displayName: 'Renamed', contextWindowTokens: 8000 },
      });
    });

    it('validates capabilities and distinct fallback models', async () => {
      const assistant = await createAssistant();
      const embedder = await registerModel({ modelName: 'embedder', capabilities: ['EMBEDDINGS'] });
      const writer = await registerModel({ modelName: 'writer' });
      const post = (body: Record<string, unknown>) =>
        ctx
          .http()
          .post(`${API}/admin/ai/model-configurations`)
          .set(...as(admin))
          .send({ assistantId: assistant.id, ...body });
      await post({ primaryModelId: embedder.id }).expect(400);
      await post({ primaryModelId: writer.id, fallbackModelId: writer.id }).expect(400);
      await post({ primaryModelId: writer.id, fallbackModelId: embedder.id }).expect(400);
      await post({ primaryModelId: writer.id, parameters: { token: 'x' } }).expect(400);
      const ok = await post({
        primaryModelId: writer.id,
        requiredCapabilities: ['TEXT_GENERATION'],
        parameters: { temperature: 0.2 },
      }).expect(201);
      expect(ok.body).toMatchObject({
        version: 1,
        status: 'INACTIVE',
        parameters: { temperature: 0.2 },
      });
    });

    it('never activates configurations that reference inactive or archived models', async () => {
      const assistant = await createAssistant();
      const draftModel = await registerModel({ modelName: 'draft' }, false);
      const created = await ctx
        .http()
        .post(`${API}/admin/ai/model-configurations`)
        .set(...as(admin))
        .send({ assistantId: assistant.id, primaryModelId: draftModel.id })
        .expect(201);
      await ctx
        .http()
        .post(`${API}/admin/ai/model-configurations/${created.body.id}/activate`)
        .set(...as(admin))
        .expect(409);

      const archived = await registerModel({ modelName: 'archived' });
      await ctx
        .http()
        .post(`${API}/admin/ai/models/${archived.id}/archive`)
        .set(...as(admin))
        .expect(200);
      await ctx
        .http()
        .post(`${API}/admin/ai/model-configurations`)
        .set(...as(admin))
        .send({ assistantId: assistant.id, primaryModelId: archived.id })
        .expect(400);
    });

    it('keeps one active configuration per assistant and protects models in use', async () => {
      const assistant = await createAssistant();
      const first = await registerModel({ modelName: 'first' });
      const second = await registerModel({ modelName: 'second' });
      const v1 = await configure(assistant.id, first.id);
      const v2 = await configure(assistant.id, second.id, { fallbackModelId: first.id });
      expect([v1.version, v2.version]).toEqual([1, 2]);

      const list = await ctx
        .http()
        .get(`${API}/admin/ai/model-configurations?assistantId=${assistant.id}`)
        .set(...as(admin))
        .expect(200);
      expect(
        list.body.data.map((c: { version: number; status: string }) => [c.version, c.status]),
      ).toEqual([
        [2, 'ACTIVE'],
        [1, 'INACTIVE'],
      ]);

      for (const action of ['deactivate', 'archive']) {
        await ctx
          .http()
          .post(`${API}/admin/ai/models/${first.id}/${action}`)
          .set(...as(admin))
          .expect(409);
      }
      await ctx
        .http()
        .patch(`${API}/admin/ai/models/${second.id}`)
        .set(...as(admin))
        .send({ capabilities: ['SUMMARIZATION'] })
        .expect(409);

      await ctx
        .http()
        .post(`${API}/admin/ai/model-configurations/${v2.id}/deactivate`)
        .set(...as(admin))
        .expect(200);
      await ctx
        .http()
        .post(`${API}/admin/ai/models/${first.id}/deactivate`)
        .set(...as(admin))
        .expect(200);
      expect(await auditActions(v2.id)).toEqual([
        AiAuditAction.ModelConfigurationCreated,
        AiAuditAction.ModelConfigurationActivated,
        AiAuditAction.ModelConfigurationDeactivated,
      ]);
    });
  });

  // ---------------------------------------------------------------- prompts and policies

  describe('prompt templates', () => {
    async function createPrompt(fields: Record<string, unknown> = {}) {
      return ctx
        .http()
        .post(`${API}/admin/ai/prompts`)
        .set(...as(admin))
        .send({
          code: 'TOMATO_SYSTEM',
          name: 'Tomato system prompt',
          category: 'CROP_GUIDANCE',
          language: 'en',
          content: 'You are {{assistantName}}. Reply in {{language}}.\nSources:\n{{context}}',
          ...fields,
        })
        .expect(201);
    }

    it('stores versions, keeps old ones and switches the default', async () => {
      const template = await createPrompt();
      expect(template.body).toMatchObject({
        status: 'DRAFT',
        latestVersionNumber: 1,
        defaultVersion: { versionNumber: 1, variables: ['assistantName', 'language', 'context'] },
      });
      const v1 = template.body.defaultVersionId;

      const v2 = await ctx
        .http()
        .post(`${API}/admin/ai/prompts/${template.body.id}/versions`)
        .set(...as(admin))
        .send({ content: 'Version two for {{assistantName}}', changeNote: 'Shorter' })
        .expect(201);
      expect(v2.body).toMatchObject({ versionNumber: 2, isDefault: false });

      await ctx
        .http()
        .post(`${API}/admin/ai/prompts/${template.body.id}/default-version`)
        .set(...as(admin))
        .send({ versionId: v2.body.id })
        .expect(200);
      const versions = await ctx
        .http()
        .get(`${API}/admin/ai/prompts/${template.body.id}/versions`)
        .set(...as(admin))
        .expect(200);
      expect(
        versions.body.map((v: { versionNumber: number; isDefault: boolean }) => [
          v.versionNumber,
          v.isDefault,
        ]),
      ).toEqual([
        [2, true],
        [1, false],
      ]);
      const old = await ctx
        .http()
        .get(`${API}/admin/ai/prompts/${template.body.id}/versions/${v1}`)
        .set(...as(admin))
        .expect(200);
      expect(old.body.content).toContain('Sources:');

      const other = await createPrompt({ code: 'OTHER' });
      await ctx
        .http()
        .post(`${API}/admin/ai/prompts/${template.body.id}/default-version`)
        .set(...as(admin))
        .send({ versionId: other.body.defaultVersionId })
        .expect(400);
    });

    it('updates metadata only, and freezes archived templates', async () => {
      const template = await createPrompt();
      await ctx
        .http()
        .patch(`${API}/admin/ai/prompts/${template.body.id}`)
        .set(...as(admin))
        .send({ content: 'sneaky' })
        .expect(400);
      await ctx
        .http()
        .post(`${API}/admin/ai/prompts/${template.body.id}/activate`)
        .set(...as(admin))
        .expect(200);
      await ctx
        .http()
        .post(`${API}/admin/ai/prompts/${template.body.id}/archive`)
        .set(...as(admin))
        .expect(200);
      await ctx
        .http()
        .post(`${API}/admin/ai/prompts/${template.body.id}/versions`)
        .set(...as(admin))
        .send({ content: 'new' })
        .expect(409);
      expect(await ctx.prisma.aiPromptVersion.count()).toBe(1);
      await ctx
        .http()
        .post(`${API}/admin/ai/prompts`)
        .set(...as(admin))
        .send({ code: 'BAD', name: 'Bad', category: 'MAGIC', language: 'en', content: 'x' })
        .expect(400);
    });

    it('links templates to assistants with optional pinned versions', async () => {
      const assistant = await createAssistant();
      const a = await createPrompt({ code: 'PROMPT_A' });
      const b = await createPrompt({ code: 'PROMPT_B' });
      const res = await ctx
        .http()
        .put(`${API}/admin/ai/assistants/${assistant.id}/prompts`)
        .set(...as(admin))
        .send({
          prompts: [
            { templateId: b.body.id, position: 1 },
            { templateId: a.body.id, pinnedVersionId: a.body.defaultVersionId, position: 0 },
          ],
        })
        .expect(200);
      expect(res.body.prompts.map((p: { code: string }) => p.code)).toEqual([
        'PROMPT_A',
        'PROMPT_B',
      ]);
      expect(res.body.currentVersion).toBe(2);
      await ctx
        .http()
        .put(`${API}/admin/ai/assistants/${assistant.id}/prompts`)
        .set(...as(admin))
        .send({ prompts: [{ templateId: a.body.id, pinnedVersionId: b.body.defaultVersionId }] })
        .expect(400);
    });
  });

  describe('safety policies', () => {
    it('versions rule changes and keeps metadata edits in place', async () => {
      const created = await ctx
        .http()
        .post(`${API}/admin/ai/safety-policies`)
        .set(...as(admin))
        .send({
          code: 'PESTICIDE_CAUTION',
          name: 'Pesticide caution',
          category: 'CHEMICAL_USAGE',
          instructions: 'Refer pesticide questions to an agronomist.',
          restrictions: ['Do not state pesticide doses'],
          triggerKeywords: ['pesticide', ' umuti '],
          requiresEscalation: true,
          escalationGuidance: 'Contact the sector agronomist.',
        })
        .expect(201);
      expect(created.body).toMatchObject({
        status: 'DRAFT',
        latestVersionNumber: 1,
        currentVersion: { versionNumber: 1, triggerKeywords: ['pesticide', 'umuti'] },
      });
      const id = created.body.id;

      await ctx
        .http()
        .patch(`${API}/admin/ai/safety-policies/${id}`)
        .set(...as(admin))
        .send({ name: 'Pesticide safety' })
        .expect(200);
      const ruled = await ctx
        .http()
        .patch(`${API}/admin/ai/safety-policies/${id}`)
        .set(...as(admin))
        .send({ triggerKeywords: ['pesticide', 'herbicide'], changeNote: 'Add herbicide' })
        .expect(200);
      expect(ruled.body).toMatchObject({
        name: 'Pesticide safety',
        latestVersionNumber: 2,
        currentVersion: {
          versionNumber: 2,
          instructions: 'Refer pesticide questions to an agronomist.',
          triggerKeywords: ['pesticide', 'herbicide'],
          requiresEscalation: true,
        },
      });
      const versions = await ctx
        .http()
        .get(`${API}/admin/ai/safety-policies/${id}/versions`)
        .set(...as(admin))
        .expect(200);
      expect(versions.body.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);

      for (const action of ['activate', 'deactivate', 'archive']) {
        await ctx
          .http()
          .post(`${API}/admin/ai/safety-policies/${id}/${action}`)
          .set(...as(admin))
          .expect(200);
      }
      await ctx
        .http()
        .patch(`${API}/admin/ai/safety-policies/${id}`)
        .set(...as(admin))
        .send({ name: 'x' })
        .expect(409);
      await ctx
        .http()
        .post(`${API}/admin/ai/safety-policies`)
        .set(...as(admin))
        .send({ code: 'NO_TEXT', name: 'No text', category: 'GENERAL_SAFETY' })
        .expect(400);
      expect(await auditActions(id)).toEqual([
        AiAuditAction.SafetyPolicyCreated,
        AiAuditAction.SafetyPolicyUpdated,
        AiAuditAction.SafetyPolicyUpdated,
        AiAuditAction.SafetyPolicyActivated,
        AiAuditAction.SafetyPolicyDeactivated,
        AiAuditAction.SafetyPolicyArchived,
      ]);
    });
  });

  // ---------------------------------------------------------------- conversations

  describe('conversations', () => {
    it('starts, lists, renames and archives own conversations', async () => {
      const assistant = await activeAssistant();
      await ctx
        .http()
        .post(`${API}/ai/conversations`)
        .set(...as(farmer))
        .send({ assistantId: assistant.id, language: 'fr' })
        .expect(400);
      const conversation = await startConversation(farmer, assistant.id, { language: 'rw' });
      expect(conversation).toMatchObject({
        language: 'rw',
        status: 'ACTIVE',
        messageCount: 0,
        userId: farmer.id,
        assistant: { code: 'TOMATO_ADVISOR' },
      });
      await startConversation(otherFarmer, assistant.id);

      const mine = await ctx
        .http()
        .get(`${API}/ai/conversations`)
        .set(...as(farmer))
        .expect(200);
      expect(mine.body.data.map((c: { id: string }) => c.id)).toEqual([conversation.id]);

      const renamed = await ctx
        .http()
        .patch(`${API}/ai/conversations/${conversation.id}`)
        .set(...as(farmer))
        .send({ title: 'Leaf spots' })
        .expect(200);
      expect(renamed.body.title).toBe('Leaf spots');

      const archived = await ctx
        .http()
        .post(`${API}/ai/conversations/${conversation.id}/archive`)
        .set(...as(farmer))
        .expect(200);
      expect(archived.body).toMatchObject({ status: 'ARCHIVED', archivedAt: expect.any(String) });
      await send(farmer, conversation.id, { content: 'Still there?' }).expect(409);
      const archivedOnly = await ctx
        .http()
        .get(`${API}/ai/conversations?status=ARCHIVED`)
        .set(...as(farmer))
        .expect(200);
      expect(archivedOnly.body.meta.total).toBe(1);
    });

    it("hides other users' conversations and requests", async () => {
      const assistant = await activeAssistant();
      const conversation = await startConversation(farmer, assistant.id);
      const posted = await send(farmer, conversation.id, { content: 'Hello' }).expect(201);
      const requestId = posted.body.request.id;

      for (const user of [otherFarmer, facilitator]) {
        await ctx
          .http()
          .get(`${API}/ai/conversations/${conversation.id}`)
          .set(...as(user))
          .expect(404);
        await ctx
          .http()
          .get(`${API}/ai/conversations/${conversation.id}/messages`)
          .set(...as(user))
          .expect(404);
        await send(user, conversation.id, { content: 'Intrusion' }).expect(404);
        await ctx
          .http()
          .patch(`${API}/ai/conversations/${conversation.id}`)
          .set(...as(user))
          .send({ title: 'Mine now' })
          .expect(404);
        await ctx
          .http()
          .get(`${API}/ai/requests/${requestId}`)
          .set(...as(user))
          .expect(404);
        await ctx
          .http()
          .post(`${API}/ai/requests/${requestId}/cancel`)
          .set(...as(user))
          .expect(404);
      }
      await ctx
        .http()
        .get(`${API}/ai/requests/${requestId}`)
        .set(...as(farmer))
        .expect(200);
    });

    it('lets administrators oversee conversations, with an audit entry', async () => {
      const assistant = await activeAssistant();
      const conversation = await startConversation(farmer, assistant.id);
      await send(farmer, conversation.id, { content: 'Hello' }).expect(201);
      const list = await ctx
        .http()
        .get(`${API}/admin/ai/conversations?userId=${farmer.id}`)
        .set(...as(admin))
        .expect(200);
      expect(list.body.meta.total).toBe(1);
      const detail = await ctx
        .http()
        .get(`${API}/admin/ai/conversations/${conversation.id}`)
        .set(...as(admin))
        .expect(200);
      expect(detail.body.messages).toHaveLength(1);
      expect(await auditActions(conversation.id)).toEqual([AiAuditAction.ConversationViewed]);
    });

    it('stores messages in chronological order with unique sequence numbers', async () => {
      const assistant = await activeAssistant();
      const conversation = await startConversation(farmer, assistant.id);
      await send(farmer, conversation.id, { content: 'First' }).expect(201);
      await Promise.all(
        ['A', 'B', 'C', 'D'].map((content) =>
          send(farmer, conversation.id, { content }).expect(201),
        ),
      );
      await send(farmer, conversation.id, { content: 'Last' }).expect(201);

      const messages = await ctx
        .http()
        .get(`${API}/ai/conversations/${conversation.id}/messages?limit=100`)
        .set(...as(farmer))
        .expect(200);
      const sequences = messages.body.data.map((m: { sequence: number }) => m.sequence);
      expect(sequences).toEqual([1, 2, 3, 4, 5, 6]);
      expect(messages.body.data[0]).toMatchObject({ content: 'First', role: AiMessageRole.USER });
      expect(messages.body.data[5].content).toBe('Last');
      const detail = await ctx
        .http()
        .get(`${API}/ai/conversations/${conversation.id}`)
        .set(...as(farmer))
        .expect(200);
      expect(detail.body.messageCount).toBe(6);
    });

    it('validates message input and treats a repeated clientRequestId as the same message', async () => {
      const { assistant } = await readyAssistant();
      const conversation = await startConversation(farmer, assistant.id);
      await send(farmer, conversation.id, { content: '' }).expect(400);
      await send(farmer, conversation.id, { content: 'x'.repeat(4001) }).expect(400);
      await send(farmer, conversation.id, { content: 'Hi', role: 'ASSISTANT' }).expect(400);
      await send(farmer, conversation.id, { content: 'Hi', language: 'fr' }).expect(400);
      await send(farmer, conversation.id, { content: 'Hi', clientRequestId: 'bad id!' }).expect(
        400,
      );

      const first = await send(farmer, conversation.id, {
        content: 'Hello',
        clientRequestId: 'device-1:42',
      }).expect(201);
      const again = await send(farmer, conversation.id, {
        content: 'Hello',
        clientRequestId: 'device-1:42',
      }).expect(201);
      expect(again.body.duplicate).toBe(true);
      expect(again.body.message.id).toBe(first.body.message.id);
      expect(again.body.request.id).toBe(first.body.request.id);
      expect(aiQueue().add).toHaveBeenCalledTimes(1);
      expect(await ctx.prisma.aiMessage.count()).toBe(1);
    });
  });

  // ---------------------------------------------------------------- request lifecycle

  describe('AI requests without a provider', () => {
    it('fails immediately when the assistant has no active model configuration', async () => {
      const assistant = await activeAssistant();
      const conversation = await startConversation(farmer, assistant.id);
      const res = await send(farmer, conversation.id, { content: 'Hello' }).expect(201);
      expect(res.body.execution).toEqual({
        providerConfigured: false,
        message: 'No AI provider is configured; no AI response will be generated.',
      });
      expect(res.body.request).toMatchObject({
        status: AiRequestStatus.FAILED,
        errorCode: 'AI_MODEL_CONFIGURATION_MISSING',
        assistantMessageId: null,
      });
      expect(aiQueue().add).not.toHaveBeenCalled();
    });

    it('queues the request and fails it safely with AI_PROVIDER_NOT_CONFIGURED', async () => {
      const { assistant, model, configuration } = await readyAssistant();
      expect(model.providerRegistered).toBe(false);
      const conversation = await startConversation(farmer, assistant.id);
      const res = await send(farmer, conversation.id, {
        content: 'Why are my leaves yellow?',
      }).expect(201);
      expect(res.body.execution.providerConfigured).toBe(false);
      expect(res.body.message).toMatchObject({ sequence: 1, role: 'USER', isTestData: false });
      expect(res.body.request).toMatchObject({
        status: AiRequestStatus.QUEUED,
        userMessageId: res.body.message.id,
        queuedAt: expect.any(String),
      });
      const requestId = res.body.request.id;
      expect(aiQueue().add).toHaveBeenCalledWith(
        'generate',
        { requestId },
        expect.objectContaining({ jobId: requestId, attempts: 3 }),
      );

      const [outcome] = await drainAiQueue(ctx);
      expect(outcome).toEqual({
        status: AiRequestStatus.FAILED,
        errorCode: 'AI_PROVIDER_NOT_CONFIGURED',
      });

      const status = await ctx
        .http()
        .get(`${API}/ai/requests/${requestId}`)
        .set(...as(farmer))
        .expect(200);
      expect(status.body).toMatchObject({
        status: AiRequestStatus.FAILED,
        errorCode: 'AI_PROVIDER_NOT_CONFIGURED',
        errorMessage: 'No AI provider is configured for this assistant; no response was generated.',
        assistantMessageId: null,
        references: [],
        validations: [],
        attempts: 1,
      });
      expect(status.body).not.toHaveProperty('usage');
      expect(await ctx.prisma.aiMessage.count({ where: { role: AiMessageRole.ASSISTANT } })).toBe(
        0,
      );
      expect(provider.calls).toHaveLength(0);

      const usage = await ctx.prisma.aiUsageRecord.findUniqueOrThrow({ where: { requestId } });
      expect(usage).toMatchObject({
        status: AiUsageStatus.NOT_AVAILABLE,
        provider: UNREGISTERED_PROVIDER,
        modelId: model.id,
        modelConfigurationId: configuration.id,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        estimatedCost: null,
        currency: null,
      });

      const orchestrator = ctx.app.get(AiOrchestratorService);
      await expect(
        orchestrator.execute(requestId, { attempt: 2, maxAttempts: 3 }),
      ).resolves.toEqual({
        status: AiRequestStatus.FAILED,
        skipped: true,
      });
      expect(await ctx.prisma.aiUsageRecord.count()).toBe(1);
    });

    it('cancels queued requests, which the worker then skips', async () => {
      const { assistant } = await readyAssistant();
      const conversation = await startConversation(farmer, assistant.id);
      const res = await send(farmer, conversation.id, { content: 'Hello' }).expect(201);
      const cancelled = await ctx
        .http()
        .post(`${API}/ai/requests/${res.body.request.id}/cancel`)
        .set(...as(farmer))
        .expect(200);
      expect(cancelled.body).toMatchObject({ status: AiRequestStatus.CANCELLED });
      const [outcome] = await drainAiQueue(ctx);
      expect(outcome).toEqual({ status: AiRequestStatus.CANCELLED, skipped: true });

      const failed = await send(farmer, conversation.id, { content: 'Again' }).expect(201);
      await drainAiQueue(ctx);
      await ctx
        .http()
        .post(`${API}/ai/requests/${failed.body.request.id}/cancel`)
        .set(...as(farmer))
        .expect(409);
    });

    it('records the prompt and policy versions in effect when the message was sent', async () => {
      const { assistant } = await readyAssistant();
      const template = await ctx
        .http()
        .post(`${API}/admin/ai/prompts`)
        .set(...as(admin))
        .send({
          code: 'SYS',
          name: 'System',
          category: 'SYSTEM',
          language: 'en',
          content: 'Be brief.',
        })
        .expect(201);
      await ctx
        .http()
        .post(`${API}/admin/ai/prompts/${template.body.id}/activate`)
        .set(...as(admin))
        .expect(200);
      await ctx
        .http()
        .put(`${API}/admin/ai/assistants/${assistant.id}/prompts`)
        .set(...as(admin))
        .send({ prompts: [{ templateId: template.body.id }] })
        .expect(200);
      const policy = await ctx
        .http()
        .post(`${API}/admin/ai/safety-policies`)
        .set(...as(admin))
        .send({
          code: 'GENERAL',
          name: 'General',
          category: 'GENERAL_SAFETY',
          instructions: 'Be safe.',
        })
        .expect(201);
      await ctx
        .http()
        .post(`${API}/admin/ai/safety-policies/${policy.body.id}/activate`)
        .set(...as(admin))
        .expect(200);

      const conversation = await startConversation(farmer, assistant.id);
      const res = await send(farmer, conversation.id, { content: 'Hello' }).expect(201);
      const detail = await ctx
        .http()
        .get(`${API}/admin/ai/requests/${res.body.request.id}`)
        .set(...as(admin))
        .expect(200);
      expect(detail.body).toMatchObject({
        userId: farmer.id,
        promptVersionIds: [template.body.defaultVersionId],
        policyVersionIds: [policy.body.currentVersion.id],
      });
      expect(await auditActions(res.body.request.id)).toEqual([AiAuditAction.RequestViewed]);
    });
  });

  // ---------------------------------------------------------------- orchestration with test doubles

  describe('orchestration with a test-double provider (test data only)', () => {
    const UNCITED = '[TEST FIXTURE] Fixed test output without citations.';

    it('stores test output as test data, with validation and reported usage', async () => {
      const { assistant, model } = await readyAssistant({ provider: TEST_AI_PROVIDER_ID });
      expect(model.providerRegistered).toBe(true);
      const conversation = await startConversation(farmer, assistant.id);
      const res = await send(farmer, conversation.id, {
        content: 'How do I water tomatoes?',
      }).expect(201);
      expect(res.body.execution.providerConfigured).toBe(true);
      provider.respondWith({ content: UNCITED, usage: { inputTokens: 11, outputTokens: 7 } });

      const [outcome] = await drainAiQueue(ctx);
      expect(outcome).toEqual({ status: AiRequestStatus.COMPLETED });
      expect(provider.calls[0].prompt.messages.at(-1)).toEqual({
        role: 'user',
        content: 'How do I water tomatoes?',
      });

      const messages = await ctx
        .http()
        .get(`${API}/ai/conversations/${conversation.id}/messages`)
        .set(...as(farmer))
        .expect(200);
      expect(messages.body.data).toHaveLength(2);
      expect(messages.body.data[1]).toMatchObject({
        sequence: 2,
        role: 'ASSISTANT',
        content: UNCITED,
        isTestData: true,
        requestId: res.body.request.id,
        metadata: { generatedBy: 'TEST_DOUBLE', references: [], validationStatus: 'PASSED' },
      });

      const request = await ctx
        .http()
        .get(`${API}/admin/ai/requests/${res.body.request.id}`)
        .set(...as(admin))
        .expect(200);
      expect(request.body).toMatchObject({
        status: AiRequestStatus.COMPLETED,
        assistantMessageId: messages.body.data[1].id,
        metadata: { retrievalStatus: 'DISABLED', testDouble: true },
        validations: [{ status: AiValidationStatus.PASSED, requiresEscalation: false }],
      });
      // Only figures the provider reported are kept; the missing total is not derived.
      expect(request.body.usage).toMatchObject({
        status: AiUsageStatus.RECORDED,
        provider: TEST_AI_PROVIDER_ID,
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: null,
        estimatedCost: null,
        currency: null,
      });
    });

    it('withholds responses that fail validation', async () => {
      const { assistant } = await readyAssistant({ provider: TEST_AI_PROVIDER_ID });
      const conversation = await startConversation(farmer, assistant.id);
      const res = await send(farmer, conversation.id, { content: 'Hello' }).expect(201);
      provider.respondWith({ content: 'As stated in [4], ...' });
      const [outcome] = await drainAiQueue(ctx);
      expect(outcome).toEqual({
        status: AiRequestStatus.FAILED,
        errorCode: 'AI_RESPONSE_VALIDATION_FAILED',
      });
      expect(await ctx.prisma.aiMessage.count({ where: { role: AiMessageRole.ASSISTANT } })).toBe(
        0,
      );
      const status = await ctx
        .http()
        .get(`${API}/ai/requests/${res.body.request.id}`)
        .set(...as(farmer))
        .expect(200);
      expect(status.body.validations[0]).toMatchObject({
        status: AiValidationStatus.FAILED,
        warningCodes: ['UNKNOWN_SOURCE_REFERENCE'],
      });
    });

    it('flags safety policy escalation on the stored answer', async () => {
      const { assistant } = await readyAssistant({ provider: TEST_AI_PROVIDER_ID });
      const policy = await ctx
        .http()
        .post(`${API}/admin/ai/safety-policies`)
        .set(...as(admin))
        .send({
          code: 'PESTICIDE',
          name: 'Pesticides',
          category: 'PEST_CONTROL',
          instructions: 'Refer pesticide questions to an agronomist.',
          triggerKeywords: ['pesticide'],
          requiresEscalation: true,
        })
        .expect(201);
      await ctx
        .http()
        .post(`${API}/admin/ai/safety-policies/${policy.body.id}/activate`)
        .set(...as(admin))
        .expect(200);
      const conversation = await startConversation(farmer, assistant.id);
      await send(farmer, conversation.id, { content: 'Which pesticide should I spray?' }).expect(
        201,
      );
      provider.respondWith({ content: UNCITED });
      await drainAiQueue(ctx);

      expect(provider.calls[0].prompt.system).toContain(
        'Refer pesticide questions to an agronomist.',
      );
      const answer = await ctx.prisma.aiMessage.findFirstOrThrow({
        where: { role: AiMessageRole.ASSISTANT },
        include: { validations: true },
      });
      expect(answer.metadata).toMatchObject({ requiresEscalation: true });
      expect(answer.validations[0]).toMatchObject({
        status: AiValidationStatus.WARNING,
        requiresEscalation: true,
        warningCodes: ['POLICY_TRIGGERED', 'HUMAN_ESCALATION_REQUIRED'],
      });
    });

    it('retries transient provider errors and does not retry permanent ones', async () => {
      const { assistant } = await readyAssistant({ provider: TEST_AI_PROVIDER_ID });
      const conversation = await startConversation(farmer, assistant.id);
      const first = await send(farmer, conversation.id, { content: 'One' }).expect(201);
      provider.failWith('timeout', true);
      const [transient] = await drainAiQueue(ctx, { attempt: 1 });
      expect(transient).toBeInstanceOf(Error);
      expect(
        await ctx.prisma.aiRequest.findUniqueOrThrow({ where: { id: first.body.request.id } }),
      ).toMatchObject({
        status: AiRequestStatus.QUEUED,
        errorCode: 'AI_PROVIDER_ERROR',
        attempts: 1,
      });

      provider.respondWith({ content: UNCITED });
      const orchestrator = ctx.app.get(AiOrchestratorService);
      await expect(
        orchestrator.execute(first.body.request.id, { attempt: 2, maxAttempts: 3 }),
      ).resolves.toEqual({ status: AiRequestStatus.COMPLETED });
      expect(
        await ctx.prisma.aiRequest.findUniqueOrThrow({ where: { id: first.body.request.id } }),
      ).toMatchObject({ status: AiRequestStatus.COMPLETED, errorCode: null, attempts: 2 });

      const second = await send(farmer, conversation.id, { content: 'Two' }).expect(201);
      provider.failWith('invalid request', false);
      const [permanent] = await drainAiQueue(ctx, { attempt: 1 });
      expect(permanent).toEqual({ status: AiRequestStatus.FAILED, errorCode: 'AI_PROVIDER_ERROR' });

      const third = await send(farmer, conversation.id, { content: 'Three' }).expect(201);
      provider.failWith('still timing out', true);
      const [exhausted] = await drainAiQueue(ctx, { attempt: 3 });
      expect(exhausted).toEqual({ status: AiRequestStatus.FAILED, errorCode: 'AI_PROVIDER_ERROR' });
      expect(
        (
          await ctx.prisma.aiRequest.findMany({
            where: { id: { in: [second.body.request.id, third.body.request.id] } },
          })
        ).map((r) => r.status),
      ).toEqual([AiRequestStatus.FAILED, AiRequestStatus.FAILED]);
    });

    it('falls back to the fallback model after a permanent primary failure', async () => {
      const assistant = await activeAssistant();
      const primary = await registerModel({ provider: TEST_AI_PROVIDER_ID, modelName: 'primary' });
      const fallback = await registerModel({
        provider: TEST_AI_PROVIDER_ID,
        modelName: 'fallback',
      });
      await configure(assistant.id, primary.id, { fallbackModelId: fallback.id });
      const conversation = await startConversation(farmer, assistant.id);
      const res = await send(farmer, conversation.id, { content: 'Hello' }).expect(201);
      provider.failWith('primary rejected', false).respondWith({ content: UNCITED });
      const [outcome] = await drainAiQueue(ctx);
      expect(outcome).toEqual({ status: AiRequestStatus.COMPLETED });
      expect(provider.calls.map((call) => call.model.id)).toEqual([primary.id, fallback.id]);
      const usage = await ctx.prisma.aiUsageRecord.findUniqueOrThrow({
        where: { requestId: res.body.request.id },
      });
      expect(usage.modelId).toBe(fallback.id);
    });

    it('fails queued requests whose assistant was deactivated meanwhile', async () => {
      const { assistant } = await readyAssistant({ provider: TEST_AI_PROVIDER_ID });
      const conversation = await startConversation(farmer, assistant.id);
      await send(farmer, conversation.id, { content: 'Hello' }).expect(201);
      await ctx
        .http()
        .post(`${API}/admin/ai/assistants/${assistant.id}/deactivate`)
        .set(...as(admin))
        .expect(200);
      const [outcome] = await drainAiQueue(ctx);
      expect(outcome).toEqual({
        status: AiRequestStatus.FAILED,
        errorCode: 'AI_ASSISTANT_UNAVAILABLE',
      });
      expect(provider.calls).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------- knowledge retrieval

  describe('knowledge retrieval and source references', () => {
    async function uploadSource(title: string, text: string) {
      const res = await ctx
        .http()
        .post(`${API}/knowledge/sources`)
        .set(...as(admin))
        .field('title', title)
        .field('sourceType', 'TXT')
        .field('language', 'en')
        .field('cropIds', tomatoId)
        .attach('file', Buffer.from(text), `${title}.txt`)
        .expect(201);
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${res.body.id}/process`)
        .set(...as(admin))
        .send({})
        .expect(202);
      await drainKnowledgeQueue(ctx);
      return res.body.id as string;
    }

    async function approvedSource() {
      const id = await uploadSource('Tomato guide', GUIDE);
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${id}/submit-review`)
        .set(...as(admin))
        .expect(200);
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${id}/approve`)
        .set(...as(admin))
        .send({})
        .expect(200);
      return id;
    }

    async function activateEmbeddings() {
      const created = await ctx
        .http()
        .post(`${API}/knowledge/embedding-configurations`)
        .set(...as(admin))
        .send({ name: 'Test', provider: TEST_EMBEDDING_PROVIDER_ID, model: 'fixed', dimensions: 4 })
        .expect(201);
      await ctx
        .http()
        .post(`${API}/knowledge/embedding-configurations/${created.body.id}/activate`)
        .set(...as(admin))
        .expect(200);
    }

    const knowledgeAssistant = {
      knowledgeAccess: true,
      requireSourceReferences: true,
      maxKnowledgeChunks: 3,
    };

    it('does not invent context when vector search is unavailable', async () => {
      await approvedSource();
      const { assistant } = await readyAssistant({
        provider: TEST_AI_PROVIDER_ID,
        assistant: knowledgeAssistant,
      });
      const conversation = await startConversation(farmer, assistant.id);
      const res = await send(farmer, conversation.id, { content: 'How do I water?' }).expect(201);
      const [outcome] = await drainAiQueue(ctx);
      expect(outcome).toEqual({
        status: AiRequestStatus.FAILED,
        errorCode: 'AI_KNOWLEDGE_UNAVAILABLE',
      });
      expect(provider.calls).toHaveLength(0);
      const status = await ctx
        .http()
        .get(`${API}/ai/requests/${res.body.request.id}`)
        .set(...as(farmer))
        .expect(200);
      expect(status.body.references).toEqual([]);
    });

    it('uses and cites approved chunks only', async () => {
      const approvedId = await approvedSource();
      const draftId = await uploadSource('Draft notes', DRAFT_GUIDE);
      const approvedChunks = await ctx.prisma.knowledgeChunk.findMany({
        where: { sourceId: approvedId },
        orderBy: { chunkIndex: 'asc' },
      });
      const draftChunks = await ctx.prisma.knowledgeChunk.findMany({
        where: { sourceId: draftId },
      });
      expect(approvedChunks.length).toBeGreaterThan(0);
      expect(draftChunks.length).toBeGreaterThan(0);
      await activateEmbeddings();
      vectorStore.candidates = [
        { chunkId: draftChunks[0].id, score: 0.99 },
        { chunkId: approvedChunks[0].id, score: 0.9 },
        { chunkId: '00000000-0000-4000-8000-000000000000', score: 0.85 },
      ];

      const { assistant } = await readyAssistant({
        provider: TEST_AI_PROVIDER_ID,
        assistant: knowledgeAssistant,
      });
      const conversation = await startConversation(farmer, assistant.id);
      const res = await send(farmer, conversation.id, { content: 'How do I water?' }).expect(201);
      const [outcome] = await drainAiQueue(ctx);
      expect(outcome).toEqual({ status: AiRequestStatus.COMPLETED });

      const system = provider.calls[0].prompt.system;
      expect(system).not.toContain('UNAPPROVED-MARKER');
      const status = await ctx
        .http()
        .get(`${API}/ai/requests/${res.body.request.id}`)
        .set(...as(farmer))
        .expect(200);
      expect(status.body.references).toEqual([
        {
          rank: 1,
          sourceId: approvedId,
          versionId: approvedChunks[0].versionId,
          documentId: approvedChunks[0].documentId,
          chunkId: approvedChunks[0].id,
          sourceTitle: 'Tomato guide',
          pageNumber: approvedChunks[0].pageNumber,
          pageEnd: null,
          sectionTitle: approvedChunks[0].sectionTitle,
          relevanceScore: 0.9,
        },
      ]);
      const answer = await ctx.prisma.aiMessage.findFirstOrThrow({
        where: { role: AiMessageRole.ASSISTANT },
      });
      expect(answer).toMatchObject({ content: TEST_FIXTURE_RESPONSE, isTestData: true });
      expect(
        await ctx.prisma.aiRequestKnowledgeReference.count({ where: { sourceId: draftId } }),
      ).toBe(0);
    });
  });

  // ---------------------------------------------------------------- usage

  describe('usage reporting', () => {
    it('lists usage and sums only reported figures', async () => {
      const unconfigured = await readyAssistant();
      const conversation = await startConversation(farmer, unconfigured.assistant.id);
      await send(farmer, conversation.id, { content: 'Hello' }).expect(201);
      await drainAiQueue(ctx);

      const empty = await ctx
        .http()
        .get(`${API}/admin/ai/usage/summary`)
        .set(...as(admin))
        .expect(200);
      expect(empty.body).toMatchObject({
        records: 1,
        recorded: 0,
        notAvailable: 1,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costs: [],
        byProvider: [{ key: UNREGISTERED_PROVIDER, records: 1, totalTokens: null }],
      });

      const tested = await readyAssistant({
        provider: TEST_AI_PROVIDER_ID,
        assistant: { code: 'TESTED' },
      });
      const other = await startConversation(farmer, tested.assistant.id);
      await send(farmer, other.id, { content: 'Hello' }).expect(201);
      provider.respondWith({
        content: '[TEST FIXTURE] ok',
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8, cost: 0.0012, currency: 'USD' },
      });
      await drainAiQueue(ctx);

      const summary = await ctx
        .http()
        .get(`${API}/admin/ai/usage/summary`)
        .set(...as(admin))
        .expect(200);
      expect(summary.body).toMatchObject({
        records: 2,
        recorded: 1,
        notAvailable: 1,
        inputTokens: 5,
        totalTokens: 8,
        costs: [{ currency: 'USD', amount: '0.001200' }],
      });
      const filtered = await ctx
        .http()
        .get(`${API}/admin/ai/usage?status=NOT_AVAILABLE`)
        .set(...as(admin))
        .expect(200);
      expect(filtered.body.data).toHaveLength(1);
      expect(filtered.body.data[0]).toMatchObject({
        assistantId: unconfigured.assistant.id,
        inputTokens: null,
        estimatedCost: null,
      });
      await ctx
        .http()
        .get(`${API}/admin/ai/usage?status=BOGUS`)
        .set(...as(admin))
        .expect(400);
    });
  });
});
