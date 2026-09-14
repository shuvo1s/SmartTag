import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma CLI configuration (Prisma 7). The connection URL lives here rather than in schema.prisma.
 * Migrations are always created with `prisma migrate dev` and applied with `prisma migrate deploy`;
 * `prisma db push` is not part of the workflow.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
