import { MAX_SERIAL_AFFIX, MAX_SERIAL_PADDING } from '@smarttag/production-core';
import { z } from 'zod';
import type { UserRefDto } from './templates';

/**
 * Serial number sequences. Numbers are handed out by the server in reserved ranges; the format
 * (prefix, padding, suffix) belongs to the sequence, so the same number always reads the same way.
 */
export const SequenceCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, {
    error: 'Use capital letters, digits and hyphens, e.g. "YT-HANGTAG"',
  });

export const CreateSequenceRequestSchema = z.object({
  name: z.string().trim().min(1, { error: 'Enter a name' }).max(200),
  code: SequenceCodeSchema,
  description: z.string().trim().max(2000).default(''),
  prefix: z.string().max(MAX_SERIAL_AFFIX).default(''),
  suffix: z.string().max(MAX_SERIAL_AFFIX).default(''),
  padding: z.number().int().min(0).max(MAX_SERIAL_PADDING).default(0),
  /** Where the sequence starts; only allowed while it has never been used. */
  startValue: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
});
export type CreateSequenceRequest = z.input<typeof CreateSequenceRequestSchema>;
export type CreateSequenceCommand = z.output<typeof CreateSequenceRequestSchema>;

export const UpdateSequenceRequestSchema = z.object({
  expectedRevision: z.number().int().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  prefix: z.string().max(MAX_SERIAL_AFFIX).optional(),
  suffix: z.string().max(MAX_SERIAL_AFFIX).optional(),
  padding: z.number().int().min(0).max(MAX_SERIAL_PADDING).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});
export type UpdateSequenceRequest = z.infer<typeof UpdateSequenceRequestSchema>;

export const ListSequencesQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});
export type ListSequencesQuery = z.infer<typeof ListSequencesQuerySchema>;

export interface SequenceDto {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly description: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly padding: number;
  /** The next number the sequence will hand out. */
  readonly nextValue: number;
  /** What that number looks like, e.g. "YT-00001257". */
  readonly nextSerial: string;
  readonly resetPolicy: 'NEVER';
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly revision: number;
  /** Ranges already committed to production jobs. */
  readonly reservationCount: number;
  readonly reservedCount: number;
  readonly createdAt: string;
  readonly createdBy: UserRefDto;
  readonly updatedAt: string;
}

export interface SequenceReservationDto {
  readonly sequenceId: string;
  readonly sequenceCode: string;
  readonly sequenceName: string;
  readonly startValue: number;
  readonly endValue: number;
  readonly count: number;
  readonly firstSerial: string;
  readonly lastSerial: string;
  readonly reservedAt: string;
  readonly reservedBy: UserRefDto;
}

/** What the serial numbers of a job would look like; nothing is reserved by asking. */
export interface SerialPreviewDto {
  readonly sequenceId: string;
  readonly sequenceCode: string;
  readonly startValue: number;
  readonly endValue: number;
  readonly first: string;
  readonly last: string;
  readonly samples: readonly string[];
  /** Always true before release: these numbers are not committed to this job yet. */
  readonly provisional: boolean;
}
