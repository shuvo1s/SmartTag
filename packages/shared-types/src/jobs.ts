import { z } from 'zod';

/**
 * Background job contracts shared by producers (api) and consumers (worker).
 * Every job payload carries a correlationId so a job can be traced back to the originating request.
 * Queue names must not contain ":" (reserved by BullMQ key prefixes).
 */
export const QUEUE_NAMES = {
  SYSTEM: 'smarttag-system',
  IMPORTS: 'smarttag-imports',
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  SYSTEM_PING: 'system.ping',
  IMPORT_INSPECT: 'import.inspect',
  IMPORT_VALIDATE: 'import.validate',
  DATA_CLEANUP: 'data.cleanup',
} as const;
export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

const jobEnvelope = {
  correlationId: z.string().min(1).max(100).nullable(),
  requestedAt: z.iso.datetime(),
};

export const SystemPingJobSchema = z.object({
  ...jobEnvelope,
  message: z.string().max(200),
});
export type SystemPingJob = z.infer<typeof SystemPingJobSchema>;

/**
 * Import jobs identify the import AND the run they were queued for. A job whose run is no longer
 * current (the user changed settings or mapping and a newer run was queued) does nothing, which
 * makes retries and duplicates harmless. The job id is derived from the same values.
 */
export const ImportInspectJobSchema = z.object({
  ...jobEnvelope,
  organizationId: z.uuid(),
  importId: z.uuid(),
  /** The user whose action queued the job (audit attribution). */
  requestedByUserId: z.uuid(),
  inspectionRun: z.number().int().min(1),
});
export type ImportInspectJob = z.infer<typeof ImportInspectJobSchema>;

export const ImportValidateJobSchema = z.object({
  ...jobEnvelope,
  organizationId: z.uuid(),
  importId: z.uuid(),
  /** The user whose action queued the job (audit attribution). */
  requestedByUserId: z.uuid(),
  validationRun: z.number().int().min(1),
});
export type ImportValidateJob = z.infer<typeof ImportValidateJobSchema>;

export const DataCleanupJobSchema = z.object({ ...jobEnvelope });
export type DataCleanupJob = z.infer<typeof DataCleanupJobSchema>;

/** Deterministic BullMQ job ids: queuing the same run twice never creates two jobs. */
export function importJobId(kind: 'inspect' | 'validate', importId: string, run: number): string {
  return `${kind}-${importId}-${run}`;
}
