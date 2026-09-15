import {
  checkRecordAssetReferences,
  checkResolvedObjects,
  resolveDocumentBindings,
  resolvedInputHashPayload,
  validateDataRecord,
  type AssetAvailability,
  type NormalizedDataRecord,
} from '@smarttag/data-core';
import type { DataField, DesignDocument } from '@smarttag/document-schema';
import { recordHashPayload } from './hashing';
import { rowStatusOf, type ImportIssue, type RowIssue, type RowStatus } from './issues';
import { DEFAULT_IMPORT_LIMITS } from './limits';
import { effectiveRules, type MappingDefinition, type MappingEntry } from './mapping';
import { normalizeSourceCell } from './normalize-cell';
import type { ParsingRules } from './parsing-rules';
import type { SourceColumn } from './settings';
import { EMPTY_CELL, type SourceRow } from './source';

/**
 * The single per-row pipeline for every tabular import:
 *
 *   source row → mapping → import normalization (IMPORT issues)
 *     → validateDataRecord (DATA) → tenant asset references (DATA)
 *     → resolveDocumentBindings (BINDING) → checkResolvedObjects (OBJECT)
 *     → record hash + resolved-input hash
 *
 * Everything after import normalization is the Phase 3 engine, unchanged: an imported row is
 * validated exactly like Test Data in the designer or a record sent to the validation API.
 * Layout checks (text overflow) need real font shaping and run in the browser preview only.
 */
export interface RowProcessorOptions {
  /** A validated (and migrated) template document. */
  readonly document: DesignDocument;
  readonly templateVersionHash: string;
  readonly columns: readonly SourceColumn[];
  /** A complete mapping (see validateMapping). */
  readonly mapping: MappingDefinition;
  readonly maxCellChars?: number;
}

interface CompiledEntry {
  readonly entry: MappingEntry;
  readonly field: DataField;
  readonly column: SourceColumn;
  readonly rules: ParsingRules;
}

/** A row after import normalization, before record validation. */
export interface PreparedRow {
  readonly rowNumber: number;
  readonly rawRecord: Readonly<Record<string, unknown>>;
  readonly rejectedFields: ReadonlySet<string>;
  readonly importIssues: readonly ImportIssue[];
}

export interface ProcessedRow {
  readonly rowNumber: number;
  readonly status: RowStatus;
  readonly normalizedRecord: NormalizedDataRecord;
  readonly issues: readonly RowIssue[];
  readonly errorCount: number;
  readonly warningCount: number;
  /** UTF-8 text whose SHA-256 is the record hash (see hashing.ts). */
  readonly recordHashPayload: string;
  /** UTF-8 text whose SHA-256 is the resolved-input hash; null for rows with errors. */
  readonly resolvedInputHashPayload: string | null;
  /** Lower-case normalized text values, for searching rows. */
  readonly searchText: string;
}

const SEARCH_TEXT_LIMIT = 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface RowProcessor {
  prepare(row: SourceRow): PreparedRow;
  /** Asset ids the prepared row supplies for image fields (to look availability up in bulk). */
  imageCandidates(prepared: PreparedRow): string[];
  finish(
    prepared: PreparedRow,
    assetAvailability: (assetId: string) => AssetAvailability,
  ): ProcessedRow;
}

export function createRowProcessor(options: RowProcessorOptions): RowProcessor {
  const { document } = options;
  const schema = document.dataSchema;
  const fields = new Map(schema.fields.map((field) => [field.key, field]));
  const maxCellChars = options.maxCellChars ?? DEFAULT_IMPORT_LIMITS.maxCellChars;
  const order = new Map(schema.fields.map((field, index) => [field.key, index]));
  const compiled: CompiledEntry[] = options.mapping.entries
    .flatMap((entry): CompiledEntry[] => {
      const field = fields.get(entry.field);
      const column = options.columns[entry.column.index];
      if (!field || !column || column.header !== entry.column.header) {
        throw new Error(`Mapping entry for "${entry.field}" does not match the source columns`);
      }
      return [{ entry, field, column, rules: effectiveRules(entry, options.mapping.parsing) }];
    })
    .sort((a, b) => order.get(a.field.key)! - order.get(b.field.key)!);
  const imageEntries = compiled.filter((item) => item.field.type === 'image');

  return {
    prepare(row) {
      const rawRecord: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      const rejected = new Set<string>();
      const importIssues: ImportIssue[] = [];
      for (const item of compiled) {
        const cell = row.cells[item.column.index] ?? EMPTY_CELL;
        const result = normalizeSourceCell(item.field, cell, item.rules, {
          column: item.column,
          maxCellChars,
        });
        importIssues.push(...result.warnings);
        if (result.kind === 'VALUE') {
          rawRecord[item.field.key] = result.value;
        } else if (result.kind === 'EMPTY') {
          // A mapped but empty cell is an empty value ("is required but empty"), not an absent key.
          rawRecord[item.field.key] = '';
        } else {
          rejected.add(item.field.key);
          importIssues.push(result.issue);
        }
      }
      return { rowNumber: row.rowNumber, rawRecord, rejectedFields: rejected, importIssues };
    },

    imageCandidates(prepared) {
      const ids: string[] = [];
      for (const item of imageEntries) {
        const value = prepared.rawRecord[item.field.key];
        if (typeof value !== 'string') continue;
        const id = value.trim().toLowerCase();
        // Only well-formed ids are looked up; anything else is refused by record validation.
        if (UUID.test(id)) ids.push(id);
      }
      return ids;
    },

    finish(prepared, assetAvailability) {
      const record = validateDataRecord(schema, prepared.rawRecord, {
        rejectedFields: prepared.rejectedFields,
      });
      const assetIssues = checkRecordAssetReferences(schema, record, assetAvailability);
      const resolution = resolveDocumentBindings(document, record);
      const issues: RowIssue[] = [
        ...prepared.importIssues,
        ...record.issues,
        ...assetIssues,
        ...resolution.issues,
        ...checkResolvedObjects(resolution, { assetAvailability }),
      ];
      const status = rowStatusOf(issues);
      const errorCount = issues.filter((issue) => issue.severity === 'ERROR').length;
      return {
        rowNumber: prepared.rowNumber,
        status,
        normalizedRecord: record.normalizedRecord,
        issues,
        errorCount,
        warningCount: issues.length - errorCount,
        recordHashPayload: recordHashPayload(record.normalizedRecord),
        resolvedInputHashPayload:
          status === 'ERROR'
            ? null
            : resolvedInputHashPayload(options.templateVersionHash, record.normalizedRecord),
        searchText: searchTextOf(record.normalizedRecord),
      };
    },
  };
}

function searchTextOf(record: NormalizedDataRecord): string {
  const parts: string[] = [];
  let length = 0;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value === null || value === undefined) continue;
    const text = String(value).toLowerCase();
    parts.push(text);
    length += text.length + 1;
    if (length >= SEARCH_TEXT_LIMIT) break;
  }
  return parts.join(' ').slice(0, SEARCH_TEXT_LIMIT);
}
