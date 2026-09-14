import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';

const API_ROOT = resolve(__dirname, '../..');

/**
 * Runs once before the integration suite:
 *   1. refuses anything but a database whose name ends in "_test"
 *   2. drops and recreates the public schema
 *   3. applies every migration from scratch with `prisma migrate deploy`
 * This also proves that the committed migrations apply cleanly to an empty database.
 */
export default async function globalSetup(): Promise<void> {
  loadDotenv({ path: resolve(API_ROOT, '.env'), quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set (see apps/api/.env.example)');
  }
  const databaseName = new URL(url).pathname.replace(/^\//, '');
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to reset "${databaseName}": integration tests require a database whose name ends with "_test"`,
    );
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }

  // A fixed command string (no user input) through the shell so npx resolves on every platform.
  const result = spawnSync('npx prisma migrate deploy', {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed:\n${result.stdout}\n${result.stderr}`);
  }
}
