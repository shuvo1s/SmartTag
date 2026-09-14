import { z } from 'zod';
import { FieldKeySchema, UuidSchema } from './primitives';

/**
 * Data field types. Values arriving from CSV/Excel/API are coerced into these types before
 * they are bound to artwork properties.
 *
 * - `decimal` is carried as a string so that monetary values never pass through binary floating point.
 * - `date` is an ISO-8601 calendar date (YYYY-MM-DD); presentation formatting is a later concern.
 * - `image` references an Asset id.
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

export const DecimalStringSchema = z
  .string()
  .regex(DECIMAL_PATTERN, 'Decimal values must be plain decimal strings, e.g. "19.99"');
export const IsoDateStringSchema = z
  .string()
  .regex(ISO_DATE_PATTERN, 'Dates must be ISO calendar dates (YYYY-MM-DD)');
export const UrlStringSchema = z.url({ protocol: /^https?$/ });

const fieldBase = {
  key: FieldKeySchema,
  displayName: z.string().trim().min(1).max(100),
  required: z.boolean(),
  description: z.string().max(500),
};

export const StringFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('string'),
  defaultValue: z.string().max(10_000).nullable(),
});
export const NumberFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('number'),
  defaultValue: z.number().nullable(),
});
export const DecimalFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('decimal'),
  defaultValue: DecimalStringSchema.nullable(),
});
export const BooleanFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('boolean'),
  defaultValue: z.boolean().nullable(),
});
export const DateFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('date'),
  defaultValue: IsoDateStringSchema.nullable(),
});
export const UrlFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('url'),
  defaultValue: UrlStringSchema.nullable(),
});
export const ImageFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('image'),
  /** Asset id used when a record does not supply an image. */
  defaultValue: UuidSchema.nullable(),
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

export const DataSchemaSchema = z.strictObject({
  fields: z.array(DataFieldSchema).max(500),
});
export type DataSchema = z.infer<typeof DataSchemaSchema>;
