import { z } from 'zod';
import {
  ElementIdSchema,
  InsetsSchema,
  MeasurementUnitSchema,
  NonNegativeLengthPtSchema,
  PointSchema,
  PositiveLengthPtSchema,
} from './primitives';

// ---------------------------------------------------------------------------------------------
// Dieline — physical cut/fold features. Phase 1 defines the model; the dieline editor comes later.
// Feature coordinates are in FRONT-side trim space. Renderers mirror them for BACK pages
// according to `printSettings.backSideFlip`.
// ---------------------------------------------------------------------------------------------

export const RectangularTrimShapeSchema = z.strictObject({
  type: z.literal('RECTANGLE'),
  cornerRadius: NonNegativeLengthPtSchema,
});

/** Future: `{ type: 'PATH', path: … }` for custom cut outlines. */
export const TrimShapeSchema = z.discriminatedUnion('type', [RectangularTrimShapeSchema]);
export type TrimShape = z.infer<typeof TrimShapeSchema>;

export const PunchHoleFeatureSchema = z.strictObject({
  id: ElementIdSchema,
  type: z.literal('PUNCH_HOLE'),
  center: PointSchema,
  diameter: PositiveLengthPtSchema,
});

export const SlotHoleFeatureSchema = z.strictObject({
  id: ElementIdSchema,
  type: z.literal('SLOT_HOLE'),
  center: PointSchema,
  width: PositiveLengthPtSchema,
  height: PositiveLengthPtSchema,
  rotation: z.number().min(0).lt(360),
});

export const FoldLineFeatureSchema = z.strictObject({
  id: ElementIdSchema,
  type: z.literal('FOLD_LINE'),
  start: PointSchema,
  end: PointSchema,
});

export const PerforationFeatureSchema = z.strictObject({
  id: ElementIdSchema,
  type: z.literal('PERFORATION'),
  start: PointSchema,
  end: PointSchema,
  cutLength: PositiveLengthPtSchema,
  gapLength: PositiveLengthPtSchema,
});

export const DielineFeatureSchema = z.discriminatedUnion('type', [
  PunchHoleFeatureSchema,
  SlotHoleFeatureSchema,
  FoldLineFeatureSchema,
  PerforationFeatureSchema,
]);
export type DielineFeature = z.infer<typeof DielineFeatureSchema>;

export const DielineSchema = z.strictObject({
  trimShape: TrimShapeSchema,
  features: z.array(DielineFeatureSchema).max(100),
});
export type Dieline = z.infer<typeof DielineSchema>;

// ---------------------------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------------------------

export const ORIENTATIONS = ['PORTRAIT', 'LANDSCAPE'] as const;

/**
 * Physical size of the finished (trimmed) piece, in points.
 *
 * - bleed:    how far artwork extends OUTSIDE the trim edge (so no white edge after cutting)
 * - safeArea: inset INSIDE the trim edge within which critical content must stay
 * - margins:  inset INSIDE the trim edge used as layout guides
 */
export const DocumentDimensionsSchema = z.strictObject({
  width: PositiveLengthPtSchema,
  height: PositiveLengthPtSchema,
  /** Must agree with width/height; either is accepted for square pieces. */
  orientation: z.enum(ORIENTATIONS),
  /** Unit the user prefers to see. Never used for storage. */
  displayUnit: MeasurementUnitSchema,
  bleed: InsetsSchema,
  safeArea: InsetsSchema,
  margins: InsetsSchema,
  dieline: DielineSchema,
});
export type DocumentDimensions = z.infer<typeof DocumentDimensionsSchema>;
