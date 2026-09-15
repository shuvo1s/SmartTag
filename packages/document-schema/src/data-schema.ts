import { PATTERN_LIMITS } from '@smarttag/expression-core';
import { z } from 'zod';
import { FieldKeySchema, UuidSchema } from './primitives';

/**
 * Data field types (see docs/data-schema.md). Values arriving from test data, APIs and (later)
 * CSV/Excel imports are validated and normalized into these types before they are bound to
 * artwork properties.
 *
 * - `decimal` is carried as an exact decimal string so that monetary values never pass through
 *   binary floating point.
 * - `date` is an ISO-8601 calendar date (YYYY-MM-DD); presentation formatting is a later concern.
 * - `image` references an Asset id of the organization.
 */
export const DATA_FIELD_TYPES = [
  'string',
  'number',
  'decimal',
  'boolean',
  'date',
  'url',
  'image',
] as const;

export const DataFieldTypeSchema = z.enum(DATA_FIELD_TYPES);
export type DataFieldType = z.infer<typeof DataFieldTypeSchema>;

export const DECIMAL_PATTERN = /^-?\d{1,20}(\.\d{1,12})?$/;
export const ISO_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Upper bound for any string value and string default (characters). */
export const MAX_STRING_VALUE_LENGTH = 10_000;
/** Upper bound for the number of fields in one data schema. */
export const MAX_DATA_FIELDS = 500;
/** Upper bound for entries of an allowedValues rule. */
export const MAX_ALLOWED_VALUES = 100;

export const DecimalStringSchema = z
  .string()
  .regex(DECIMAL_PATTERN, 'Decimal values must be plain decimal strings, e.g. "19.99"');
export const IsoDateStringSchema = z
  .string()
  .regex(ISO_DATE_PATTERN, 'Dates must be ISO calendar dates (YYYY-MM-DD)');
export const UrlStringSchema = z.url({ protocol: /^https?$/ });

// ---------------------------------------------------------------------------------------------
// Validation rules (schema v3). Every rule key is always present; `null` means "no rule".
// ---------------------------------------------------------------------------------------------

const LengthRuleSchema = z.number().int().min(0).max(MAX_STRING_VALUE_LENGTH).nullable();

export const StringValidationSchema = z.strictObject({
  /** Minimum length in Unicode code points. */
  minLength: LengthRuleSchema,
  /** Maximum length in Unicode code points. */
  maxLength: LengthRuleSchema,
  /**
   * Safe pattern the WHOLE value must match (see expression-core `compileSafePattern`: a
   * backtracking-free subset of regular expressions).
   */
  pattern: z.string().min(1).max(PATTERN_LIMITS.maxSourceLength).nullable(),
  allowedValues: z
    .array(z.string().max(MAX_STRING_VALUE_LENGTH))
    .min(1)
    .max(MAX_ALLOWED_VALUES)
    .nullable(),
});
export type StringValidation = z.infer<typeof StringValidationSchema>;

export const NumberValidationSchema = z.strictObject({
  min: z.number().nullable(),
  max: z.number().nullable(),
  allowedValues: z.array(z.number()).min(1).max(MAX_ALLOWED_VALUES).nullable(),
});
export type NumberValidation = z.infer<typeof NumberValidationSchema>;

export const DecimalValidationSchema = z.strictObject({
  min: DecimalStringSchema.nullable(),
  max: DecimalStringSchema.nullable(),
  allowedValues: z.array(DecimalStringSchema).min(1).max(MAX_ALLOWED_VALUES).nullable(),
});
export type DecimalValidation = z.infer<typeof DecimalValidationSchema>;

/** Types without configurable rules yet; their built-in format checks always apply. */
export const NoValidationSchema = z.strictObject({});
export type NoValidation = z.infer<typeof NoValidationSchema>;

export const EMPTY_STRING_VALIDATION: StringValidation = Object.freeze({
  minLength: null,
  maxLength: null,
  pattern: null,
  allowedValues: null,
});
export const EMPTY_NUMBER_VALIDATION: NumberValidation = Object.freeze({
  min: null,
  max: null,
  allowedValues: null,
});
export const EMPTY_DECIMAL_VALIDATION: DecimalValidation = Object.freeze({
  min: null,
  max: null,
  allowedValues: null,
});

const fieldBase = {
  key: FieldKeySchema,
  displayName: z.string().trim().min(1).max(100),
  required: z.boolean(),
  description: z.string().max(500),
};

export const StringFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('string'),
  defaultValue: z.string().max(MAX_STRING_VALUE_LENGTH).nullable(),
  validation: StringValidationSchema,
});
export const NumberFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('number'),
  defaultValue: z.number().nullable(),
  validation: NumberValidationSchema,
});
export const DecimalFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('decimal'),
  defaultValue: DecimalStringSchema.nullable(),
  validation: DecimalValidationSchema,
});
export const BooleanFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('boolean'),
  defaultValue: z.boolean().nullable(),
  validation: NoValidationSchema,
});
export const DateFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('date'),
  defaultValue: IsoDateStringSchema.nullable(),
  validation: NoValidationSchema,
});
export const UrlFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('url'),
  defaultValue: UrlStringSchema.nullable(),
  validation: NoValidationSchema,
});
export const ImageFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('image'),
  /** Asset id used when a record does not supply an image. */
  defaultValue: UuidSchema.nullable(),
  validation: NoValidationSchema,
});

export const DataFieldSchema = z.discriminatedUnion('type', [
  StringFieldSchema,
  NumberFieldSchema,
  DecimalFieldSchema,
  BooleanFieldSchema,
  DateFieldSchema,
  UrlFieldSchema,
  ImageFieldSchema,
]);
export type DataField = z.infer<typeof DataFieldSchema>;
export type DataFieldOfType<T extends DataFieldType> = Extract<DataField, { type: T }>;

export const DataSchemaSchema = z.strictObject({
  fields: z.array(DataFieldSchema).max(MAX_DATA_FIELDS),
});
export type DataSchema = z.infer<typeof DataSchemaSchema>;

/** The empty rule set for a field type, as stored in new fields and by the v2 → v3 migration. */
export function emptyValidationFor(type: DataFieldType): DataField['validation'] {
  switch (type) {
    case 'string':
      return { ...EMPTY_STRING_VALIDATION };
    case 'number':
      return { ...EMPTY_NUMBER_VALIDATION };
    case 'decimal':
      return { ...EMPTY_DECIMAL_VALIDATION };
    case 'boolean':
    case 'date':
    case 'url':
    case 'image':
      return {};
  }
}

// ---------------------------------------------------------------------------------------------
// Field keys
// ---------------------------------------------------------------------------------------------

/** Prefix reserved for future system fields (`__record_index`, `__job_id`, `__serial`). */
export const RESERVED_FIELD_KEY_PREFIX = '__';

/**
 * Keys that would collide with JavaScript object internals. They are refused even though they
 * look like ordinary keys, so data records can never be used for prototype pollution.
 */
export const FORBIDDEN_FIELD_KEYS: readonly string[] = Object.freeze([
  '__proto__',
  'constructor',
  'prototype',
]);

export function isReservedFieldKey(key: string): boolean {
  return key.startsWith(RESERVED_FIELD_KEY_PREFIX) || FORBIDDEN_FIELD_KEYS.includes(key);
}
