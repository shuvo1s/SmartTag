/**
 * Production job lifecycle (docs/production-jobs.md#lifecycle).
 *
 *   DRAFT               being configured; inputs and settings may change
 *   QUEUED              expansion requested, waiting for a worker
 *   EXPANDING           instances are being created
 *   VALIDATING          instances are being resolved and checked
 *   READY               every instance is valid
 *   READY_WITH_WARNINGS valid, but some instances carry warnings
 *   HAS_ERRORS          at least one instance failed; the job cannot be released
 *   RELEASED            inputs, configuration and serial numbers are frozen and reserved
 *   READY_FOR_RENDERING serial numbers written, hashes complete, manifest stored
 *   FAILED              a job step failed (retryable); configuration is still editable in DRAFT
 *   CANCELLED           abandoned by a user; instances are removed
 *
 * READY_FOR_RENDERING is the terminal state of this phase on purpose: nothing has been printed,
 * imposed or turned into a PDF — the job is ready for the rendering phase to consume.
 */
export const PRODUCTION_JOB_STATUSES = [
  'DRAFT',
  'QUEUED',
  'EXPANDING',
  'VALIDATING',
  'READY',
  'READY_WITH_WARNINGS',
  'HAS_ERRORS',
  'RELEASED',
  'READY_FOR_RENDERING',
  'FAILED',
  'CANCELLED',
] as const;
export type ProductionJobStatus = (typeof PRODUCTION_JOB_STATUSES)[number];

/** Statuses in which the job is being worked on by a background job. */
export const PROCESSING_STATUSES: readonly ProductionJobStatus[] = [
  'QUEUED',
  'EXPANDING',
  'VALIDATING',
];

/** Statuses in which expansion has finished and the result can be reviewed. */
export const REVIEWABLE_STATUSES: readonly ProductionJobStatus[] = [
  'READY',
  'READY_WITH_WARNINGS',
  'HAS_ERRORS',
];

/** Statuses from which a job may be released. */
export const RELEASABLE_STATUSES: readonly ProductionJobStatus[] = ['READY', 'READY_WITH_WARNINGS'];

/** Once released, production identity is immutable. */
export const RELEASED_STATUSES: readonly ProductionJobStatus[] = [
  'RELEASED',
  'READY_FOR_RENDERING',
];

const TRANSITIONS: Readonly<Record<ProductionJobStatus, readonly ProductionJobStatus[]>> = {
  DRAFT: ['QUEUED', 'CANCELLED'],
  QUEUED: ['EXPANDING', 'FAILED', 'CANCELLED'],
  EXPANDING: ['VALIDATING', 'READY', 'READY_WITH_WARNINGS', 'HAS_ERRORS', 'FAILED', 'CANCELLED'],
  VALIDATING: ['READY', 'READY_WITH_WARNINGS', 'HAS_ERRORS', 'FAILED', 'CANCELLED'],
  READY: ['DRAFT', 'QUEUED', 'RELEASED', 'CANCELLED'],
  READY_WITH_WARNINGS: ['DRAFT', 'QUEUED', 'RELEASED', 'CANCELLED'],
  HAS_ERRORS: ['DRAFT', 'QUEUED', 'CANCELLED'],
  // A released job is never reconfigured: it only finishes its own release work, or records that
  // the work failed. Its serial reservation stays reserved either way.
  RELEASED: ['READY_FOR_RENDERING', 'FAILED'],
  READY_FOR_RENDERING: [],
  FAILED: ['DRAFT', 'QUEUED', 'RELEASED', 'CANCELLED'],
  CANCELLED: [],
};

export function canTransition(from: ProductionJobStatus, to: ProductionJobStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: ProductionJobStatus): readonly ProductionJobStatus[] {
  return TRANSITIONS[from];
}

export function isReleased(status: ProductionJobStatus): boolean {
  return RELEASED_STATUSES.includes(status);
}

export function isProcessing(status: ProductionJobStatus): boolean {
  return PROCESSING_STATUSES.includes(status);
}

/** The status an expanded job reaches, from the counts of its instances. */
export function statusForCounts(counts: {
  readonly errorCount: number;
  readonly warningCount: number;
}): ProductionJobStatus {
  if (counts.errorCount > 0) return 'HAS_ERRORS';
  return counts.warningCount > 0 ? 'READY_WITH_WARNINGS' : 'READY';
}
