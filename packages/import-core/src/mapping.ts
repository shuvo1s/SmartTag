import { MAX_DATA_FIELDS, type DataField, type DataSchema } from '@smarttag/document-schema';
import { z } from 'zod';
import { issueColumn, type MappingIssue } from './issues';
import {
  BooleanFormatSchema,
  DEFAULT_PARSING_RULES,
  DateFormatSchema,
  NumberFormatSchema,
  ParsingRulesSchema,
  type ParsingRules,
} from './parsing-rules';
import { describeColumn, type SourceColumn } from './settings';

export const MAPPING_DEFINITION_VERSION = 1 as const;

/** Identity of a source column inside a mapping: its position and the header text found there. */
export const MappedColumnSchema = z.strictObject({
  index: z.number().int().min(0).max(16_383),
  header: z.string().max(1_000),
});
export type MappedColumn = z.infer<typeof MappedColumnSchema>;

/**
 * One target field fed by one source column. Per-field parsing overrides apply only to fields of
 * the matching type (number/decimal, date, boolean); null uses the mapping's parsing rules.
 */
export const MappingEntrySchema = z.strictObject({
  field: z.string().min(1).max(64),
  column: MappedColumnSchema,
  number: NumberFormatSchema.nullable(),
  dateFormat: DateFormatSchema.nullable(),
  boolean: BooleanFormatSchema.nullable(),
});
export type MappingEntry = z.infer<typeof MappingEntrySchema>;

export const MappingDefinitionSchema = z.strictObject({
  version: z.literal(MAPPING_DEFINITION_VERSION),
  entries: z.array(MappingEntrySchema).max(MAX_DATA_FIELDS),
  parsing: ParsingRulesSchema,
});
export type MappingDefinition = z.infer<typeof MappingDefinitionSchema>;

export function emptyMapping(parsing: ParsingRules = DEFAULT_PARSING_RULES): MappingDefinition {
  return { version: MAPPING_DEFINITION_VERSION, entries: [], parsing };
}

export function mappingEntry(
  field: string,
  column: Pick<SourceColumn, 'index' | 'header'>,
): MappingEntry {
  return {
    field,
    column: { index: column.index, header: column.header },
    number: null,
    dateFormat: null,
    boolean: null,
  };
}

/** The rules that apply to one entry: its overrides on top of the mapping's parsing rules. */
export function effectiveRules(entry: MappingEntry, parsing: ParsingRules): ParsingRules {
  return {
    ...parsing,
    number: entry.number ?? parsing.number,
    dateFormat: entry.dateFormat ?? parsing.dateFormat,
    boolean: entry.boolean ?? parsing.boolean,
  };
}

export interface MappingValidation {
  readonly issues: readonly MappingIssue[];
  /** No ERROR issues: the mapping can be used to validate rows. */
  readonly complete: boolean;
  /** Target fields with a source column, in schema order. */
  readonly mappedFields: readonly string[];
  /** Source columns not used by any entry (they are ignored). */
  readonly ignoredColumns: readonly number[];
  /** Required fields without a default that no column feeds. */
  readonly unmappedRequiredFields: readonly string[];
  /** Other fields without a column: their default or the missing-data policy applies. */
  readonly unmappedOptionalFields: readonly string[];
}

/**
 * Checks a mapping against the template's data schema and the source columns:
 * - every entry targets an existing field, at most one column per field
 * - every entry's column still exists with the same header text
 * - required fields without a default are mapped (REQUIRED_MAPPING_MISSING)
 * - per-field parsing overrides fit the field type
 * One column may feed several fields.
 */
export function validateMapping(
  schema: DataSchema,
  columns: readonly SourceColumn[],
  mapping: MappingDefinition,
): MappingValidation {
  const issues: MappingIssue[] = [];
  const fields = new Map(schema.fields.map((field) => [field.key, field]));
  const byField = new Map<string, MappingEntry>();
  const usedColumns = new Set<number>();

  for (const entry of mapping.entries) {
    const field = fields.get(entry.field);
    const column = columns[entry.column.index];
    const columnRef = column && column.header === entry.column.header ? issueColumn(column) : null;
    if (!field) {
      issues.push({
        code: 'UNKNOWN_TARGET_FIELD',
        severity: 'ERROR',
        message: `"${entry.field}" is not a field of this template`,
        field: entry.field,
        column: columnRef,
      });
      continue;
    }
    if (byField.has(entry.field)) {
      issues.push({
        code: 'TARGET_FIELD_ALREADY_MAPPED',
        severity: 'ERROR',
        message: `${field.displayName} (${field.key}) is already mapped to another column; a field takes values from one column only`,
        field: entry.field,
        column: columnRef,
      });
      continue;
    }
    if (!column || column.header !== entry.column.header) {
      issues.push({
        code: 'SOURCE_COLUMN_NOT_FOUND',
        severity: 'ERROR',
        message: entry.column.header
          ? `Column "${entry.column.header}" mapped to ${field.displayName} is not in the source at the same position`
          : `The unnamed column mapped to ${field.displayName} is not in the source`,
        field: entry.field,
        column: null,
      });
      continue;
    }
    byField.set(entry.field, entry);
    usedColumns.add(column.index);
    if (!column.header) {
      issues.push({
        code: 'UNNAMED_COLUMN_MAPPED',
        severity: 'WARNING',
        message: `${describeColumn(column)} has no header; check that it holds ${field.displayName}`,
        field: entry.field,
        column: columnRef,
      });
    } else if (column.duplicate) {
      const others = columns
        .filter((other) => other.header === column.header && other.index !== column.index)
        .map((other) => other.letter);
      issues.push({
        code: 'DUPLICATE_HEADER_MAPPED',
        severity: 'WARNING',
        message: `"${column.header}" appears more than once; ${field.displayName} uses column ${column.letter}, not ${others.join(', ')}`,
        field: entry.field,
        column: columnRef,
      });
    }
    for (const problem of overrideProblems(field, entry)) {
      issues.push({
        code: 'PARSING_OPTION_NOT_APPLICABLE',
        severity: 'ERROR',
        message: problem,
        field: entry.field,
        column: columnRef,
      });
    }
  }

  const unmappedRequiredFields: string[] = [];
  const unmappedOptionalFields: string[] = [];
  for (const field of schema.fields) {
    if (byField.has(field.key)) continue;
    if (field.required && field.defaultValue === null) {
      unmappedRequiredFields.push(field.key);
      issues.push({
        code: 'REQUIRED_MAPPING_MISSING',
        severity: 'ERROR',
        message: `Required field "${field.key}" (${field.displayName}) is not mapped and has no default`,
        field: field.key,
        column: null,
      });
    } else {
      unmappedOptionalFields.push(field.key);
    }
  }

  return {
    issues,
    complete: !issues.some((issue) => issue.severity === 'ERROR'),
    mappedFields: schema.fields.filter((field) => byField.has(field.key)).map((field) => field.key),
    ignoredColumns: columns
      .filter((column) => !usedColumns.has(column.index))
      .map((column) => column.index),
    unmappedRequiredFields,
    unmappedOptionalFields,
  };
}

function overrideProblems(field: DataField, entry: MappingEntry): string[] {
  const problems: string[] = [];
  if (entry.number && field.type !== 'number' && field.type !== 'decimal') {
    problems.push(
      `${field.displayName} is not a number field; its number format override does not apply`,
    );
  }
  if (entry.dateFormat && field.type !== 'date') {
    problems.push(
      `${field.displayName} is not a date field; its date format override does not apply`,
    );
  }
  if (entry.boolean && field.type !== 'boolean') {
    problems.push(
      `${field.displayName} is not a true/false field; its boolean values override does not apply`,
    );
  }
  return problems;
}

/**
 * The deterministic form of a mapping stored with a dataset version and hashed into the dataset
 * hash: entries sorted by target field, parsing rules as configured (tokens trimmed).
 */
export function canonicalMapping(mapping: MappingDefinition): MappingDefinition {
  return {
    version: MAPPING_DEFINITION_VERSION,
    entries: [...mapping.entries]
      .sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0))
      .map((entry) => ({
        field: entry.field,
        column: { index: entry.column.index, header: entry.column.header },
        number: entry.number ? { ...entry.number } : null,
        dateFormat: entry.dateFormat,
        boolean: entry.boolean
          ? {
              trueValues: [...entry.boolean.trueValues],
              falseValues: [...entry.boolean.falseValues],
            }
          : null,
      })),
    parsing: {
      trimWhitespace: mapping.parsing.trimWhitespace,
      emptyValues: [...mapping.parsing.emptyValues],
      number: { ...mapping.parsing.number },
      dateFormat: mapping.parsing.dateFormat,
      boolean: {
        trueValues: [...mapping.parsing.boolean.trueValues],
        falseValues: [...mapping.parsing.boolean.falseValues],
      },
    },
  };
}

/**
 * Keeps the entries whose column is still present (same position and header) after the source
 * settings changed, e.g. another header row was chosen. Returns the removed entries for display.
 */
export function retainMappableEntries(
  mapping: MappingDefinition,
  columns: readonly SourceColumn[],
): { readonly mapping: MappingDefinition; readonly removed: readonly MappingEntry[] } {
  const kept: MappingEntry[] = [];
  const removed: MappingEntry[] = [];
  for (const entry of mapping.entries) {
    const column = columns[entry.column.index];
    if (column && column.header === entry.column.header) kept.push(entry);
    else removed.push(entry);
  }
  return { mapping: { ...mapping, entries: kept }, removed };
}
