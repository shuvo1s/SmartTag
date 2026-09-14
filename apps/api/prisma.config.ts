import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (Prisma 7). The connection URL lives here rather than in schema.prisma.
 * Migrations are always created with `prisma migrate dev` and applied with `prisma migrate deploy`;
 * `prisma db push` is not part of the workflow.
 *
 * DATABASE_URL is read leniently so that `prisma generate` (part of build/typecheck) works without
 * a database; commands that need a connection fail with Prisma's own "missing URL" error.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
