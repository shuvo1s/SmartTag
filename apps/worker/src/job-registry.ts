import type { Logger } from 'pino';
import type { z } from 'zod';

/** Minimal view of a queued job, independent of the queue library. */
export interface QueuedJob {
  readonly id?: string;
  readonly name: string;
  readonly data: unknown;
  readonly attemptsMade: number;
  /** Attempts configured for the job (BullMQ `opts.attempts`); 1 when not retried. */
  readonly opts?: { readonly attempts?: number };
}

export interface JobContext {
  readonly jobId: string | null;
  readonly correlationId: string | null;
  readonly logger: Logger;
  /** No retry follows if this attempt fails. */
  readonly finalAttempt: boolean;
}

export interface JobHandler<TSchema extends z.ZodType = z.ZodType> {
  readonly name: string;
  /** Payloads are validated at the boundary; handlers receive typed, trusted data. */
  readonly schema: TSchema;
  handle(payload: z.output<TSchema>, context: JobContext): Promise<unknown>;
}

/** A failure that retrying cannot fix (unknown job type, invalid payload). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export function defineJobHandler<TSchema extends z.ZodType>(
  handler: JobHandler<TSchema>,
): JobHandler<TSchema> {
  return handler;
}

/**
 * Builds a single dispatch function for a queue. Unknown job names and invalid payloads fail
 * permanently; handler errors propagate so the queue's retry policy applies.
 */
export function createJobDispatcher(handlers: readonly JobHandler[], logger: Logger) {
  const byName = new Map<string, JobHandler>();
  for (const handler of handlers) {
    if (byName.has(handler.name)) {
      throw new Error(`Duplicate job handler "${handler.name}"`);
    }
    byName.set(handler.name, handler);
  }

  return async function dispatch(job: QueuedJob): Promise<unknown> {
    const handler = byName.get(job.name);
    if (!handler) {
      throw new PermanentJobError(`No handler registered for job "${job.name}"`);
    }
    const parsed = handler.schema.safeParse(job.data);
    if (!parsed.success) {
      throw new PermanentJobError(
        `Invalid payload for job "${job.name}": ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      );
    }
    const payload = parsed.data as { correlationId?: unknown };
    const correlationId = typeof payload.correlationId === 'string' ? payload.correlationId : null;
    const jobLogger = logger.child({
      jobId: job.id ?? null,
      jobName: job.name,
      correlationId,
      attempt: job.attemptsMade + 1,
    });
    return handler.handle(parsed.data, {
      jobId: job.id ?? null,
      correlationId,
      logger: jobLogger,
      finalAttempt: job.attemptsMade + 1 >= (job.opts?.attempts ?? 1),
    });
  };
}
