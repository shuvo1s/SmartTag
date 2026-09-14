import { DOCUMENT_TYPES, type DocumentType } from '@smarttag/document-schema';

export type DocumentTypeAvailability = 'AVAILABLE' | 'PLANNED';

export interface DocumentTypeDefinition {
  readonly type: DocumentType;
  readonly label: string;
  readonly availability: DocumentTypeAvailability;
}

/**
 * Product capability registry. The canonical document engine is shared by all types; enabling a
 * new type is a registry change plus any type-specific presets/validation — not a new engine.
 */
export const DOCUMENT_TYPE_DEFINITIONS: Readonly<Record<DocumentType, DocumentTypeDefinition>> = {
  HANG_TAG: { type: 'HANG_TAG', label: 'Hang tag', availability: 'AVAILABLE' },
  CARE_LABEL: { type: 'CARE_LABEL', label: 'Care label', availability: 'PLANNED' },
  PRICE_TICKET: { type: 'PRICE_TICKET', label: 'Price ticket', availability: 'PLANNED' },
  BARCODE_LABEL: { type: 'BARCODE_LABEL', label: 'Barcode label', availability: 'PLANNED' },
  SIZE_STICKER: { type: 'SIZE_STICKER', label: 'Size sticker', availability: 'PLANNED' },
  RFID_LABEL: { type: 'RFID_LABEL', label: 'RFID label', availability: 'PLANNED' },
  PACKAGING_LABEL: { type: 'PACKAGING_LABEL', label: 'Packaging label', availability: 'PLANNED' },
  CARTON_LABEL: { type: 'CARTON_LABEL', label: 'Carton label', availability: 'PLANNED' },
  SHIPPING_LABEL: { type: 'SHIPPING_LABEL', label: 'Shipping label', availability: 'PLANNED' },
  HEAT_TRANSFER: { type: 'HEAT_TRANSFER', label: 'Heat-transfer artwork', availability: 'PLANNED' },
  POLYBAG_LABEL: { type: 'POLYBAG_LABEL', label: 'Polybag label', availability: 'PLANNED' },
};

export function isDocumentTypeAvailable(type: DocumentType): boolean {
  return DOCUMENT_TYPE_DEFINITIONS[type].availability === 'AVAILABLE';
}

export function listDocumentTypes(availability?: DocumentTypeAvailability): DocumentTypeDefinition[] {
  return DOCUMENT_TYPES.map((type) => DOCUMENT_TYPE_DEFINITIONS[type]).filter(
    (definition) => availability === undefined || definition.availability === availability,
  );
}
