import { z } from 'zod';
import { PropertyBindingSchema } from '../bindings';
import { ColorSchema } from '../primitives';
import { baseObjectShape } from './base';

export const QR_ERROR_CORRECTION_LEVELS = ['L', 'M', 'Q', 'H'] as const;

export const QrCodeObjectSchema = z.strictObject({
  ...baseObjectShape,
  type: z.literal('qrCode'),
  value: z.string().max(4_000),
  errorCorrection: z.enum(QR_ERROR_CORRECTION_LEVELS),
  foregroundColor: ColorSchema,
  backgroundColor: ColorSchema.nullable(),
  /** Quiet zone in modules. ISO/IEC 18004 recommends 4. */
  quietZone: z.number().int().min(0).max(20),
  bindings: z.strictObject({
    value: PropertyBindingSchema,
    visible: PropertyBindingSchema,
  }),
});
export type QrCodeObject = z.infer<typeof QrCodeObjectSchema>;
