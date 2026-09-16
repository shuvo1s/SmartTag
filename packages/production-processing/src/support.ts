import type { PrismaClient } from '@smarttag/database';
import { parseDesignDocument, type DesignDocument } from '@smarttag/document-schema';
import { type ImportLogger } from '@smarttag/import-processing';
import type { ObjectStorage } from '@smarttag/object-storage';
import {
  ProductionConfigurationSchema,
  type ProductionConfiguration,
  type ProductionJobStatus,
} from '@smarttag/production-core';
import { createHash } from 'node:crypto';
import type { ProductionProcessingSettings } from './config';

export { MemorySampler, SILENT_LOGGER, lookupImageAvailability } from '@smarttag/import-processing';
export type { ImportLogger as ProductionLogger } from '@smarttag/import-processing';

export interface ProductionProcessingDeps {
  readonly prisma: PrismaClient;
  readonly storage: ObjectStorage;
  readonly settings: ProductionProcessingSettings;
  readonly logger?: ImportLogger;
  /** False while BullMQ will still retry a failing job; unexpected errors are then rethrown. */
  readonly finalAttempt?: boolean;
}

export type ProductionJobOutcome =
  | { readonly outcome: 'COMPLETED'; readonly status: ProductionJobStatus }
  | { readonly outcome: 'SKIPPED'; readonly reason: string }
  | { readonly outcome: 'FAILED'; readonly code: string };

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** A precondition that will not pass by retrying (the job is misconfigured, not unlucky). */
export class ProductionPreconditionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProductionPreconditionError';
  }
}

/** The job moved on (another run was queued, or it was cancelled) while this job was working. */
export class StaleRunError extends Error {
  constructor() {
    super('The production job changed while it was being processed');
    this.name = 'StaleRunError';
  }
}

export function failureOf(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof ProductionPreconditionError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  return {
    code: 'PROCESSING_ERROR',
    message:
      'The production job could not be processed because of an unexpected error. Try again; if it keeps failing, contact support.',
    retryable: true,
  };
}

export function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The stored configuration, validated; a job that lost its configuration cannot be processed. */
export function configurationOf(value: unknown): ProductionConfiguration {
  const parsed = ProductionConfigurationSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProductionPreconditionError(
      'INVALID_PRODUCTION_CONFIGURATION',
      'The production configuration of this job is not valid.',
    );
  }
  return parsed.data;
}

/** The template version's document, checked against the hash the job was created with. */
export function documentOf(
  documentJson: unknown,
  expectedHash: string,
  hash: string,
): DesignDocument {
  if (hash !== expectedHash) {
    throw new ProductionPreconditionError(
      'PRODUCTION_JOB_IMMUTABLE',
      'The template version changed after this job was created. Create a new production job for the current artwork.',
    );
  }
  const parsed = parseDesignDocument(documentJson);
  if (!parsed.valid) {
    throw new ProductionPreconditionError(
      'INVALID_DOCUMENT',
      'The template version is not a valid design document.',
    );
  }
  return parsed.document;
}

/** Records one step of a job's own history (never one row per instance). */
export async function recordJobEvent(
  prisma: PrismaClient,
  job: { id: string; organizationId: string },
  type: string,
  message: string,
  metadata: Record<string, unknown> = {},
  createdById: string | null = null,
): Promise<void> {
  await prisma.productionJobEvent.create({
    data: {
      organizationId: job.organizationId,
      productionJobId: job.id,
      type,
      message,
      metadata: metadata as never,
      createdById,
    },
  });
}
