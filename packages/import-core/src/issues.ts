import type { DataIssue } from '@smarttag/data-core';
import type { SourceColumn } from './settings';

/**
 * IMPORT layer issues: problems reading a source value for a data field, before the shared
 * Phase 3 validation (DATA → BINDING → OBJECT) runs on the resulting record. They use the same
 * shape as data-core issues, plus the source column, so one issue list and one UI serve both.
 */
export const IMPORT_ISSUE_CODES = [
  'SOURCE_VALUE_INVALID',
  'NUMBER_PARSE_FAILED',
  'DECIMAL_PARSE_FAILED',
  'DATE_PARSE_FAILED',
  'BOOLEAN_PARSE_FAILED',
  'IMAGE_REFERENCE_NOT_SUPPORTED',
  'CELL_TOO_LONG',
  'FORMULA_VALUE_UNAVAILABLE',
  'FORMULA_CACHED_VALUE',
  'DATE_TIME_IGNORED',
] as const;
export type ImportIssueCode = (typeof IMPORT_ISSUE_CODES)[number];

export interface ImportIssueColumn {
  readonly index: number;
  readonly letter: string;
  readonly header: string;
}

export interface ImportIssue {
  readonly layer: 'IMPORT';
  readonly code: ImportIssueCode;
  readonly severity: 'ERROR' | 'WARNING';
  readonly message: string;
  readonly field: string | null;
  readonly target: null;
  readonly column: ImportIssueColumn | null;
}

/** Every issue a row can carry, ordered IMPORT, DATA, BINDING, OBJECT. */
export type RowIssue = ImportIssue | DataIssue;

export const ROW_STATUSES = ['VALID', 'WARNING', 'ERROR'] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];

export function rowStatusOf(issues: readonly RowIssue[]): RowStatus {
  if (issues.some((issue) => issue.severity === 'ERROR')) return 'ERROR';
  return issues.length > 0 ? 'WARNING' : 'VALID';
}

export function issueColumn(
  column: Pick<SourceColumn, 'index' | 'letter' | 'header'>,
): ImportIssueColumn {
  return { index: column.index, letter: column.letter, header: column.header };
}

/**
 * Mapping-level problems (before any row is read). ERROR issues keep an import from being
 * validated; WARNING issues are shown with the mapping.
 */
export const MAPPING_ISSUE_CODES = [
  'UNKNOWN_TARGET_FIELD',
  'TARGET_FIELD_ALREADY_MAPPED',
  'SOURCE_COLUMN_NOT_FOUND',
  'REQUIRED_MAPPING_MISSING',
  'PARSING_OPTION_NOT_APPLICABLE',
  'UNNAMED_COLUMN_MAPPED',
  'DUPLICATE_HEADER_MAPPED',
  'SOURCE_SETTINGS_INCOMPLETE',
] as const;
export type MappingIssueCode = (typeof MAPPING_ISSUE_CODES)[number];

export interface MappingIssue {
  readonly code: MappingIssueCode;
  readonly severity: 'ERROR' | 'WARNING';
  readonly message: string;
  readonly field: string | null;
  readonly column: ImportIssueColumn | null;
}
