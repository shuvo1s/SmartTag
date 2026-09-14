import { z } from 'zod';

/**
 * Product / document categories. The document engine is generic — a document type is a
 * classification that drives presets, validation profiles and (later) workflow rules.
 * It never changes the shape of the canonical document.
 *
 * The database enum `DocumentType` mirrors this list (guarded by a parity test in the API).
 */
export const DOCUMENT_TYPES = [
  'HANG_TAG',
  'CARE_LABEL',
  'PRICE_TICKET',
  'BARCODE_LABEL',
  'SIZE_STICKER',
  'RFID_LABEL',
  'PACKAGING_LABEL',
  'CARTON_LABEL',
  'SHIPPING_LABEL',
  'HEAT_TRANSFER',
  'POLYBAG_LABEL',
] as const;

export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;
