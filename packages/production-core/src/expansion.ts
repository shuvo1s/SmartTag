import type { NormalizedDataRecord } from '@smarttag/data-core';
import type { DataSchema } from '@smarttag/document-schema';
import type { ProductionConfiguration } from './configuration';
import type { ProductionIssue } from './issues';
import type { ProductionLimits } from './limits';
import { resolveQuantity } from './quantity';

/** One dataset record as expansion reads it. */
export interface ExpandableRecord {
  readonly sequence: number;
  readonly rowNumber: number;
  readonly record: NormalizedDataRecord;
  readonly recordHash: string;
}

/** One production instance, before it is resolved. */
export interface PlannedInstance {
  /** 1-based position in the job; the order tags will be produced in. */
  readonly sequence: number;
  readonly recordSequence: number;
  readonly sourceRow: number;
  /** 1-based copy number within the record. */
  readonly copyIndex: number;
  /** Number of copies this record produces. */
  readonly copies: number;
  readonly record: NormalizedDataRecord;
  readonly recordHash: string;
  /** Quantity problems, which make every instance of the record invalid. */
  readonly issues: readonly ProductionIssue[];
}

export class InstanceLimitExceededError extends Error {
  constructor(
    readonly limit: number,
    readonly recordSequence: number,
  ) {
    super(
      `This job would produce more than ${limit.toLocaleString('en-US')} tags (reached at record ${recordSequence}). Reduce the quantities or split the job.`,
    );
    this.name = 'InstanceLimitExceededError';
  }
}

export interface ExpansionOptions {
  readonly configuration: ProductionConfiguration;
  readonly limits: ProductionLimits;
  readonly schema: DataSchema;
  /** Instances already produced by earlier batches (expansion is resumable and batched). */
  readonly startSequence?: number;
}

/**
 * Expands dataset records into production instances, in a deterministic order: records in dataset
 * order, and within a record copy 1, 2, 3 … Duplicated records are expanded exactly like any
 * other record — two identical rows asking for five tags each are ten tags, never five.
 *
 * A record whose quantity cannot be read produces exactly one instance carrying the error, so the
 * problem is visible in the job (and blocks its release) instead of silently removing the record.
 */
export function* expandRecords(
  records: Iterable<ExpandableRecord>,
  options: ExpansionOptions,
): Generator<PlannedInstance> {
  const { configuration, limits, schema } = options;
  let sequence = options.startSequence ?? 1;

  for (const entry of records) {
    const quantity = resolveQuantity(entry.record, configuration, limits, schema);
    const copies = quantity.ok ? quantity.quantity : 1;
    const issues = quantity.ok ? [] : [quantity.issue];
    if (sequence + copies - 1 > limits.maxInstancesPerJob) {
      throw new InstanceLimitExceededError(limits.maxInstancesPerJob, entry.sequence);
    }
    for (let copyIndex = 1; copyIndex <= copies; copyIndex += 1) {
      yield {
        sequence,
        recordSequence: entry.sequence,
        sourceRow: entry.rowNumber,
        copyIndex,
        copies,
        record: entry.record,
        recordHash: entry.recordHash,
        issues,
      };
      sequence += 1;
    }
  }
}

/**
 * How many instances a set of records produces, without building them. Used to show the size of a
 * job and to check the job limit before any work starts.
 */
export function countInstances(
  records: Iterable<ExpandableRecord>,
  options: ExpansionOptions,
): { readonly instanceCount: number; readonly invalidRecords: number } {
  const { configuration, limits, schema } = options;
  let instanceCount = 0;
  let invalidRecords = 0;
  for (const entry of records) {
    const quantity = resolveQuantity(entry.record, configuration, limits, schema);
    if (!quantity.ok) invalidRecords += 1;
    instanceCount += quantity.ok ? quantity.quantity : 1;
    if (instanceCount > limits.maxInstancesPerJob) {
      throw new InstanceLimitExceededError(limits.maxInstancesPerJob, entry.sequence);
    }
  }
  return { instanceCount, invalidRecords };
}
