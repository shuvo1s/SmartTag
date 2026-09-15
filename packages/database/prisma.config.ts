import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// A process environment always wins. Otherwise packages/database/.env is used, then the API's
// development environment file (apps/api/.env), which already holds DATABASE_URL on most setups.
for (const candidate of [resolve(__dirname, '.env'), resolve(__dirname, '../../apps/api/.env')]) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate, quiet: true });
  }
}

/**
 * Prisma CLI configuration (Prisma 7). The connection URL lives here rather than in schema.prisma.
 * Migrations are always created with `prisma migrate dev` against a disposable database and applied
 * with `prisma migrate deploy`; `prisma db push` is not part of the workflow.
 *
 * DATABASE_URL is read leniently so that `prisma generate` (part of build) works without a
 * database; commands that need a connection fail with Prisma's own "missing URL" error.
 * The development seed lives with the API (apps/api/prisma/seed.ts) because it uses API services.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
