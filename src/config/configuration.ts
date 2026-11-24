import { registerAs } from '@nestjs/config';

/**
 * Typed configuration namespaces. Values come exclusively from the environment
 * (validated by `validateEnvironment`), never from hardcoded credentials.
 */

const optional = (value: string | undefined): string | undefined =>
  value && value.trim().length > 0 ? value : undefined;

export const appConfig = registerAs('app', () => ({
  name: process.env.APP_NAME ?? 'MenyaMuhinzi API',
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.APP_PORT ?? 4000),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  apiVersion: process.env.API_VERSION ?? '1',
  corsOrigins: (process.env.CORS_ORIGINS ?? '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
}));

export const loggerConfig = registerAs('logger', () => ({
  level: process.env.LOG_LEVEL ?? 'info',
  pretty: process.env.LOG_PRETTY === 'true' && process.env.NODE_ENV !== 'production',
}));

export const swaggerConfig = registerAs('swagger', () => ({
  enabled: process.env.SWAGGER_ENABLED !== 'false',
  path: process.env.SWAGGER_PATH ?? 'api/docs',
}));

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL as string,
}));

export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: optional(process.env.REDIS_PASSWORD),
  db: Number(process.env.REDIS_DB ?? 0),
}));

export const queueConfig = registerAs('queue', () => ({
  prefix: process.env.QUEUE_PREFIX ?? 'menyamuhinzi',
}));

export const jwtConfig = registerAs('jwt', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET as string,
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  refreshSecret: process.env.JWT_REFRESH_SECRET as string,
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  issuer: process.env.JWT_ISSUER ?? 'menyamuhinzi-api',
  audience: process.env.JWT_AUDIENCE ?? 'menyamuhinzi-clients',
}));

export const authConfig = registerAs('auth', () => ({
  maxFailedLogins: Number(process.env.AUTH_MAX_FAILED_LOGINS ?? 5),
  lockoutMinutes: Number(process.env.AUTH_LOCKOUT_MINUTES ?? 15),
  passwordResetTtlMinutes: Number(process.env.AUTH_PASSWORD_RESET_TTL_MINUTES ?? 30),
  farmerRequiresApproval: process.env.AUTH_FARMER_REQUIRES_APPROVAL !== 'false',
  exposeResetToken:
    process.env.AUTH_EXPOSE_RESET_TOKEN === 'true' && process.env.NODE_ENV !== 'production',
}));

export const rateLimitConfig = registerAs('rateLimit', () => ({
  ttlSeconds: Number(process.env.RATE_LIMIT_TTL_SECONDS ?? 60),
  max: Number(process.env.RATE_LIMIT_MAX ?? 120),
  authMax: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
}));

export const knowledgeConfig = registerAs('knowledge', () => ({
  storageDir: process.env.KNOWLEDGE_STORAGE_DIR ?? './storage/knowledge',
  maxFileBytes: Number(process.env.KNOWLEDGE_MAX_FILE_BYTES ?? 20 * 1024 * 1024),
  chunkSize: Number(process.env.KNOWLEDGE_CHUNK_SIZE ?? 1200),
  chunkOverlap: Number(process.env.KNOWLEDGE_CHUNK_OVERLAP ?? 150),
  maxPages: Number(process.env.KNOWLEDGE_MAX_PAGES ?? 500),
  extractionTimeoutMs: Number(process.env.KNOWLEDGE_EXTRACTION_TIMEOUT_MS ?? 60_000),
  extractionMemoryMb: Number(process.env.KNOWLEDGE_EXTRACTION_MEMORY_MB ?? 256),
  jobAttempts: Number(process.env.KNOWLEDGE_JOB_ATTEMPTS ?? 3),
  workerEnabled: process.env.KNOWLEDGE_WORKER_ENABLED !== 'false',
  workerConcurrency: Number(process.env.KNOWLEDGE_WORKER_CONCURRENCY ?? 2),
}));

/** No AI provider settings or keys exist yet: providers are registered in code, not configured here. */
export const aiConfig = registerAs('ai', () => ({
  workerEnabled: process.env.AI_WORKER_ENABLED !== 'false',
  workerConcurrency: Number(process.env.AI_WORKER_CONCURRENCY ?? 2),
  requestAttempts: Number(process.env.AI_REQUEST_ATTEMPTS ?? 3),
  contextMaxChars: Number(process.env.AI_CONTEXT_MAX_CHARS ?? 8000),
}));

/** No SMS, email, push, USSD or IVR provider settings or keys exist: providers are registered in code. */
export const notificationsConfig = registerAs('notifications', () => ({
  workerEnabled: process.env.NOTIFICATIONS_WORKER_ENABLED !== 'false',
  workerConcurrency: Number(process.env.NOTIFICATIONS_WORKER_CONCURRENCY ?? 4),
  deliveryAttempts: Number(process.env.NOTIFICATIONS_DELIVERY_ATTEMPTS ?? 3),
}));

/** Reporting aggregates transactional data; there is no external analytics service. */
export const reportsConfig = registerAs('reports', () => ({
  /** Days used to decide whether an enrolled learner is active (session or lesson progress). */
  activeLearnerDays: Number(process.env.REPORTS_ACTIVE_LEARNER_DAYS ?? 30),
  /** Hard cap on CSV export rows; larger requests are refused. */
  csvMaxRows: Number(process.env.REPORTS_CSV_MAX_ROWS ?? 10_000),
}));

/** No USSD aggregator is integrated: callbacks are validated and recorded; nothing is sent to a network. */
export const ussdConfig = registerAs('ussd', () => ({
  sessionTtlSeconds: Number(process.env.USSD_SESSION_TTL_SECONDS ?? 180),
  maxScreenChars: Number(process.env.USSD_MAX_SCREEN_CHARS ?? 160),
  callbackSecret: optional(process.env.USSD_CALLBACK_SECRET) ?? '',
}));

/** No IVR/voice provider is integrated: callbacks are validated and recorded; no audio is played. */
export const ivrConfig = registerAs('ivr', () => ({
  sessionTtlSeconds: Number(process.env.IVR_SESSION_TTL_SECONDS ?? 600),
  callbackSecret: optional(process.env.IVR_CALLBACK_SECRET) ?? '',
}));

export const configNamespaces = [
  appConfig,
  loggerConfig,
  swaggerConfig,
  databaseConfig,
  redisConfig,
  queueConfig,
  jwtConfig,
  authConfig,
  rateLimitConfig,
  knowledgeConfig,
  aiConfig,
  notificationsConfig,
  reportsConfig,
  ussdConfig,
  ivrConfig,
];
