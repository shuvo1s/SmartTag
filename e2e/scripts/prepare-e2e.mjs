#!/usr/bin/env node
/**
 * Prepares the disposable E2E database before Playwright starts the servers:
 *   1. refuses any database whose name does not end in "_e2e"
 *   2. creates the database if needed, then drops and recreates the public schema
 *   3. applies all migrations (`prisma migrate deploy`) and runs the development seed
 *   4. empties the E2E object-storage directory
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { E2E_DATABASE_URL, E2E_STORAGE_ROOT, REPO_ROOT, apiEnvironment } from '../environment.mjs';

const API_ROOT = resolve(REPO_ROOT, 'apps', 'api');
const DATABASE_ROOT = resolve(REPO_ROOT, 'packages', 'database');
const url = new URL(E2E_DATABASE_URL);
const databaseName = url.pathname.replace(/^\//, '');
if (!/^[a-z0-9_]+_e2e$/.test(databaseName)) {
  throw new Error(
    `Refusing to reset "${databaseName}": the E2E database name must end with "_e2e"`,
  );
}

const adminUrl = new URL(E2E_DATABASE_URL);
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  }
} finally {
  await admin.end();
}

const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
await client.connect();
try {
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
} finally {
  await client.end();
}

rmSync(E2E_STORAGE_ROOT, { recursive: true, force: true });

const env = { ...process.env, ...apiEnvironment() };
// Fixed command strings (no user input) run through the shell so npx resolves on every platform.
for (const [command, cwd] of [
  ['npx prisma migrate deploy', DATABASE_ROOT],
  ['npx tsx prisma/seed.ts', API_ROOT],
]) {
  const result = spawnSync(command, { cwd, env, encoding: 'utf8', shell: true });
  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`);
  }
}
console.log(`E2E database "${databaseName}" migrated and seeded`);
