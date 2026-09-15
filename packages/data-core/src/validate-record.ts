import {
  FORBIDDEN_FIELD_KEYS,
  checkFieldRules,
  isReservedFieldKey,
  type DataField,
  type DataSchema,
  type NormalizedFieldValue,
} from '@smarttag/document-schema';
import type { DataIssue } from './issues';
import { DATA_LIMITS } from './limits';
import { normalizeFieldValue, type EmptyKind } from './normalize-value';

/** A normalized value, or null when the field has no value. */
export type NormalizedValue = NormalizedFieldValue | null;

/**
 * A record in canonical form: exactly the schema's field keys (sorted), each holding its typed,
 * normalized value or null. Defaults are applied. It is a null-prototype object, so no key can
 * reach JavaScript object internals. The same logical record always has the same representation.
 */
export type NormalizedDataRecord = Readonly<Record<string, NormalizedValue>>;

/** Where a field's normalized value came from. */
export type FieldValueSource = 'RECORD' | 'DEFAULT' | 'NONE';

export interface FieldValueStatus {
  readonly key: string;
  readonly source: FieldValueSource;
  /** Present when the field had no usable value. */
  readonly empty: EmptyKind | null;
  /** The record held a value that failed type, format or rule checks. */
  readonly invalid: boolean;
}

export interface DataRecordValidation {
  /** True when no ERROR was found. */
  readonly valid: boolean;
  /** DATA-layer issues in schema field order, followed by record-level issues. */
  readonly issues: readonly DataIssue[];
  readonly normalizedRecord: NormalizedDataRecord;
  readonly fields: readonly FieldValueStatus[];
  /** Keys whose record value was invalid (their normalized value is null). */
  readonly invalidFields: ReadonlySet<string>;
}

function dataIssue(
  code: DataIssue['code'],
  severity: DataIssue['severity'],
  field: string | null,
  message: string,
): DataIssue {
  return { layer: 'DATA', code, severity, field, message, target: null };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

const REQUIRED_CODES = {
  MISSING: 'REQUIRED_VALUE_MISSING',
  NULL: 'REQUIRED_VALUE_NULL',
  EMPTY: 'REQUIRED_VALUE_EMPTY',
} as const;

const REQUIRED_MESSAGES = {
  MISSING: 'is required but not present in the record',
  NULL: 'is required but null',
  EMPTY: 'is required but empty',
} as const;

/**
 * Validates one data record against a data schema and normalizes it.
 *
 * Shared by the designer's Test Data, the validation API and (later) CSV/Excel imports, VDP
 * workers and integrations. Input is untrusted: it is read with own-property checks only and
 * never merged into other objects, so keys such as "__proto__" cannot pollute prototypes.
 *
 * Per field:
 *   1. record value, validated for type and format, then against the field's rules
 *   2. otherwise the field default
 *   3. otherwise no value: an ERROR for required fields; optional fields stay null and the
 *      document's missing-data policy decides at binding resolution
 */
export function validateDataRecord(schema: DataSchema, input: unknown): DataRecordValidation {
  const issues: DataIssue[] = [];
  const fieldIssues: DataIssue[] = [];
  const values: Record<string, NormalizedValue> = Object.create(null) as Record<
    string,
    NormalizedValue
  >;
  const statuses: FieldValueStatus[] = [];
  const invalidFields = new Set<string>();

  let record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (!isPlainRecord(input)) {
    issues.push(
      dataIssue(
        'INVALID_RECORD',
        'ERROR',
        null,
        'A data record must be an object of field keys and values',
      ),
    );
  } else {
    const keys = Object.keys(input);
    if (keys.length > DATA_LIMITS.maxRecordKeys) {
      issues.push(
        dataIssue(
          'PAYLOAD_LIMIT_EXCEEDED',
          'ERROR',
          null,
          `A record may contain at most ${DATA_LIMITS.maxRecordKeys} keys (received ${keys.length})`,
        ),
      );
    } else {
      record = input;
      const known = new Set(schema.fields.map((field) => field.key));
      for (const key of keys) {
        if (known.has(key)) continue;
        if (FORBIDDEN_FIELD_KEYS.includes(key) || isReservedFieldKey(key)) {
          issues.push(
            dataIssue(
              'FORBIDDEN_FIELD_KEY',
              'ERROR',
              null,
              `"${truncate(key)}" is a reserved key and cannot be used in data records`,
            ),
          );
        } else {
          issues.push(
            dataIssue(
              'UNKNOWN_FIELD',
              'WARNING',
              null,
              `"${truncate(key)}" is not a field of this template and is ignored`,
            ),
          );
        }
      }
    }
  }

  for (const field of schema.fields) {
    const raw = Object.hasOwn(record, field.key) ? record[field.key] : undefined;
    const status = validateField(field, raw, fieldIssues, invalidFields);
    values[field.key] = status.value;
    statuses.push(status.status);
  }

  const sorted: Record<string, NormalizedValue> = Object.create(null) as Record<
    string,
    NormalizedValue
  >;
  for (const key of Object.keys(values).sort()) sorted[key] = values[key]!;

  const all = [...fieldIssues, ...issues];
  return {
    valid: !all.some((issue) => issue.severity === 'ERROR'),
    issues: all,
    normalizedRecord: Object.freeze(sorted),
    fields: statuses,
    invalidFields,
  };
}

function validateField(
  field: DataField,
  raw: unknown,
  issues: DataIssue[],
  invalidFields: Set<string>,
): { value: NormalizedValue; status: FieldValueStatus } {
  const normalized = normalizeFieldValue(field, raw);

  if (normalized.kind === 'VALUE') {
    const violations = checkFieldRules(field, normalized.value);
    if (violations.length === 0) {
      return {
        value: normalized.value,
        status: { key: field.key, source: 'RECORD', empty: null, invalid: false },
      };
    }
    for (const violation of violations) {
      issues.push(dataIssue(violation.code, 'ERROR', field.key, violation.message));
    }
    invalidFields.add(field.key);
    return {
      value: null,
      status: { key: field.key, source: 'RECORD', empty: null, invalid: true },
    };
  }

  if (normalized.kind === 'INVALID') {
    issues.push(dataIssue(normalized.code, 'ERROR', field.key, normalized.message));
    invalidFields.add(field.key);
    return {
      value: null,
      status: { key: field.key, source: 'RECORD', empty: null, invalid: true },
    };
  }

  if (field.defaultValue !== null) {
    return {
      value: field.defaultValue,
      status: { key: field.key, source: 'DEFAULT', empty: normalized.kind, invalid: false },
    };
  }
  if (field.required) {
    issues.push(
      dataIssue(
        REQUIRED_CODES[normalized.kind],
        'ERROR',
        field.key,
        `${field.displayName} ${REQUIRED_MESSAGES[normalized.kind]}`,
      ),
    );
  }
  return {
    value: null,
    status: { key: field.key, source: 'NONE', empty: normalized.kind, invalid: false },
  };
}

function truncate(key: string): string {
  return key.length > 64 ? `${key.slice(0, 64)}…` : key;
}
