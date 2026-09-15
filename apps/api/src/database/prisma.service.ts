import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, prismaClientOptions } from '@smarttag/database';
import { APP_CONFIG, type AppConfig } from '../config/env.schema';

/**
 * Single Prisma client for the process (node-postgres driver adapter, Prisma 7).
 * Tenant scoping is NOT automatic: every query on tenant-owned data must include organizationId.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(prismaClientOptions({ connectionString: config.database.url }));
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

export type { DbClient } from '@smarttag/database';
