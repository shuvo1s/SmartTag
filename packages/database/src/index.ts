/**
 * @smarttag/database
 *
 * The relational model of SmartTag (PostgreSQL): the Prisma schema, migrations (including the
 * hand-written integrity constraints and triggers) and the generated client. Shared by the API
 * and the worker so both use one schema and one set of types.
 *
 * Conventions are documented in prisma/schema.prisma.
 */
export * from './generated/prisma/client';
export * from './generated/prisma/enums';
export {
  createDatabaseClient,
  prismaClientOptions,
  type DatabaseClientOptions,
  type DbClient,
} from './client';
