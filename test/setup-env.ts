// Loaded before every test file. The application gets this polyfill from
// `@nestjs/core`; suites that never import Nest (env validation) need it here
// so class-transformer's Reflect.getMetadata calls work.
import 'reflect-metadata';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Deterministic environment for automated tests; `.env` is ignored when NODE_ENV=test.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.LOG_PRETTY = 'false';
process.env.SWAGGER_ENABLED = 'true';
process.env.DATABASE_URL ??=
  'postgresql://test:test@localhost:5432/menyamuhinzi_test?schema=public';
process.env.REDIS_HOST ??= 'localhost';
process.env.REDIS_PORT ??= '6379';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdefghijklmnop';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdefghijklmnop';
process.env.WEB_SESSION_HASH_SECRET = 'test-web-session-hash-secret-0123456789abcdef';
process.env.WEB_SESSION_ENCRYPTION_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString(
  'base64',
);
process.env.WEB_SESSION_ENCRYPTION_KEY_VERSION = '1';
process.env.WEB_SESSION_IDLE_TTL = '30m';
process.env.WEB_SESSION_ABSOLUTE_TTL = '12h';
process.env.WEB_SESSION_LOCK_TTL_MS = '5000';
process.env.MENYA_BFF_SHARED_SECRET = 'test-bff-shared-secret-0123456789abcdefghi';
process.env.AUTH_FARMER_REQUIRES_APPROVAL = 'true';
process.env.AUTH_EXPOSE_RESET_TOKEN = 'false';
// High limits so suites are not throttled; throttling has a dedicated test.
process.env.RATE_LIMIT_MAX = '10000';
process.env.AUTH_RATE_LIMIT_MAX = '10000';
// Tests run pipeline jobs directly instead of through a BullMQ worker.
process.env.KNOWLEDGE_WORKER_ENABLED = 'false';
process.env.KNOWLEDGE_STORAGE_DIR = join(tmpdir(), `menyamuhinzi-knowledge-test-${process.pid}`);
process.env.KNOWLEDGE_MAX_FILE_BYTES = '262144';
process.env.KNOWLEDGE_CHUNK_SIZE = '400';
process.env.KNOWLEDGE_CHUNK_OVERLAP = '80';
process.env.AI_WORKER_ENABLED = 'false';
process.env.NOTIFICATIONS_WORKER_ENABLED = 'false';
// Password-reset deliveries are asserted from the (faked) queue, never sent by a real worker.
process.env.PASSWORD_RESET_WORKER_ENABLED = 'false';
