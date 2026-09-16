import { emptyValidationFor, RESERVED_FIELD_KEY_PREFIX, type DataField } from './data-schema';

/**
 * Production system fields (schema v3 onwards, introduced with production jobs).
 *
 * They are deliberately NOT part of a template's data schema: they never appear in
 * `dataSchema.fields`, never change the data schema hash, and never appear in a dataset. Their
 * values belong to one production instance (its serial number, its position in the job) and are
 * supplied by the production context when a job is expanded.
 *
 * Bindings and expressions may use them exactly like data fields. Wherever there is no production
 * context — the designer preview, the Test Data panel, data import validation — they simply have
 * no value: properties that use them resolve empty and are reported as "supplied at production
 * time" instead of as missing data, and object checks (barcode, QR, image) are skipped for those
 * properties rather than failing on a value that production will provide.
 */
const field = (
  key: string,
  displayName: string,
  type: 'string' | 'number',
  description: string,
): DataField =>
  ({
    key,
    displayName,
    type,
    required: false,
    description,
    defaultValue: null,
    validation: emptyValidationFor(type),
  }) as DataField;

export const SYSTEM_FIELD_KEYS = {
  /** Formatted serial number of this instance, e.g. "YT-00001257". */
  SERIAL: `${RESERVED_FIELD_KEY_PREFIX}serial`,
  /** 1-based position of the instance in the production job. */
  INSTANCE_INDEX: `${RESERVED_FIELD_KEY_PREFIX}instance_index`,
  /** 1-based copy number within one dataset record. */
  COPY_INDEX: `${RESERVED_FIELD_KEY_PREFIX}copy_index`,
  /** Row number of the record in the imported source file. */
  SOURCE_ROW: `${RESERVED_FIELD_KEY_PREFIX}source_row`,
  /** Human-readable production job number, e.g. "PJ-20260916-000123". */
  JOB_NUMBER: `${RESERVED_FIELD_KEY_PREFIX}job_number`,
} as const;

export type SystemFieldKey = (typeof SYSTEM_FIELD_KEYS)[keyof typeof SYSTEM_FIELD_KEYS];

export const PRODUCTION_SYSTEM_FIELDS: readonly DataField[] = [
  field(
    SYSTEM_FIELD_KEYS.SERIAL,
    'Serial number',
    'string',
    'Serial number of this tag, allocated from a sequence when the production job is released.',
  ),
  field(
    SYSTEM_FIELD_KEYS.INSTANCE_INDEX,
    'Instance number',
    'number',
    'Position of this tag in the production job, starting at 1.',
  ),
  field(
    SYSTEM_FIELD_KEYS.COPY_INDEX,
    'Copy number',
    'number',
    'Copy number within one data record, starting at 1.',
  ),
  field(
    SYSTEM_FIELD_KEYS.SOURCE_ROW,
    'Source row',
    'number',
    'Row number of the record in the imported source file.',
  ),
  field(
    SYSTEM_FIELD_KEYS.JOB_NUMBER,
    'Production job number',
    'string',
    'Number of the production job this tag belongs to.',
  ),
];

const BY_KEY = new Map(PRODUCTION_SYSTEM_FIELDS.map((entry) => [entry.key, entry]));

/** True for every key in the reserved system namespace, known or not. */
export function isSystemFieldKey(key: string): boolean {
  return key.startsWith(RESERVED_FIELD_KEY_PREFIX);
}

/** The system field with this key, or undefined (an unknown "__" key stays unknown). */
export function systemField(key: string): DataField | undefined {
  return BY_KEY.get(key);
}
