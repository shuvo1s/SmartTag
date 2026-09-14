import { z } from 'zod';
import { PropertyBindingSchema } from '../bindings';
import { ColorSchema, PositiveLengthPtSchema } from '../primitives';
import { baseObjectShape } from './base';

/**
 * Linear barcode symbologies. The document stores WHAT to encode; HOW bars are generated is the
 * job of a pluggable encoder in `@smarttag/barcode-core`, so no specific JS barcode library is
 * baked into persisted designs.
 */
export const BARCODE_SYMBOLOGIES = [
  'CODE128',
  'EAN13',
  'EAN8',
  'UPCA',
  'UPCE',
  'CODE39',
  'ITF14',
  'GS1_128',
] as const;

export const BarcodeSymbologySchema = z.enum(BARCODE_SYMBOLOGIES);
export type BarcodeSymbology = z.infer<typeof BarcodeSymbologySchema>;

export const BarcodeObjectSchema = z.strictObject({
  ...baseObjectShape,
  type: z.literal('barcode'),
  symbology: BarcodeSymbologySchema,
  /** Static/preview data (e.g. a sample GTIN). Production values usually come from a FIELD binding. */
  value: z.string().max(256),
  showHumanReadableText: z.boolean(),
  /** Quiet zone on each side, in multiples of the module (X-dimension) width. */
  quietZone: z.number().min(0).max(50),
  /** Height of the bars in points (excludes human-readable text). Must fit within the frame. */
  barHeight: PositiveLengthPtSchema,
  foregroundColor: ColorSchema,
  /** null = transparent. */
  backgroundColor: ColorSchema.nullable(),
  bindings: z.strictObject({
    value: PropertyBindingSchema,
    visible: PropertyBindingSchema,
  }),
});
export type BarcodeObject = z.infer<typeof BarcodeObjectSchema>;
