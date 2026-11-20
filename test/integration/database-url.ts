import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';

/**
 * Integration tests run against a dedicated PostgreSQL database that they
 * truncate freely. It is TEST_DATABASE_URL when set, otherwise DATABASE_URL
 * (from the environment or `.env`) with `_test` appended to the database name.
 * Anything whose database name does not end in `_test` is refused.
 */
export function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit ?? process.env.DATABASE_URL ?? readDotEnv().DATABASE_URL;
  if (!base) {
    throw new Error('Set TEST_DATABASE_URL or DATABASE_URL to run the integration tests');
  }

  const url = new URL(base);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!explicit && !name.endsWith('_test')) url.pathname = `/${name}_test`;

  const testName = databaseName(url.toString());
  if (!/^[A-Za-z0-9_]+_test$/.test(testName)) {
    throw new Error(
      `Refusing to run integration tests against "${testName}": the name must end with _test`,
    );
  }
  return url.toString();
}

export function databaseName(connectionString: string): string {
  return decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ''));
}

function readDotEnv(): Record<string, string> {
  try {
    return parse(readFileSync(join(__dirname, '..', '..', '.env')));
  } catch {
    return {};
  }
}
