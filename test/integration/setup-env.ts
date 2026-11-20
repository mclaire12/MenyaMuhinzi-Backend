import { resolveTestDatabaseUrl } from './database-url';

// Runs before the shared test/setup-env.ts, which keeps an existing DATABASE_URL.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
