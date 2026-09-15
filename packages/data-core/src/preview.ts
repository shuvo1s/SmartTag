import type { DataSchema, DesignDocument } from '@smarttag/document-schema';
import { DATA_ISSUE_LAYERS, type DataIssue, type DataIssueLayer } from './issues';
import { resolveDocumentBindings, type DocumentResolution } from './resolve';
import {
  checkResolvedLayout,
  checkResolvedObjects,
  type ObjectCheckOptions,
  type TextLayoutProbe,
} from './resolved-checks';
import { validateDataRecord, type DataRecordValidation } from './validate-record';

export type FieldValidationState = 'VALID' | 'WARNING' | 'ERROR';

export interface FieldValidationResult {
  readonly key: string;
  readonly state: FieldValidationState;
  readonly issues: readonly DataIssue[];
}

export interface DataValidationSummary {
  /** Fields of the data schema that were checked. */
  readonly fieldsChecked: number;
  /** Fields without warnings or errors. */
  readonly valid: number;
  /** Fields with warnings but no errors. */
  readonly warnings: number;
  /** Fields with at least one error. */
  readonly errors: number;
  /** Per field, in schema order. */
  readonly fields: readonly FieldValidationResult[];
  /** Issue counts per validation layer. */
  readonly layers: Readonly<Record<DataIssueLayer, { errors: number; warnings: number }>>;
}

/**
 * Counts fields by their worst issue. An issue counts for a field when it names the field
 * (DATA issues, and BINDING issues about missing or invalid values of that field).
 */
export function summarizeDataIssues(
  schema: DataSchema,
  issues: readonly DataIssue[],
): DataValidationSummary {
  const fields = schema.fields.map((field): FieldValidationResult => {
    const own = issues.filter((issue) => issue.field === field.key);
    const state: FieldValidationState = own.some((issue) => issue.severity === 'ERROR')
      ? 'ERROR'
      : own.length > 0
        ? 'WARNING'
        : 'VALID';
    return { key: field.key, state, issues: own };
  });
  const layers = Object.fromEntries(
    DATA_ISSUE_LAYERS.map((layer) => [
      layer,
      {
        errors: issues.filter((issue) => issue.layer === layer && issue.severity === 'ERROR')
          .length,
        warnings: issues.filter((issue) => issue.layer === layer && issue.severity === 'WARNING')
          .length,
      },
    ]),
  ) as unknown as DataValidationSummary['layers'];
  return {
    fieldsChecked: fields.length,
    valid: fields.filter((field) => field.state === 'VALID').length,
    warnings: fields.filter((field) => field.state === 'WARNING').length,
    errors: fields.filter((field) => field.state === 'ERROR').length,
    fields,
    layers,
  };
}

export interface DataPreviewOptions extends ObjectCheckOptions {
  /** Enables LAYOUT checks; browsers pass the text layout engine that measures real fonts. */
  readonly textLayout?: TextLayoutProbe;
}

export interface DataPreview {
  readonly record: DataRecordValidation;
  readonly resolution: DocumentResolution;
  /** Every issue, ordered by layer: DATA, BINDING, OBJECT, LAYOUT. */
  readonly issues: readonly DataIssue[];
  readonly summary: DataValidationSummary;
  /** True when no layer reported an ERROR (warnings do not block). */
  readonly productionValid: boolean;
}

/**
 * The complete single-record pipeline on a validated document:
 *
 *   validateDataRecord → resolveDocumentBindings → checkResolvedObjects → checkResolvedLayout
 *
 * The template is an input only: nothing here modifies it, so its hash never changes.
 */
export function buildDataPreview(
  document: DesignDocument,
  rawRecord: unknown,
  options: DataPreviewOptions = {},
): DataPreview {
  const record = validateDataRecord(document.dataSchema, rawRecord);
  const resolution = resolveDocumentBindings(document, record);
  const issues = [
    ...record.issues,
    ...resolution.issues,
    ...checkResolvedObjects(resolution, options),
    ...(options.textLayout ? checkResolvedLayout(resolution, options.textLayout) : []),
  ];
  return {
    record,
    resolution,
    issues,
    summary: summarizeDataIssues(document.dataSchema, issues),
    productionValid: !issues.some((issue) => issue.severity === 'ERROR'),
  };
}
