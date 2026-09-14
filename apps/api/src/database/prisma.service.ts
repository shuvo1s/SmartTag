import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG, type AppConfig } from '../config/env.schema';
import { PrismaClient, type Prisma } from '../generated/prisma/client';

/**
 * Single Prisma client for the process (node-postgres driver adapter, Prisma 7).
 * Tenant scoping is NOT automatic: every query on tenant-owned data must include organizationId.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({ adapter: new PrismaPg({ connectionString: config.database.url }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/** A Prisma client usable both inside and outside an interactive transaction. */
export type DbClient = Prisma.TransactionClient;
