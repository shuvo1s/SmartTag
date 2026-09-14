import { z } from 'zod';
import {
  CoordinatePtSchema,
  ElementIdSchema,
  MetadataSchema,
  PositiveLengthPtSchema,
} from '../primitives';

/**
 * Geometry & common state shared by every artwork object.
 *
 * Coordinate space (see docs/coordinate-system.md):
 * - origin (0,0) is the top-left corner of the TRIM box; +x to the right, +y downward
 * - `x`,`y` is the top-left corner of the object's un-rotated frame, in points
 * - `rotation` is clockwise degrees about the frame centre, normalised to [0, 360)
 * - `zIndex` is the authoritative stacking order within a page (unique per page)
 */
export const baseObjectShape = {
  id: ElementIdSchema,
  name: z.string().max(100),
  x: CoordinatePtSchema,
  y: CoordinatePtSchema,
  width: PositiveLengthPtSchema,
  height: PositiveLengthPtSchema,
  rotation: z.number().min(0).lt(360),
  opacity: z.number().min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
  zIndex: z.number().int().min(0).max(1_000_000),
  groupId: ElementIdSchema.nullable(),
  metadata: MetadataSchema,
};
