import { UnrecoverableError } from 'bullmq';
import {
  EmbeddingStatus,
  KnowledgeJobStatus,
  KnowledgeSourceStatus,
  KnowledgeStage,
} from '../../src/generated/prisma/client';
import { QueueName } from '../../src/infrastructure/queue/queue.constants';
import { KnowledgeJobsService } from '../../src/modules/knowledge/pipeline/knowledge-jobs.service';
import { KnowledgePipelineService } from '../../src/modules/knowledge/pipeline/knowledge-pipeline.service';
import { RoleCode } from '../../src/modules/roles/rbac.constants';
import { buildDocx, buildPdf } from '../fixtures/documents';
import {
  API,
  bearer,
  createTestContext,
  drainKnowledgeQueue,
  resetDatabase,
  seedAndLogin,
  skipQueuedKnowledgeJobs,
  type LoginResult,
  type SeededUser,
  type TestContext,
} from './helpers';

const GUIDE = [
  'Land preparation',
  'Dig the field to a depth of 30 cm two weeks before planting. Remove stones and old roots so tomato roots can spread. Mix compost into the soil while digging.',
  '',
  'Irrigation',
  'Water tomatoes early in the morning so leaves dry before evening. Drip lines save water and keep the leaves dry, which lowers disease. Check soil moisture with a finger every day.',
  'During flowering, the plants need steady watering. Dry soil followed by heavy watering cracks the fruit. Mulch keeps the moisture in the soil for longer.',
  'In the dry season, give each plant about two litres of water every second day. Water at the base of the stem and never over the leaves. Clean the drip lines every week so they do not block.',
  '',
  'Harvesting',
  'Harvest tomatoes when they start to turn red. Pick in the cool morning and keep the fruit in the shade.',
].join('\n');

describe('Knowledge base and RAG foundation (integration)', () => {
  let ctx: TestContext;
  let admin: SeededUser & LoginResult;
  let facilitator: SeededUser & LoginResult;
  let farmer: SeededUser & LoginResult;
  let tomatoId: string;
  let irrigationId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    skipQueuedKnowledgeJobs(ctx);
    admin = await seedAndLogin(ctx, [RoleCode.Admin]);
    facilitator = await seedAndLogin(ctx, [RoleCode.Facilitator]);
    farmer = await seedAndLogin(ctx, [RoleCode.SmartphoneFarmer]);
    tomatoId = (await ctx.prisma.crop.findUniqueOrThrow({ where: { code: 'TOMATO' } })).id;
    irrigationId = (
      await ctx.prisma.knowledgeTopic.findUniqueOrThrow({ where: { code: 'IRRIGATION' } })
    ).id;
  });

  const asAdmin = () => bearer(admin.accessToken);

  function upload(
    file: { bytes: Buffer; name: string },
    fields: Record<string, string> = {},
    token = admin.accessToken,
  ) {
    let req = ctx
      .http()
      .post(`${API}/knowledge/sources`)
      .set(...bearer(token));
    const all = { title: 'Tomato growing guide', sourceType: 'TXT', language: 'en', ...fields };
    for (const [key, value] of Object.entries(all)) req = req.field(key, value);
    return req.attach('file', file.bytes, file.name);
  }

  async function createTxtSource(fields: Record<string, string> = {}, text = GUIDE) {
    const res = await upload(
      { bytes: Buffer.from(text), name: 'guide.txt' },
      { cropIds: tomatoId, ...fields },
    );
    expect([res.status, res.status === 201 ? null : res.body]).toEqual([201, null]);
    return res.body as { id: string; latestVersion: { id: string; storageRef: string } };
  }

  async function processSource(id: string) {
    await ctx
      .http()
      .post(`${API}/knowledge/sources/${id}/process`)
      .set(...asAdmin())
      .send({})
      .expect(202);
    await drainKnowledgeQueue(ctx);
  }

  async function approvedSource(fields: Record<string, string> = {}, text = GUIDE) {
    const source = await createTxtSource(fields, text);
    await processSource(source.id);
    await ctx
      .http()
      .post(`${API}/knowledge/sources/${source.id}/submit-review`)
      .set(...asAdmin())
      .expect(200);
    await ctx
      .http()
      .post(`${API}/knowledge/sources/${source.id}/approve`)
      .set(...asAdmin())
      .send({})
      .expect(200);
    return source;
  }

  describe('source registration and validation', () => {
    it('stores the upload outside the database and creates a draft version', async () => {
      const res = await upload(
        { bytes: Buffer.from(GUIDE), name: 'guide.txt' },
        {
          cropIds: tomatoId,
          topicIds: JSON.stringify([irrigationId]),
          publicationDate: '2025-06-01',
          sourceOrganization: 'RAB',
        },
      ).expect(201);

      expect(res.body).toMatchObject({
        status: KnowledgeSourceStatus.DRAFT,
        sourceType: 'TXT',
        publicationDate: '2025-06-01',
        sourceOrganization: 'RAB',
        crops: [{ code: 'TOMATO' }],
        topics: [{ code: 'IRRIGATION' }],
        latestVersion: {
          versionNumber: 1,
          storageKind: 'UPLOAD',
          mimeType: 'text/plain',
          originalFilename: 'guide.txt',
        },
      });
      expect(res.body.latestVersion.storageRef).toMatch(
        /^uploads\/\d{4}\/\d{2}\/[0-9a-f]{64}\.txt$/,
      );
      expect(res.body.latestVersion.fileSizeBytes).toBe(Buffer.byteLength(GUIDE));
      const audit = await ctx.prisma.auditLog.findMany({ where: { entityId: res.body.id } });
      expect(audit.map((entry) => entry.action)).toEqual(['knowledge.source.created']);
    });

    it('rejects executables, mismatched types and missing files', async () => {
      await upload({ bytes: Buffer.from('MZ\x90\x00\x03'), name: 'guide.txt' }).expect(422);
      await upload(
        { bytes: buildPdf([['Hello']]), name: 'guide.pdf' },
        { sourceType: 'DOCX' },
      ).expect(422);
      await upload(
        { bytes: Buffer.from('plain text'), name: 'guide.pdf' },
        { sourceType: 'PDF' },
      ).expect(422);
      await ctx
        .http()
        .post(`${API}/knowledge/sources`)
        .set(...asAdmin())
        .send({ title: 'x', sourceType: 'TXT' })
        .expect(400);
      await upload(
        { bytes: Buffer.from('x'), name: 'guide.txt' },
        { sourceType: 'SPREADSHEET' },
      ).expect(400);
      expect(await ctx.prisma.knowledgeSource.count()).toBe(0);
    });

    it('rejects files over the size limit', async () => {
      await upload({ bytes: Buffer.alloc(262_145, 'a'), name: 'big.txt' }).expect(413);
    });

    it('validates storage references', async () => {
      const send = (body: object) =>
        ctx
          .http()
          .post(`${API}/knowledge/sources`)
          .set(...asAdmin())
          .send(body);
      await send({ title: 'x', sourceType: 'TXT', storageRef: '../../etc/passwd' }).expect(400);
      await send({ title: 'x', sourceType: 'TXT', storageRef: 'uploads/missing.txt' }).expect(400);
      await send({
        title: 'x',
        sourceType: 'PDF',
        storageRef: 'https://example.org/guide.pdf',
      }).expect(400);
      await send({
        title: 'x',
        sourceType: 'WEB_ARTICLE',
        storageRef: 'http://example.org/a',
      }).expect(400);
      const article = await send({
        title: 'Market prices',
        sourceType: 'WEB_ARTICLE',
        storageRef: 'https://example.org/prices',
      }).expect(201);
      expect(article.body.latestVersion).toMatchObject({
        storageKind: 'EXTERNAL_URL',
        storageRef: 'https://example.org/prices',
      });
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${article.body.id}/process`)
        .set(...asAdmin())
        .send({})
        .expect(409);

      const first = await createTxtSource();
      const byReference = await send({
        title: 'Same file by reference',
        sourceType: 'TXT',
        storageRef: first.latestVersion.storageRef,
      }).expect(201);
      expect(byReference.body.latestVersion).toMatchObject({
        storageKind: 'STORAGE_REFERENCE',
        mimeType: 'text/plain',
      });
    });

    it('rejects unknown crops and topics', async () => {
      await upload(
        { bytes: Buffer.from(GUIDE), name: 'guide.txt' },
        { cropIds: '00000000-0000-4000-8000-000000000000' },
      ).expect(400);
    });

    it('keeps management and approval to administrators', async () => {
      await upload(
        { bytes: Buffer.from(GUIDE), name: 'guide.txt' },
        {},
        facilitator.accessToken,
      ).expect(403);
      await ctx
        .http()
        .get(`${API}/knowledge/sources`)
        .set(...bearer(farmer.accessToken))
        .expect(403);
      await ctx
        .http()
        .get(`${API}/knowledge/glossary`)
        .set(...bearer(farmer.accessToken))
        .expect(403);
      await ctx.http().get(`${API}/knowledge/sources`).expect(401);
    });
  });

  describe('processing pipeline', () => {
    it('extracts, normalizes, tags and chunks a TXT file', async () => {
      const source = await createTxtSource({ topicIds: irrigationId });
      const accepted = await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/process`)
        .set(...asAdmin())
        .send({})
        .expect(202);
      expect(accepted.body).toMatchObject({
        status: 'PROCESSING',
        versionId: source.latestVersion.id,
      });
      const queue = ctx.queues[QueueName.Knowledge];
      expect(queue.add).toHaveBeenLastCalledWith(
        KnowledgeStage.EXTRACTION,
        { jobId: accepted.body.jobId },
        expect.objectContaining({ jobId: accepted.body.jobId, attempts: 3 }),
      );

      expect(await drainKnowledgeQueue(ctx)).toBe(4);

      const status = await ctx
        .http()
        .get(`${API}/knowledge/sources/${source.id}/processing-status`)
        .set(...asAdmin())
        .expect(200);
      expect(status.body.sourceStatus).toBe(KnowledgeSourceStatus.PROCESSED);
      expect(status.body.version.status).toBe(KnowledgeSourceStatus.PROCESSED);
      expect(
        status.body.jobs.map((job: { stage: string; status: string }) => [job.stage, job.status]),
      ).toEqual([
        ['EXTRACTION', 'COMPLETED'],
        ['NORMALIZATION', 'COMPLETED'],
        ['METADATA', 'COMPLETED'],
        ['CHUNKING', 'COMPLETED'],
      ]);
      expect(status.body.document).toMatchObject({
        detectedLanguage: 'en',
        detectedCropCodes: ['TOMATO'],
        chunkingOptions: { chunkSize: 400, chunkOverlap: 80 },
      });
      expect(status.body.document.detectedTopicCodes).toEqual(
        expect.arrayContaining(['IRRIGATION', 'HARVESTING']),
      );
      expect(status.body.chunkCount).toBeGreaterThan(2);

      const chunks = await ctx
        .http()
        .get(`${API}/knowledge/sources/${source.id}/chunks?limit=100`)
        .set(...asAdmin())
        .expect(200);
      const rows = chunks.body.data as Array<{
        text: string;
        sectionTitle: string;
        cropCodes: string[];
        topicCodes: string[];
        metadata: { overlapChars: number };
      }>;
      expect(rows.map((row) => row.sectionTitle)).toEqual(
        expect.arrayContaining(['Land preparation', 'Irrigation', 'Harvesting']),
      );
      for (const row of rows) {
        expect(row.text.length).toBeGreaterThan(0);
        expect(row.text.length).toBeLessThanOrEqual(400);
        expect(row.cropCodes).toEqual(['TOMATO']);
        expect(row.topicCodes).toEqual(['IRRIGATION']);
      }
      expect(rows.some((row) => row.metadata.overlapChars > 0)).toBe(true);

      const chunk = await ctx
        .http()
        .get(`${API}/knowledge/chunks/${(rows[0] as unknown as { id: string }).id}`)
        .set(...asAdmin())
        .expect(200);
      expect(chunk.body.sourceId).toBe(source.id);
    });

    it('keeps PDF page numbers on chunks', async () => {
      const pdf = buildPdf([
        ['Irrigation', 'Water tomatoes in the morning.', 'Drip lines save water.'],
        ['Harvesting', 'Pick ripe tomatoes in the morning.'],
      ]);
      const res = await upload({ bytes: pdf, name: 'guide.pdf' }, { sourceType: 'PDF' }).expect(
        201,
      );
      expect(res.body.latestVersion.mimeType).toBe('application/pdf');
      await processSource(res.body.id);

      const chunks = await ctx.prisma.knowledgeChunk.findMany({
        where: { sourceId: res.body.id },
        orderBy: { chunkIndex: 'asc' },
      });
      expect(chunks.map((chunk) => [chunk.sectionTitle, chunk.pageNumber])).toEqual([
        ['Irrigation', 1],
        ['Harvesting', 2],
      ]);
      const document = await ctx.prisma.knowledgeDocument.findFirstOrThrow({
        where: { sourceId: res.body.id },
      });
      expect(document.pageCount).toBe(2);
    });

    it('keeps DOCX headings as section titles', async () => {
      const docx = await buildDocx([
        '# Nursery',
        'Sow cabbage seeds 1 cm deep and cover lightly.',
        '# Planting',
        'Transplant after four weeks.',
      ]);
      const res = await upload({ bytes: docx, name: 'guide.docx' }, { sourceType: 'DOCX' }).expect(
        201,
      );
      await processSource(res.body.id);
      const chunks = await ctx.prisma.knowledgeChunk.findMany({
        where: { sourceId: res.body.id },
        orderBy: { chunkIndex: 'asc' },
      });
      expect(chunks.map((chunk) => [chunk.sectionTitle, chunk.text, chunk.pageNumber])).toEqual([
        ['Nursery', 'Sow cabbage seeds 1 cm deep and cover lightly.', null],
        ['Planting', 'Transplant after four weeks.', null],
      ]);
      expect(chunks[0].cropCodes).toEqual(['CABBAGE']);
    });

    it('marks a malformed document as failed without retrying, and allows processing again', async () => {
      const broken = Buffer.from('%PDF-1.7\nthis is not a real pdf');
      const res = await upload({ bytes: broken, name: 'broken.pdf' }, { sourceType: 'PDF' }).expect(
        201,
      );
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${res.body.id}/process`)
        .set(...asAdmin())
        .send({})
        .expect(202);
      await expect(drainKnowledgeQueue(ctx)).rejects.toBeInstanceOf(UnrecoverableError);

      const version = await ctx.prisma.knowledgeSourceVersion.findFirstOrThrow({
        where: { sourceId: res.body.id },
      });
      expect(version.status).toBe(KnowledgeSourceStatus.FAILED);
      expect(version.processingError).toMatch(/could not be read/);
      const job = await ctx.prisma.knowledgeProcessingJob.findFirstOrThrow({
        where: { versionId: version.id },
      });
      expect(job).toMatchObject({ status: KnowledgeJobStatus.FAILED, attempts: 1 });
      expect(await ctx.prisma.knowledgeChunk.count({ where: { sourceId: res.body.id } })).toBe(0);

      const history = await ctx
        .http()
        .get(`${API}/knowledge/sources/${res.body.id}/history`)
        .set(...asAdmin())
        .expect(200);
      expect(history.body.processing.map((entry: { event: string }) => entry.event)).toEqual([
        'QUEUED',
        'STARTED',
        'FAILED',
      ]);

      await ctx
        .http()
        .post(`${API}/knowledge/sources/${res.body.id}/process`)
        .set(...asAdmin())
        .send({})
        .expect(202);
      const runs = await ctx.prisma.knowledgeProcessingJob.findMany({
        where: { versionId: version.id },
        orderBy: { runNumber: 'asc' },
      });
      expect(runs.map((run) => run.runNumber)).toEqual([1, 2]);
    });

    it('fails a scanned-style document with no text', async () => {
      const res = await upload(
        { bytes: buildPdf([[]]), name: 'scan.pdf' },
        { sourceType: 'PDF' },
      ).expect(201);
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${res.body.id}/process`)
        .set(...asAdmin())
        .send({})
        .expect(202);
      await expect(drainKnowledgeQueue(ctx)).rejects.toThrow(/No text could be extracted/);
    });

    it('retries a temporary failure safely', async () => {
      const source = await createTxtSource();
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/process`)
        .set(...asAdmin())
        .send({})
        .expect(202);
      const pipeline = ctx.app.get(KnowledgePipelineService);
      const extraction = await ctx.prisma.knowledgeProcessingJob.findFirstOrThrow({
        where: { versionId: source.latestVersion.id },
      });

      const spy = jest
        .spyOn(ctx.prisma.knowledgeDocument, 'upsert')
        .mockRejectedValueOnce(new Error('connection reset'));
      await expect(pipeline.runJob(extraction.id, { attempt: 1, maxAttempts: 3 })).rejects.toThrow(
        'connection reset',
      );
      spy.mockRestore();
      expect(
        await ctx.prisma.knowledgeProcessingJob.findUniqueOrThrow({ where: { id: extraction.id } }),
      ).toMatchObject({
        status: KnowledgeJobStatus.QUEUED,
        attempts: 1,
        error: 'connection reset',
      });
      const version = await ctx.prisma.knowledgeSourceVersion.findUniqueOrThrow({
        where: { id: source.latestVersion.id },
      });
      expect(version.status).toBe(KnowledgeSourceStatus.PROCESSING);

      await expect(pipeline.runJob(extraction.id, { attempt: 2, maxAttempts: 3 })).resolves.toBe(
        'completed',
      );
      // A redelivered job that already completed does nothing.
      await expect(pipeline.runJob(extraction.id, { attempt: 3, maxAttempts: 3 })).resolves.toBe(
        'ignored',
      );
      skipQueuedKnowledgeJobs(ctx);
      const events = await ctx.prisma.knowledgeProcessingHistory.findMany({
        where: { jobId: extraction.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(events.map((event) => event.event)).toEqual([
        'QUEUED',
        'STARTED',
        'RETRYING',
        'STARTED',
        'COMPLETED',
      ]);
      expect(
        await ctx.prisma.knowledgeDocument.count({ where: { versionId: source.latestVersion.id } }),
      ).toBe(1);
    });

    it('fails the version after the last attempt', async () => {
      const source = await createTxtSource();
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/process`)
        .set(...asAdmin())
        .send({})
        .expect(202);
      const pipeline = ctx.app.get(KnowledgePipelineService);
      const job = await ctx.prisma.knowledgeProcessingJob.findFirstOrThrow({
        where: { versionId: source.latestVersion.id },
      });
      const spy = jest
        .spyOn(ctx.prisma.knowledgeDocument, 'upsert')
        .mockRejectedValue(new Error('connection reset'));
      await expect(pipeline.runJob(job.id, { attempt: 3, maxAttempts: 3 })).rejects.toThrow(
        'connection reset',
      );
      spy.mockRestore();
      skipQueuedKnowledgeJobs(ctx);
      const version = await ctx.prisma.knowledgeSourceVersion.findUniqueOrThrow({
        where: { id: source.latestVersion.id },
      });
      expect(version).toMatchObject({
        status: KnowledgeSourceStatus.FAILED,
        processingError: 'connection reset',
      });
    });

    it('prevents duplicate processing', async () => {
      const source = await createTxtSource();
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/process`)
        .set(...asAdmin())
        .send({})
        .expect(202);
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/process`)
        .set(...asAdmin())
        .send({})
        .expect(409);

      const jobs = ctx.app.get(KnowledgeJobsService);
      const request = {
        sourceId: source.id,
        versionId: source.latestVersion.id,
        stage: KnowledgeStage.EXTRACTION,
        requestedById: admin.id,
      };
      const again = await jobs.enqueue(request);
      expect(again.duplicate).toBe(true);
      expect(
        await ctx.prisma.knowledgeProcessingJob.count({
          where: { versionId: source.latestVersion.id },
        }),
      ).toBe(1);

      await drainKnowledgeQueue(ctx);
      const processed = await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/process`)
        .set(...asAdmin())
        .send({})
        .expect(409);
      expect(processed.body.message).toMatch(/Upload a new version/);

      // The same file cannot become a new version.
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/versions`)
        .set(...asAdmin())
        .attach('file', Buffer.from(GUIDE), 'guide.txt')
        .expect(409);
    });

    it('prepares embeddings for the active configuration without generating vectors', async () => {
      const config = await ctx
        .http()
        .post(`${API}/knowledge/embedding-configurations`)
        .set(...asAdmin())
        .send({
          name: 'Future model',
          provider: 'local',
          model: 'multilingual-small',
          dimensions: 384,
        })
        .expect(201);
      expect(config.body).toMatchObject({
        status: 'INACTIVE',
        version: 1,
        providerAvailable: false,
      });
      await ctx
        .http()
        .post(`${API}/knowledge/embedding-configurations/${config.body.id}/activate`)
        .set(...asAdmin())
        .expect(200);

      const second = await ctx
        .http()
        .post(`${API}/knowledge/embedding-configurations`)
        .set(...asAdmin())
        .send({
          name: 'Future model v2',
          provider: 'local',
          model: 'multilingual-small',
          dimensions: 384,
        })
        .expect(201);
      expect(second.body.version).toBe(2);

      const source = await createTxtSource();
      await processSource(source.id);

      const embeddingJob = await ctx.prisma.knowledgeProcessingJob.findFirstOrThrow({
        where: { versionId: source.latestVersion.id, stage: KnowledgeStage.EMBEDDING },
      });
      expect(embeddingJob.status).toBe(KnowledgeJobStatus.SKIPPED);
      const embeddings = await ctx.prisma.knowledgeEmbedding.findMany({
        where: { configurationId: config.body.id },
      });
      const chunkCount = await ctx.prisma.knowledgeChunk.count({ where: { sourceId: source.id } });
      expect(embeddings).toHaveLength(chunkCount);
      expect(
        embeddings.every((row) => row.status === EmbeddingStatus.PENDING && row.vectorRef === null),
      ).toBe(true);

      await ctx
        .http()
        .post(`${API}/knowledge/embedding-configurations/${second.body.id}/activate`)
        .set(...asAdmin())
        .expect(200);
      const list = await ctx
        .http()
        .get(`${API}/knowledge/embedding-configurations`)
        .set(...asAdmin())
        .expect(200);
      expect(
        list.body
          .filter((row: { status: string }) => row.status === 'ACTIVE')
          .map((row: { id: string }) => row.id),
      ).toEqual([second.body.id]);
    });
  });

  describe('review, approval and versioning', () => {
    it('hides unapproved knowledge from facilitators', async () => {
      const source = await createTxtSource();
      await processSource(source.id);
      const asFacilitator = bearer(facilitator.accessToken);
      await ctx
        .http()
        .get(`${API}/knowledge/sources/${source.id}`)
        .set(...asFacilitator)
        .expect(404);
      await ctx
        .http()
        .get(`${API}/knowledge/sources/${source.id}/chunks`)
        .set(...asFacilitator)
        .expect(404);
      const chunk = await ctx.prisma.knowledgeChunk.findFirstOrThrow({
        where: { sourceId: source.id },
      });
      await ctx
        .http()
        .get(`${API}/knowledge/chunks/${chunk.id}`)
        .set(...asFacilitator)
        .expect(404);
      const list = await ctx
        .http()
        .get(`${API}/knowledge/sources`)
        .set(...asFacilitator)
        .expect(200);
      expect(list.body.meta.total).toBe(0);
    });

    it('requires processing before review and an administrator to approve', async () => {
      const source = await createTxtSource();
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/submit-review`)
        .set(...asAdmin())
        .expect(409);
      await processSource(source.id);
      const submitted = await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/submit-review`)
        .set(...asAdmin())
        .expect(200);
      expect(submitted.body.status).toBe(KnowledgeSourceStatus.PENDING_REVIEW);

      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/approve`)
        .set(...bearer(facilitator.accessToken))
        .send({})
        .expect(403);
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/reject`)
        .set(...bearer(facilitator.accessToken))
        .send({ reason: 'no' })
        .expect(403);

      const approved = await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/approve`)
        .set(...asAdmin())
        .send({ reason: 'Checked by agronomist' })
        .expect(200);
      expect(approved.body).toMatchObject({
        status: KnowledgeSourceStatus.APPROVED,
        approvedVersionId: source.latestVersion.id,
        approvedById: admin.id,
      });

      const asFacilitator = bearer(facilitator.accessToken);
      const visible = await ctx
        .http()
        .get(`${API}/knowledge/sources/${source.id}`)
        .set(...asFacilitator)
        .expect(200);
      expect(visible.body.latestVersion).toBeUndefined();
      expect(visible.body.versions).toBeUndefined();
      const chunks = await ctx
        .http()
        .get(`${API}/knowledge/sources/${source.id}/chunks`)
        .set(...asFacilitator)
        .expect(200);
      expect(chunks.body.meta.total).toBeGreaterThan(0);
    });

    it('requires a reason to reject', async () => {
      const source = await createTxtSource();
      await processSource(source.id);
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/submit-review`)
        .set(...asAdmin())
        .expect(200);
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/reject`)
        .set(...asAdmin())
        .send({})
        .expect(400);
      const rejected = await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/reject`)
        .set(...asAdmin())
        .send({ reason: 'Spacing advice is outdated' })
        .expect(200);
      expect(rejected.body.status).toBe(KnowledgeSourceStatus.REJECTED);
      expect(rejected.body.latestVersion.reviewReason).toBe('Spacing advice is outdated');
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/approve`)
        .set(...asAdmin())
        .send({})
        .expect(409);
    });

    it('keeps the approved version in use until a new version is approved, then archives it', async () => {
      const source = await approvedSource();
      const v1 = source.latestVersion.id;
      const asFacilitator = bearer(facilitator.accessToken);

      const updated = GUIDE.replace('30 cm', '40 cm');
      const v2Res = await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/versions`)
        .set(...asAdmin())
        .field('changeNote', 'Deeper digging')
        .attach('file', Buffer.from(updated), 'guide-v2.txt')
        .expect(201);
      const v2 = v2Res.body.latestVersion.id;
      expect(v2Res.body).toMatchObject({
        latestVersionNumber: 2,
        approvedVersionId: v1,
        status: 'DRAFT',
      });
      await processSource(source.id);

      // Still serving version 1 while version 2 is processed and reviewed.
      let chunks = await ctx
        .http()
        .get(`${API}/knowledge/sources/${source.id}/chunks?limit=100`)
        .set(...asFacilitator)
        .expect(200);
      expect(chunks.body.data.every((chunk: { versionId: string }) => chunk.versionId === v1)).toBe(
        true,
      );

      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/submit-review`)
        .set(...asAdmin())
        .expect(200);
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/reject`)
        .set(...asAdmin())
        .send({ reason: 'Typo' })
        .expect(200);
      const stillV1 = await ctx
        .http()
        .get(`${API}/knowledge/sources/${source.id}`)
        .set(...asFacilitator)
        .expect(200);
      expect(stillV1.body.approvedVersionId).toBe(v1);

      const v3Res = await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/versions`)
        .set(...asAdmin())
        .attach('file', Buffer.from(updated.replace('Typo', '')), 'guide-v3.txt');
      // Same bytes as the rejected version 2.
      expect(v3Res.status).toBe(409);
      const v3 = await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/versions`)
        .set(...asAdmin())
        .attach('file', Buffer.from(`${updated}\nStore in a cool place.`), 'guide-v3.txt')
        .expect(201);
      await processSource(source.id);
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/submit-review`)
        .set(...asAdmin())
        .expect(200);
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/approve`)
        .set(...asAdmin())
        .send({})
        .expect(200);

      const versions = await ctx.prisma.knowledgeSourceVersion.findMany({
        where: { sourceId: source.id },
        orderBy: { versionNumber: 'asc' },
      });
      expect(versions.map((version) => version.status)).toEqual([
        'ARCHIVED',
        'REJECTED',
        'APPROVED',
      ]);
      expect(await ctx.prisma.knowledgeChunk.count({ where: { versionId: v1 } })).toBeGreaterThan(
        0,
      );
      expect(await ctx.prisma.knowledgeChunk.count({ where: { versionId: v2 } })).toBeGreaterThan(
        0,
      );

      chunks = await ctx
        .http()
        .get(`${API}/knowledge/sources/${source.id}/chunks?limit=100`)
        .set(...asFacilitator)
        .expect(200);
      expect(
        chunks.body.data.every(
          (chunk: { versionId: string }) => chunk.versionId === v3.body.latestVersion.id,
        ),
      ).toBe(true);
      const oldChunk = await ctx.prisma.knowledgeChunk.findFirstOrThrow({
        where: { versionId: v1 },
      });
      await ctx
        .http()
        .get(`${API}/knowledge/chunks/${oldChunk.id}`)
        .set(...asFacilitator)
        .expect(404);
      await ctx
        .http()
        .get(`${API}/knowledge/sources/${source.id}/chunks?versionId=${v1}`)
        .set(...asAdmin())
        .expect(200);

      const history = await ctx
        .http()
        .get(`${API}/knowledge/sources/${source.id}/history`)
        .set(...asAdmin())
        .expect(200);
      expect(
        history.body.versions.map((version: { versionNumber: number }) => version.versionNumber),
      ).toEqual([1, 2, 3]);
      expect(history.body.approvals.map((entry: { action: string }) => entry.action)).toEqual([
        'SUBMITTED',
        'APPROVED',
        'SUBMITTED',
        'REJECTED',
        'SUBMITTED',
        'SUPERSEDED',
        'APPROVED',
      ]);
      expect(history.body.audit.map((entry: { action: string }) => entry.action)).toEqual(
        expect.arrayContaining([
          'knowledge.source.created',
          'knowledge.version.added',
          'knowledge.review.approved',
          'knowledge.review.rejected',
        ]),
      );
    });

    it('blocks a new version while one is under review', async () => {
      const source = await createTxtSource();
      await processSource(source.id);
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/submit-review`)
        .set(...asAdmin())
        .expect(200);
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/versions`)
        .set(...asAdmin())
        .attach('file', Buffer.from(`${GUIDE}\nMore.`), 'guide-2.txt')
        .expect(409);
    });

    it('only deletes sources that were never approved, and archives the others', async () => {
      const draft = await createTxtSource({ title: 'Draft' }, `${GUIDE}\nDraft only.`);
      const storedPath = draft.latestVersion.storageRef;
      await ctx
        .http()
        .delete(`${API}/knowledge/sources/${draft.id}`)
        .set(...asAdmin())
        .expect(204);
      expect(await ctx.prisma.knowledgeSource.count({ where: { id: draft.id } })).toBe(0);
      expect(
        await ctx.prisma.knowledgeSourceVersion.count({ where: { storageRef: storedPath } }),
      ).toBe(0);

      const approved = await approvedSource();
      await ctx
        .http()
        .delete(`${API}/knowledge/sources/${approved.id}`)
        .set(...asAdmin())
        .expect(409);
      const archived = await ctx
        .http()
        .post(`${API}/knowledge/sources/${approved.id}/archive`)
        .set(...asAdmin())
        .send({})
        .expect(200);
      expect(archived.body.status).toBe(KnowledgeSourceStatus.ARCHIVED);
      await ctx
        .http()
        .get(`${API}/knowledge/sources/${approved.id}`)
        .set(...bearer(facilitator.accessToken))
        .expect(404);
      await ctx
        .http()
        .patch(`${API}/knowledge/sources/${approved.id}`)
        .set(...asAdmin())
        .send({ title: 'x' })
        .expect(409);
      expect(
        await ctx.prisma.knowledgeChunk.count({ where: { sourceId: approved.id } }),
      ).toBeGreaterThan(0);
    });

    it('hides deactivated sources from retrieval', async () => {
      const source = await approvedSource();
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/deactivate`)
        .set(...asAdmin())
        .expect(200);
      await ctx
        .http()
        .get(`${API}/knowledge/sources/${source.id}/chunks`)
        .set(...bearer(facilitator.accessToken))
        .expect(404);
      await ctx
        .http()
        .post(`${API}/knowledge/sources/${source.id}/activate`)
        .set(...asAdmin())
        .expect(200);
      await ctx
        .http()
        .get(`${API}/knowledge/sources/${source.id}/chunks`)
        .set(...bearer(facilitator.accessToken))
        .expect(200);
    });

    it('re-tags chunks when crops or topics change', async () => {
      const source = await createTxtSource();
      await processSource(source.id);
      const carrotId = (await ctx.prisma.crop.findUniqueOrThrow({ where: { code: 'CARROT' } })).id;
      const harvestingId = (
        await ctx.prisma.knowledgeTopic.findUniqueOrThrow({ where: { code: 'HARVESTING' } })
      ).id;
      const res = await ctx
        .http()
        .patch(`${API}/knowledge/sources/${source.id}`)
        .set(...asAdmin())
        .send({ cropIds: [tomatoId, carrotId], topicIds: [harvestingId] })
        .expect(200);
      expect(res.body.crops.map((crop: { code: string }) => crop.code)).toEqual([
        'CARROT',
        'TOMATO',
      ]);
      const chunks = await ctx.prisma.knowledgeChunk.findMany({ where: { sourceId: source.id } });
      expect(chunks.every((chunk) => chunk.cropCodes.join() === 'CARROT,TOMATO')).toBe(true);
      expect(chunks.every((chunk) => chunk.topicCodes.join() === 'HARVESTING')).toBe(true);
    });
  });

  describe('topics and glossary', () => {
    it('lists the seeded topics and lets administrators manage them', async () => {
      const list = await ctx
        .http()
        .get(`${API}/knowledge/topics`)
        .set(...bearer(facilitator.accessToken))
        .expect(200);
      expect(list.body).toHaveLength(12);
      expect(list.body.every((topic: { nameRw: string | null }) => topic.nameRw === null)).toBe(
        true,
      );

      await ctx
        .http()
        .post(`${API}/knowledge/topics`)
        .set(...bearer(facilitator.accessToken))
        .send({ code: 'SOIL_TESTING', nameEn: 'Soil testing' })
        .expect(403);
      const created = await ctx
        .http()
        .post(`${API}/knowledge/topics`)
        .set(...asAdmin())
        .send({ code: 'SOIL_TESTING', nameEn: 'Soil testing', keywords: [' Soil Test ', 'pH'] })
        .expect(201);
      expect(created.body.keywords).toEqual(['soil test', 'ph']);
      await ctx
        .http()
        .post(`${API}/knowledge/topics`)
        .set(...asAdmin())
        .send({ code: 'OTHER', nameEn: 'soil TESTING' })
        .expect(409);
      await ctx
        .http()
        .post(`${API}/knowledge/topics`)
        .set(...asAdmin())
        .send({ code: 'bad code', nameEn: 'X' })
        .expect(400);

      const renamed = await ctx
        .http()
        .patch(`${API}/knowledge/topics/${created.body.id}`)
        .set(...asAdmin())
        .send({ nameRw: 'Gupima ubutaka' })
        .expect(200);
      expect(renamed.body.nameRw).toBe('Gupima ubutaka');
      await ctx
        .http()
        .delete(`${API}/knowledge/topics/${created.body.id}`)
        .set(...asAdmin())
        .expect(200);
      const after = await ctx
        .http()
        .get(`${API}/knowledge/topics`)
        .set(...bearer(facilitator.accessToken))
        .expect(200);
      expect(after.body).toHaveLength(12);
    });

    it('creates, searches, updates and deactivates glossary terms', async () => {
      await ctx
        .http()
        .post(`${API}/knowledge/glossary`)
        .set(...bearer(facilitator.accessToken))
        .send({ termEn: 'Seedbed', termRw: 'Ubuhumbikiro' })
        .expect(403);
      const created = await ctx
        .http()
        .post(`${API}/knowledge/glossary`)
        .set(...asAdmin())
        .send({
          termEn: 'Seedbed',
          termRw: 'Ubuhumbikiro',
          descriptionEn: 'Prepared soil where seeds are sown.',
          cropId: tomatoId,
          synonymsRw: ['Imbuto zihumbikwa', 'Ahahumbikirwa'],
          usageExamples: ['Prepare the seedbed before sowing.'],
        })
        .expect(201);
      expect(created.body).toMatchObject({
        status: 'ACTIVE',
        createdById: admin.id,
        synonymsRw: ['Imbuto zihumbikwa', 'Ahahumbikirwa'],
      });

      await ctx
        .http()
        .post(`${API}/knowledge/glossary`)
        .set(...asAdmin())
        .send({ termEn: 'seedbed', termRw: 'UBUHUMBIKIRO' })
        .expect(409);
      await ctx
        .http()
        .post(`${API}/knowledge/glossary`)
        .set(...asAdmin())
        .send({ termEn: 'Only English' })
        .expect(400);

      const asFacilitator = bearer(facilitator.accessToken);
      const bySynonym = await ctx
        .http()
        .get(`${API}/knowledge/glossary?q=ahahumbik`)
        .set(...asFacilitator)
        .expect(200);
      expect(bySynonym.body.data.map((term: { id: string }) => term.id)).toEqual([created.body.id]);
      const byTerm = await ctx
        .http()
        .get(`${API}/knowledge/glossary?q=seed`)
        .set(...asFacilitator)
        .expect(200);
      expect(byTerm.body.meta.total).toBe(1);
      const none = await ctx
        .http()
        .get(`${API}/knowledge/glossary?q=100%25`)
        .set(...asFacilitator)
        .expect(200);
      expect(none.body.meta.total).toBe(0);

      const updated = await ctx
        .http()
        .patch(`${API}/knowledge/glossary/${created.body.id}`)
        .set(...asAdmin())
        .send({ descriptionRw: 'Ubutaka bwateguwe bwo guhumbikamo imbuto.', cropId: null })
        .expect(200);
      expect(updated.body).toMatchObject({ cropId: null, updatedById: admin.id });

      await ctx
        .http()
        .delete(`${API}/knowledge/glossary/${created.body.id}`)
        .set(...asAdmin())
        .expect(200);
      await ctx
        .http()
        .get(`${API}/knowledge/glossary/${created.body.id}`)
        .set(...asFacilitator)
        .expect(404);
      const adminView = await ctx
        .http()
        .get(`${API}/knowledge/glossary/${created.body.id}`)
        .set(...asAdmin())
        .expect(200);
      expect(adminView.body.status).toBe('INACTIVE');
    });
  });

  describe('search', () => {
    it('filters sources by metadata and only shows approved knowledge to facilitators', async () => {
      const cabbageId = (await ctx.prisma.crop.findUniqueOrThrow({ where: { code: 'CABBAGE' } }))
        .id;
      const tomato = await approvedSource({
        topicIds: irrigationId,
        publicationDate: '2024-03-01',
      });
      await approvedSource(
        {
          title: 'Amashu: kubika',
          cropIds: cabbageId,
          language: 'rw',
          publicationDate: '2022-01-01',
        },
        'Kubika amashu\nAmashu abikwa ahantu hakonje kandi hari umwuka mwiza kugira ngo atabora vuba.',
      );
      await createTxtSource({ title: 'Draft tomato pests' }, `${GUIDE}\nDraft.`);

      const search = (query: string, token = facilitator.accessToken) =>
        ctx
          .http()
          .get(`${API}/knowledge/search?${query}`)
          .set(...bearer(token))
          .expect(200);

      expect((await search('')).body.meta.total).toBe(2);
      expect((await search('', admin.accessToken)).body.meta.total).toBe(3);
      expect(
        (await search('status=DRAFT', admin.accessToken)).body.data.map(
          (s: { title: string }) => s.title,
        ),
      ).toEqual(['Draft tomato pests']);
      expect(
        (await search(`cropId=${tomatoId}`)).body.data.map((s: { id: string }) => s.id),
      ).toEqual([tomato.id]);
      expect((await search(`topicId=${irrigationId}`)).body.meta.total).toBe(1);
      expect((await search('language=rw')).body.data[0].title).toBe('Amashu: kubika');
      expect((await search('q=GROWING')).body.meta.total).toBe(1);
      expect((await search('sourceType=PDF')).body.meta.total).toBe(0);
      expect(
        (await search('publishedFrom=2023-01-01&publishedTo=2025-12-31')).body.data.map(
          (s: { id: string }) => s.id,
        ),
      ).toEqual([tomato.id]);
      // Status filters cannot widen what a facilitator sees.
      expect((await search('status=DRAFT')).body.meta.total).toBe(2);
    });

    it('reports that semantic search is not configured instead of guessing', async () => {
      const res = await ctx
        .http()
        .get(`${API}/knowledge/search?mode=semantic&q=irrigation`)
        .set(...asAdmin())
        .expect(501);
      expect(res.body.message).toMatch(/not available/);
      await ctx
        .http()
        .get(`${API}/knowledge/search?mode=semantic`)
        .set(...asAdmin())
        .expect(400);
    });
  });
});
