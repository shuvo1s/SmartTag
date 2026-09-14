import { z } from 'zod';
import { PropertyBindingSchema } from '../bindings';
import { UuidSchema } from '../primitives';
import { baseObjectShape } from './base';

export const IMAGE_FIT_MODES = ['CONTAIN', 'COVER', 'STRETCH'] as const;

const UnitIntervalSchema = z.number().min(0).max(1);

/**
 * Crop rectangle expressed as fractions (0–1) of the source image. Resolution-independent, so a
 * replacement asset with a different pixel size keeps the same framing.
 */
export const ImageCropSchema = z.strictObject({
  x: UnitIntervalSchema,
  y: UnitIntervalSchema,
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
});
export type ImageCrop = z.infer<typeof ImageCropSchema>;

/**
 * Raster/vector image placed from the asset library. Images are ALWAYS referenced by asset id —
 * binary data (base64 etc.) never enters the document. Pixel dimensions live on the Asset record
 * and, combined with this object's physical size, yield the effective print resolution.
 */
export const ImageObjectSchema = z.strictObject({
  ...baseObjectShape,
  type: z.literal('image'),
  /** Static/preview asset. May be null while a draft is incomplete or when bound to an image field. */
  assetId: UuidSchema.nullable(),
  fitMode: z.enum(IMAGE_FIT_MODES),
  crop: ImageCropSchema.nullable(),
  /** Editing constraint: resizing the frame keeps the source aspect ratio. */
  preserveAspectRatio: z.boolean(),
  bindings: z.strictObject({
    assetId: PropertyBindingSchema,
    visible: PropertyBindingSchema,
  }),
});
export type ImageObject = z.infer<typeof ImageObjectSchema>;
