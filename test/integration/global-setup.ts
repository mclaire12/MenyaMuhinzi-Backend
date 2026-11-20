import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';
import { databaseName, resolveTestDatabaseUrl } from './database-url';

/** Creates the test database if needed, applies migrations and seeds roles and permissions. */
export default async function globalSetup(): Promise<void> {
  const url = resolveTestDatabaseUrl();
  const name = databaseName(url);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  admin.search = '';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }

  const root = join(__dirname, '..', '..');
  const env = { ...process.env, DATABASE_URL: url, SEED_ADMIN_PASSWORD: '' };
  execSync('npx prisma migrate deploy', { cwd: root, env, stdio: 'pipe' });
  execSync('npx prisma db seed', { cwd: root, env, stdio: 'pipe' });
}
