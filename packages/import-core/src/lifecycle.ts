/**
 * Import lifecycle (docs/data-imports.md#lifecycle). One explicit status, never a combination of
 * booleans; every change goes through `assertImportTransition` in the application and is checked
 * again by a database trigger.
 *
 *   UPLOADED ──▶ INSPECTING ──▶ MAPPING_REQUIRED ⇄ READY_TO_VALIDATE ──▶ VALIDATING
 *                    ▲                  ▲                  ▲                  │
 *                    └──── source settings changed ────────┴── mapping changed│
 *                                                                              ▼
 *                              FINALIZED ◀── READY / READY_WITH_WARNINGS   HAS_ERRORS
 *
 *   FAILED     processing failed; retry returns to INSPECTING or VALIDATING
 *   CANCELLED  abandoned by a user or expired; terminal
 *   FINALIZED  a dataset version was created; terminal and immutable
 */
export const DATA_IMPORT_STATUSES = [
  'UPLOADED',
  'INSPECTING',
  'MAPPING_REQUIRED',
  'READY_TO_VALIDATE',
  'VALIDATING',
  'READY',
  'READY_WITH_WARNINGS',
  'HAS_ERRORS',
  'FAILED',
  'CANCELLED',
  'FINALIZED',
] as const;
export type DataImportStatus = (typeof DATA_IMPORT_STATUSES)[number];

const VALIDATED: readonly DataImportStatus[] = ['READY', 'READY_WITH_WARNINGS', 'HAS_ERRORS'];

export const DATA_IMPORT_TRANSITIONS: Readonly<
  Record<DataImportStatus, readonly DataImportStatus[]>
> = {
  UPLOADED: ['INSPECTING', 'FAILED', 'CANCELLED'],
  // A re-inspection (e.g. another delimiter) keeps a mapping that still fits: READY_TO_VALIDATE.
  INSPECTING: ['MAPPING_REQUIRED', 'READY_TO_VALIDATE', 'FAILED', 'CANCELLED'],
  MAPPING_REQUIRED: ['MAPPING_REQUIRED', 'READY_TO_VALIDATE', 'INSPECTING', 'CANCELLED'],
  READY_TO_VALIDATE: [
    'MAPPING_REQUIRED',
    'READY_TO_VALIDATE',
    'VALIDATING',
    'INSPECTING',
    'CANCELLED',
  ],
  VALIDATING: [...VALIDATED, 'FAILED', 'CANCELLED'],
  READY: [
    'MAPPING_REQUIRED',
    'READY_TO_VALIDATE',
    'VALIDATING',
    'INSPECTING',
    'FINALIZED',
    'CANCELLED',
  ],
  READY_WITH_WARNINGS: [
    'MAPPING_REQUIRED',
    'READY_TO_VALIDATE',
    'VALIDATING',
    'INSPECTING',
    'FINALIZED',
    'CANCELLED',
  ],
  HAS_ERRORS: ['MAPPING_REQUIRED', 'READY_TO_VALIDATE', 'VALIDATING', 'INSPECTING', 'CANCELLED'],
  FAILED: ['INSPECTING', 'VALIDATING', 'CANCELLED'],
  CANCELLED: [],
  FINALIZED: [],
};

export function canTransitionImport(from: DataImportStatus, to: DataImportStatus): boolean {
  return DATA_IMPORT_TRANSITIONS[from].includes(to);
}

export class ImportTransitionError extends Error {
  constructor(
    readonly from: DataImportStatus,
    readonly to: DataImportStatus,
  ) {
    super(`An import cannot go from ${from} to ${to}`);
    this.name = 'ImportTransitionError';
  }
}

export function assertImportTransition(from: DataImportStatus, to: DataImportStatus): void {
  if (!canTransitionImport(from, to)) throw new ImportTransitionError(from, to);
}

/** Background work is queued or running; settings, mapping and finalization wait for it. */
export function isImportProcessing(status: DataImportStatus): boolean {
  return status === 'UPLOADED' || status === 'INSPECTING' || status === 'VALIDATING';
}

export function isImportTerminal(status: DataImportStatus): boolean {
  return status === 'CANCELLED' || status === 'FINALIZED';
}

/** Source settings and mapping can be changed (and the import revalidated). */
export function canEditImport(status: DataImportStatus): boolean {
  return (
    status === 'MAPPING_REQUIRED' || status === 'READY_TO_VALIDATE' || VALIDATED.includes(status)
  );
}

export function isImportValidated(status: DataImportStatus): boolean {
  return VALIDATED.includes(status);
}

/** Only validation results without errors can become a dataset version. */
export function canFinalizeImport(status: DataImportStatus): boolean {
  return status === 'READY' || status === 'READY_WITH_WARNINGS';
}

/** Status after a successful validation run. */
export function validatedStatus(counts: {
  readonly errorRows: number;
  readonly warningRows: number;
}): DataImportStatus {
  if (counts.errorRows > 0) return 'HAS_ERRORS';
  return counts.warningRows > 0 ? 'READY_WITH_WARNINGS' : 'READY';
}
