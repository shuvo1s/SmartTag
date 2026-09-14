import { z } from 'zod';

/**
 * Background job contracts shared by producers (api) and consumers (worker).
 * Every job payload carries a correlationId so a job can be traced back to the originating request.
 * Queue names must not contain ":" (reserved by BullMQ key prefixes).
 */
export const QUEUE_NAMES = {
  SYSTEM: 'smarttag-system',
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  SYSTEM_PING: 'system.ping',
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
