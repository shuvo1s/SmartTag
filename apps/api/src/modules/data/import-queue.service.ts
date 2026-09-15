import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  JOB_NAMES,
  QUEUE_NAMES,
  importJobId,
  type DataCleanupJob,
  type ImportInspectJob,
  type ImportValidateJob,
} from '@smarttag/shared-types';
import { Queue } from 'bullmq';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { APP_CONFIG, type AppConfig } from '../../config/env.schema';

const IMPORT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

/**
 * Producer side of the import queue (the worker consumes it). Import processing never runs in the
 * API process: uploads, mapping changes and finalization stay fast regardless of file size.
 */
@Injectable()
export class ImportQueueService implements OnModuleDestroy {
  private queue: Queue | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Throws SERVICE_UNAVAILABLE before anything is stored when background jobs are not configured. */
  assertAvailable(): void {
    if (!this.config.redis) {
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        'Data imports need background processing, which is not configured (REDIS_URL).',
      );
    }
  }

  private connection(): Queue {
    this.assertAvailable();
    this.queue ??= new Queue(QUEUE_NAMES.IMPORTS, {
      connection: { url: this.config.redis!.url, maxRetriesPerRequest: 3 },
    });
    return this.queue;
  }

  async enqueueInspection(
    actor: ActorContext,
    importId: string,
    inspectionRun: number,
  ): Promise<void> {
    const payload: ImportInspectJob = {
      correlationId: actor.requestId?.slice(0, 100) ?? null,
      requestedAt: new Date().toISOString(),
      organizationId: actor.organizationId,
      importId,
      requestedByUserId: actor.userId,
      inspectionRun,
    };
    await this.connection().add(JOB_NAMES.IMPORT_INSPECT, payload, {
      ...IMPORT_JOB_OPTIONS,
      jobId: importJobId('inspect', importId, inspectionRun),
    });
  }

  async enqueueValidation(
    actor: ActorContext,
    importId: string,
    validationRun: number,
  ): Promise<void> {
    const payload: ImportValidateJob = {
      correlationId: actor.requestId?.slice(0, 100) ?? null,
      requestedAt: new Date().toISOString(),
      organizationId: actor.organizationId,
      importId,
      requestedByUserId: actor.userId,
      validationRun,
    };
    await this.connection().add(JOB_NAMES.IMPORT_VALIDATE, payload, {
      ...IMPORT_JOB_OPTIONS,
      jobId: importJobId('validate', importId, validationRun),
    });
  }

  /** Best effort: the scheduled cleanup removes leftovers anyway. */
  async requestCleanup(actor: ActorContext): Promise<void> {
    if (!this.config.redis) return;
    const payload: DataCleanupJob = {
      correlationId: actor.requestId?.slice(0, 100) ?? null,
      requestedAt: new Date().toISOString(),
    };
    try {
      await this.connection().add(JOB_NAMES.DATA_CLEANUP, payload, {
        removeOnComplete: 100,
        removeOnFail: 100,
      });
    } catch {
      // Ignored: cleanup also runs on a schedule.
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
