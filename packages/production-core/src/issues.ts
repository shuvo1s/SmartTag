import type { DataIssue, DataIssueSeverity } from '@smarttag/data-core';

/**
 * PRODUCTION layer: problems that only exist when data becomes tags — the number of copies a
 * record asks for, and the limits that protect the system from one row turning into millions of
 * instances. Everything else (data, bindings, objects) keeps the Phase 3 layers and codes.
 */
export const PRODUCTION_ISSUE_CODES = [
  'QUANTITY_VALUE_MISSING',
  'QUANTITY_VALUE_INVALID',
  'QUANTITY_LIMIT_EXCEEDED',
  'SERIAL_VALUE_UNAVAILABLE',
] as const;
export type ProductionIssueCode = (typeof PRODUCTION_ISSUE_CODES)[number];

export interface ProductionIssue {
  readonly layer: 'PRODUCTION';
  readonly code: ProductionIssueCode;
  readonly severity: DataIssueSeverity;
  readonly message: string;
  /** Data field the issue concerns (the quantity field), or null. */
  readonly field: string | null;
  readonly target: null;
}

/** Every issue that can be stored on a production instance. */
export type InstanceIssue = ProductionIssue | DataIssue;

export type InstanceStatus = 'VALID' | 'WARNING' | 'ERROR';

export function instanceStatusOf(issues: readonly InstanceIssue[]): InstanceStatus {
  if (issues.some((issue) => issue.severity === 'ERROR')) return 'ERROR';
  return issues.length > 0 ? 'WARNING' : 'VALID';
}

export function productionIssue(
  code: ProductionIssueCode,
  severity: DataIssueSeverity,
  message: string,
  field: string | null = null,
): ProductionIssue {
  return { layer: 'PRODUCTION', code, severity, message, field, target: null };
}
