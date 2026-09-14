import { z } from 'zod';

/**
 * Canonical geometry unit: PDF points (1 pt = 1/72 inch).
 *
 * All persisted lengths are expressed in points. Display units (mm, cm, in) are a presentation
 * concern only. See docs/coordinate-system.md.
 */
export const POINTS_PER_INCH = 72;

/**
 * Upper bound for any single length. 14 400 pt = 200 in = 5 080 mm, the largest page size
 * representable in PDF at the default user-space unit. Anything larger is almost certainly corrupt.
 */
export const MAX_LENGTH_PT = 14_400;

export const MEASUREMENT_UNITS = ['mm', 'cm', 'in', 'pt'] as const;
export const MeasurementUnitSchema = z.enum(MEASUREMENT_UNITS);
export type MeasurementUnit = z.infer<typeof MeasurementUnitSchema>;

/** Any finite coordinate in points (may be negative — bleed extends beyond the trim origin). */
export const CoordinatePtSchema = z.number().min(-MAX_LENGTH_PT).max(MAX_LENGTH_PT);

/** A strictly positive length in points. */
export const PositiveLengthPtSchema = z.number().positive().max(MAX_LENGTH_PT);

/** A non-negative length in points. */
export const NonNegativeLengthPtSchema = z.number().min(0).max(MAX_LENGTH_PT);

/**
 * Identifier for elements inside a document (pages, groups, objects, dieline features).
 * Stable across versions of a document so that diffs, comments and approvals can reference them.
 */
export const ELEMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const ElementIdSchema = z
  .string()
  .regex(ELEMENT_ID_PATTERN, 'Element ids must be 1–64 chars of letters, digits, "_" or "-"');
export type ElementId = z.infer<typeof ElementIdSchema>;

/** Identifier of a record that lives outside the document (assets, documents). */
export const UuidSchema = z.uuid();

/**
 * Stable machine key for a data field. Integrations (CSV headers, ERP mappings, API payloads)
 * bind to this key, never to the display name.
 */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const FieldKeySchema = z
  .string()
  .regex(
    FIELD_KEY_PATTERN,
    'Field keys must start with a lowercase letter and contain only lowercase letters, digits and "_"',
  );
export type FieldKey = z.infer<typeof FieldKeySchema>;

/** BCP 47 language tag, e.g. "en", "en-US", "bn", "ar-EG", "zh-Hant". Structural check only. */
export const LanguageTagSchema = z
  .string()
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Must be a BCP 47 language tag');

export const PointSchema = z.strictObject({
  x: CoordinatePtSchema,
  y: CoordinatePtSchema,
});
export type Point = z.infer<typeof PointSchema>;

/** Insets from an edge, in points. Used for bleed, safe area and margins. */
export const InsetsSchema = z.strictObject({
  top: NonNegativeLengthPtSchema,
  right: NonNegativeLengthPtSchema,
  bottom: NonNegativeLengthPtSchema,
  left: NonNegativeLengthPtSchema,
});
export type Insets = z.infer<typeof InsetsSchema>;

// ---------------------------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------------------------

const PercentSchema = z.number().min(0).max(100);

/** sRGB color. Hex is stored upper-case so that equal colors serialize (and hash) identically. */
export const RgbColorSchema = z.strictObject({
  space: z.literal('RGB'),
  hex: z.string().regex(/^#[0-9A-F]{6}$/, 'RGB colors must be upper-case "#RRGGBB"'),
});
export type RgbColor = z.infer<typeof RgbColorSchema>;

/** Process color in percent (0–100). Rendering support arrives with the production PDF phase. */
export const CmykColorSchema = z.strictObject({
  space: z.literal('CMYK'),
  c: PercentSchema,
  m: PercentSchema,
  y: PercentSchema,
  k: PercentSchema,
});
export type CmykColor = z.infer<typeof CmykColorSchema>;

/** Named spot color (e.g. a Pantone reference) with a process/RGB alternate for previews. */
export const SpotColorSchema = z.strictObject({
  space: z.literal('SPOT'),
  name: z.string().min(1).max(100),
  tint: PercentSchema,
  alternate: z.discriminatedUnion('space', [RgbColorSchema, CmykColorSchema]),
});
export type SpotColor = z.infer<typeof SpotColorSchema>;

export const ColorSchema = z.discriminatedUnion('space', [
  RgbColorSchema,
  CmykColorSchema,
  SpotColorSchema,
]);
export type Color = z.infer<typeof ColorSchema>;

export const StrokeSchema = z.strictObject({
  color: ColorSchema,
  width: PositiveLengthPtSchema,
  /** Alternating dash/gap lengths in points. Empty array = solid line. */
  dashPattern: z.array(PositiveLengthPtSchema).max(16),
  lineCap: z.enum(['BUTT', 'ROUND', 'SQUARE']),
  lineJoin: z.enum(['MITER', 'ROUND', 'BEVEL']),
});
export type Stroke = z.infer<typeof StrokeSchema>;

// ---------------------------------------------------------------------------------------------
// Extensible metadata
// ---------------------------------------------------------------------------------------------

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

/**
 * Free-form, namespaced extension data (e.g. `{"erp.itemCode": "A-100"}`).
 * Never used for rendering-relevant properties — those must be modelled explicitly.
 */
export const MetadataSchema = z.record(z.string().min(1).max(100), JsonValueSchema);
export type Metadata = z.infer<typeof MetadataSchema>;
