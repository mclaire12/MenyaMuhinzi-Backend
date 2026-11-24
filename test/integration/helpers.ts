import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { seedCrops } from '../../prisma/seed-crops';
import { seedKnowledgeTopics } from '../../prisma/seed-knowledge';
import { seedNotifications } from '../../prisma/seed-notifications';
import { seedRbac } from '../../prisma/seed-rbac';
import { seedTelephony } from '../../prisma/seed-telephony';
import { AppModule } from '../../src/app.module';
import { normalizeRwandanPhone } from '../../src/common/utils/phone';
import { setupApp } from '../../src/bootstrap/setup-app';
import { UserStatus } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/infrastructure/database/prisma.service';
import { ALL_QUEUES, QueueName } from '../../src/infrastructure/queue/queue.constants';
import { REDIS_CLIENT } from '../../src/infrastructure/redis/redis.constants';
import {
  AiOrchestratorService,
  type ExecutionOutcome,
} from '../../src/modules/ai/orchestration/ai-orchestrator.service';
import { PasswordHasher } from '../../src/modules/auth/services/password-hasher.service';
import {
  NotificationDispatcher,
  type DeliveryOutcome,
} from '../../src/modules/notifications/delivery/notification-dispatcher.service';
import { KnowledgePipelineService } from '../../src/modules/knowledge/pipeline/knowledge-pipeline.service';
import type { RoleCode } from '../../src/modules/roles/rbac.constants';

export const API = '/api/v1';
export const DEFAULT_PASSWORD = 'Umuhinzi2026';

export interface FakeQueue {
  name: string;
  add: jest.Mock;
  on: jest.Mock;
  close: jest.Mock;
}

export interface TestContext {
  app: NestExpressApplication;
  prisma: PrismaService;
  queues: Record<string, FakeQueue>;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export interface ProviderOverride {
  token: string | symbol | (abstract new (...args: never[]) => unknown);
  value: unknown;
}

/** Boots the full application against the test database; Redis and queues are faked. */
export async function createTestContext(
  options: { overrides?: ProviderOverride[] } = {},
): Promise<TestContext> {
  const redisStore = new Map<string, string>();
  const redisClient = {
    status: 'ready',
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
    on: jest.fn(),
    get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      redisStore.set(key, value);
      const exIndex = args.indexOf('EX');
      if (exIndex >= 0 && typeof args[exIndex + 1] === 'number') {
        const ttlMs = (args[exIndex + 1] as number) * 1000;
        setTimeout(() => redisStore.delete(key), ttlMs).unref?.();
      }
      return 'OK';
    }),
    del: jest.fn(async (key: string) => {
      redisStore.delete(key);
      return 1;
    }),
  };
  const queues: Record<string, FakeQueue> = {};

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS_CLIENT)
    .useValue(redisClient);
  for (const name of ALL_QUEUES) {
    queues[name] = {
      name,
      add: jest.fn().mockResolvedValue({ id: '1' }),
      on: jest.fn(),
      close: jest.fn(),
    };
    builder = builder.overrideProvider(getQueueToken(name)).useValue(queues[name]);
  }
  for (const override of options.overrides ?? []) {
    builder = builder.overrideProvider(override.token).useValue(override.value);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  setupApp(app);
  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    queues,
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}

/** Empties every table except the seeded role and permission catalogue, then re-seeds grants. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('_prisma_migrations', 'roles', 'permissions')`;
  if (tables.length > 0) {
    const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
  }
  await seedRbac(prisma);
  await seedCrops(prisma);
  await seedKnowledgeTopics(prisma);
  await seedNotifications(prisma);
  await seedTelephony(prisma);
}

/**
 * Runs every knowledge job captured by the fake queue, including the stages each job
 * queues next, as the BullMQ worker would. Returns how many jobs ran.
 */
export async function drainKnowledgeQueue(
  ctx: TestContext,
  options: { attempt?: number } = {},
): Promise<number> {
  const pipeline = ctx.app.get(KnowledgePipelineService);
  const queue = ctx.queues[QueueName.Knowledge];
  let ran = 0;
  while (queue.add.mock.calls.length > (drained.get(queue) ?? 0)) {
    const index = drained.get(queue) ?? 0;
    drained.set(queue, index + 1);
    const [, data, opts] = queue.add.mock.calls[index] as [
      string,
      { jobId: string },
      { attempts: number },
    ];
    await pipeline.runJob(data.jobId, {
      attempt: options.attempt ?? 1,
      maxAttempts: opts.attempts,
    });
    ran += 1;
  }
  return ran;
}

const drained = new Map<FakeQueue, number>();

/** Marks all captured knowledge jobs as handled without running them. */
export function skipQueuedKnowledgeJobs(ctx: TestContext): void {
  const queue = ctx.queues[QueueName.Knowledge];
  drained.set(queue, queue.add.mock.calls.length);
}

/**
 * Runs AI request jobs captured by the fake ai-generation queue, as the worker would, and
 * returns each outcome. Transient errors are returned instead of thrown.
 */
export async function drainAiQueue(
  ctx: TestContext,
  options: { attempt?: number } = {},
): Promise<(ExecutionOutcome | Error)[]> {
  const orchestrator = ctx.app.get(AiOrchestratorService);
  const queue = ctx.queues[QueueName.AiGeneration];
  const outcomes: (ExecutionOutcome | Error)[] = [];
  while (queue.add.mock.calls.length > (drained.get(queue) ?? 0)) {
    const index = drained.get(queue) ?? 0;
    drained.set(queue, index + 1);
    const [, data, opts] = queue.add.mock.calls[index] as [
      string,
      { requestId: string },
      { attempts: number },
    ];
    try {
      outcomes.push(
        await orchestrator.execute(data.requestId, {
          attempt: options.attempt ?? 1,
          maxAttempts: opts.attempts,
        }),
      );
    } catch (error) {
      outcomes.push(error as Error);
    }
  }
  return outcomes;
}

/** Forgets captured AI jobs so each test sees only the jobs it queued. */
export function skipQueuedAiJobs(ctx: TestContext): void {
  const queue = ctx.queues[QueueName.AiGeneration];
  queue.add.mockClear();
  drained.set(queue, 0);
}

/**
 * Runs notification delivery jobs captured by the fake notification-delivery queue, as the worker
 * would, and returns each outcome. Retryable provider errors are returned instead of thrown.
 */
export async function drainNotificationQueue(
  ctx: TestContext,
  options: { attempt?: number } = {},
): Promise<(DeliveryOutcome | Error)[]> {
  const dispatcher = ctx.app.get(NotificationDispatcher);
  const queue = ctx.queues[QueueName.NotificationDelivery];
  const outcomes: (DeliveryOutcome | Error)[] = [];
  while (queue.add.mock.calls.length > (drained.get(queue) ?? 0)) {
    const index = drained.get(queue) ?? 0;
    drained.set(queue, index + 1);
    const [, data, opts] = queue.add.mock.calls[index] as [
      string,
      { deliveryId: string },
      { attempts: number },
    ];
    try {
      outcomes.push(
        await dispatcher.execute(data.deliveryId, {
          attempt: options.attempt ?? 1,
          maxAttempts: opts.attempts,
        }),
      );
    } catch (error) {
      outcomes.push(error as Error);
    }
  }
  return outcomes;
}

/** Forgets captured notification jobs so each test sees only the jobs it queued. */
export function skipQueuedNotificationJobs(ctx: TestContext): void {
  const queue = ctx.queues[QueueName.NotificationDelivery];
  queue.add.mockReset();
  queue.add.mockResolvedValue({ id: '1' });
  drained.set(queue, 0);
}

let phoneCounter = 0;

/** Unique valid Rwandan mobile number per call. */
export function nextPhone(): string {
  phoneCounter += 1;
  return `+25078${String(1_000_000 + phoneCounter).slice(-7)}`;
}

/** Local format of a number from nextPhone(), e.g. 0781000001. */
export function localFormat(phone: string): string {
  return phone.replace(/^\+250/, '0');
}

const hasher = new PasswordHasher();
let cachedHash: string | undefined;

export interface SeedUserOptions {
  roles: RoleCode[];
  status?: UserStatus;
  password?: string | null;
  phoneNumber?: string;
  email?: string;
  fullName?: string;
}

export interface SeededUser {
  id: string;
  phoneNumber: string;
  email: string | null;
  password: string;
}

/** Inserts a user directly (bypassing the API) with the given roles. */
export async function seedUser(
  prisma: PrismaService,
  options: SeedUserOptions,
): Promise<SeededUser> {
  const password = options.password === undefined ? DEFAULT_PASSWORD : options.password;
  let passwordHash: string | null = null;
  if (password === DEFAULT_PASSWORD) {
    cachedHash ??= await hasher.hash(DEFAULT_PASSWORD);
    passwordHash = cachedHash;
  } else if (password) {
    passwordHash = await hasher.hash(password);
  }

  const roles = await prisma.role.findMany({ where: { code: { in: options.roles } } });
  const phoneNumber = options.phoneNumber ?? nextPhone();
  const user = await prisma.user.create({
    data: {
      fullName: options.fullName ?? 'Test User',
      phoneNumber,
      email: options.email,
      passwordHash,
      status: options.status ?? UserStatus.ACTIVE,
      roles: { create: roles.map((role) => ({ roleId: role.id })) },
    },
    select: { id: true },
  });
  return { id: user.id, phoneNumber, email: options.email ?? null, password: password ?? '' };
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * Signs in through the API. Pass an email address. A phone number is accepted only as a test
 * convenience: the helper looks up that user's email (and assigns one when the account has none).
 */
export async function login(
  ctx: TestContext,
  identifier: string,
  password = DEFAULT_PASSWORD,
): Promise<LoginResult> {
  const email = identifier.includes('@') ? identifier : await emailForPhone(ctx, identifier);
  const res = await ctx.http().post(`${API}/auth/login`).send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { accessToken: res.body.accessToken, refreshToken: res.body.refreshToken };
}

/** Gives a phone-only test account an email so it can sign in. */
async function emailForPhone(ctx: TestContext, phone: string): Promise<string> {
  const phoneNumber = normalizeRwandanPhone(phone);
  const user = await ctx.prisma.user.findFirst({
    where: { phoneNumber },
    select: { id: true, email: true },
  });
  if (!user) throw new Error(`No user with phone number ${phoneNumber}`);
  if (user.email) return user.email;
  const email = `${phoneNumber.replace('+', '')}@test.menyamuhinzi.rw`;
  await ctx.prisma.user.update({ where: { id: user.id }, data: { email } });
  return email;
}

/** Seeds a user with the given roles and returns their access token. */
export async function seedAndLogin(
  ctx: TestContext,
  roles: RoleCode[],
): Promise<SeededUser & LoginResult> {
  const phoneNumber = nextPhone();
  const email = `${phoneNumber.replace('+', '')}@test.menyamuhinzi.rw`;
  const user = await seedUser(ctx.prisma, { roles, phoneNumber, email });
  return { ...user, ...(await login(ctx, email)) };
}

export const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

export const notificationsQueue = (ctx: TestContext): FakeQueue =>
  ctx.queues[QueueName.Notifications];
