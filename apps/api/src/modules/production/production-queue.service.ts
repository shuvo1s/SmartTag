import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  JOB_NAMES,
  QUEUE_NAMES,
  productionJobId,
  type ProductionExpandJob,
  type ProductionReleaseJob,
} from '@smarttag/shared-types';
import { Queue } from 'bullmq';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { APP_CONFIG, type AppConfig } from '../../config/env.schema';

const PRODUCTION_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

/**
 * Producer side of the production queue (the worker consumes it). Expanding a dataset into tags
 * and finishing a released job never run in the API process, so the application stays responsive
 * whether a job produces ten tags or a million.
 *
 * Job ids are derived from the job and its run number, so a duplicate enqueue (a double click, a
 * retried request) is the same BullMQ job: never a second expansion, never a second serial range.
 */
@Injectable()
export class ProductionQueueService implements OnModuleDestroy {
  private queue: Queue | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Throws SERVICE_UNAVAILABLE before anything is changed when background jobs are missing. */
  assertAvailable(): void {
    if (!this.config.redis) {
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        'Production jobs need background processing, which is not configured (REDIS_URL).',
      );
    }
  }

  private connection(): Queue {
    this.assertAvailable();
    this.queue ??= new Queue(QUEUE_NAMES.PRODUCTION, {
      connection: { url: this.config.redis!.url, maxRetriesPerRequest: 3 },
    });
    return this.queue;
  }

  async enqueueExpansion(actor: ActorContext, jobId: string, expansionRun: number): Promise<void> {
    const payload: ProductionExpandJob = {
      correlationId: actor.requestId?.slice(0, 100) ?? null,
      requestedAt: new Date().toISOString(),
      organizationId: actor.organizationId,
      productionJobId: jobId,
      requestedByUserId: actor.userId,
      expansionRun,
    };
    await this.connection().add(JOB_NAMES.PRODUCTION_EXPAND, payload, {
      ...PRODUCTION_JOB_OPTIONS,
      jobId: productionJobId('expand', jobId, expansionRun),
    });
  }

  async enqueueRelease(actor: ActorContext, jobId: string, releaseRun: number): Promise<void> {
    const payload: ProductionReleaseJob = {
      correlationId: actor.requestId?.slice(0, 100) ?? null,
      requestedAt: new Date().toISOString(),
      organizationId: actor.organizationId,
      productionJobId: jobId,
      requestedByUserId: actor.userId,
      releaseRun,
    };
    await this.connection().add(JOB_NAMES.PRODUCTION_RELEASE, payload, {
      ...PRODUCTION_JOB_OPTIONS,
      jobId: productionJobId('release', jobId, releaseRun),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
