import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from './generated/prisma/client';

export interface DatabaseClientOptions {
  readonly connectionString: string;
  /** Maximum pooled connections for this process (node-postgres pool). */
  readonly maxConnections?: number;
}

/**
 * Constructor options for a Prisma client using the node-postgres driver adapter (Prisma 7).
 * For classes that extend PrismaClient (the API's Nest provider).
 */
export function prismaClientOptions(options: DatabaseClientOptions) {
  return {
    adapter: new PrismaPg({
      connectionString: options.connectionString,
      ...(options.maxConnections === undefined ? {} : { max: options.maxConnections }),
    }),
  };
}

/**
 * A Prisma client for scripts and the worker. One client per process.
 * Tenant scoping is NOT automatic: every query on tenant-owned data must include organizationId.
 */
export function createDatabaseClient(options: DatabaseClientOptions): PrismaClient {
  return new PrismaClient(prismaClientOptions(options));
}

/** A Prisma client usable both inside and outside an interactive transaction. */
export type DbClient = Prisma.TransactionClient;
