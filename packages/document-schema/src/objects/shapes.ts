import { z } from 'zod';
import { PropertyBindingSchema } from '../bindings';
import { ColorSchema, NonNegativeLengthPtSchema, StrokeSchema } from '../primitives';
import { baseObjectShape } from './base';

const visibilityOnlyBindings = z.strictObject({
  visible: PropertyBindingSchema,
});

export const RectangleObjectSchema = z.strictObject({
  ...baseObjectShape,
  type: z.literal('rectangle'),
  fill: ColorSchema.nullable(),
  stroke: StrokeSchema.nullable(),
  cornerRadius: NonNegativeLengthPtSchema,
  bindings: visibilityOnlyBindings,
});
export type RectangleObject = z.infer<typeof RectangleObjectSchema>;

export const EllipseObjectSchema = z.strictObject({
  ...baseObjectShape,
  type: z.literal('ellipse'),
  fill: ColorSchema.nullable(),
  stroke: StrokeSchema.nullable(),
  bindings: visibilityOnlyBindings,
});
export type EllipseObject = z.infer<typeof EllipseObjectSchema>;

/**
 * A straight line drawn along the horizontal centre of its frame, from the left edge to the
 * right edge. Arbitrary angles use `rotation`. Keeping lines frame-based means every object
 * shares one geometry model (selection, alignment, rotation, hit-testing).
 */
export const LineObjectSchema = z.strictObject({
  ...baseObjectShape,
  type: z.literal('line'),
  /** Lines may have zero frame height. */
  height: NonNegativeLengthPtSchema,
  stroke: StrokeSchema,
  bindings: visibilityOnlyBindings,
});
export type LineObject = z.infer<typeof LineObjectSchema>;
