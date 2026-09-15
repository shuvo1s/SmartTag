/**
 * Hand-written raw JSON fixtures. Deliberately NOT built with @smarttag/document-utils builders so
 * the schema is tested against literal persisted JSON, exactly as it would come out of a database.
 */
const MM = 72 / 25.4;

/** A controlled font asset id used by text fixtures. */
export const FONT_ASSET_ID = '0192f0a0-5b1e-7c3d-a1b2-00000000f001';

/** Current-schema (v3) document. */
export function minimalDocument(): Record<string, unknown> {
  return {
    schemaVersion: 3,
    documentId: '0192f0a0-5b1e-7c3d-8e4f-1a2b3c4d5e6f',
    metadata: {
      name: 'Minimal tag',
      description: '',
      documentType: 'HANG_TAG',
      language: 'en',
      tags: [],
    },
    dimensions: {
      width: 50 * MM,
      height: 90 * MM,
      orientation: 'PORTRAIT',
      displayUnit: 'mm',
      bleed: { top: 3 * MM, right: 3 * MM, bottom: 3 * MM, left: 3 * MM },
      safeArea: { top: 3 * MM, right: 3 * MM, bottom: 3 * MM, left: 3 * MM },
      margins: { top: 4 * MM, right: 4 * MM, bottom: 4 * MM, left: 4 * MM },
      dieline: {
        trimShape: { type: 'RECTANGLE', cornerRadius: 0 },
        features: [
          { id: 'hole', type: 'PUNCH_HOLE', center: { x: 25 * MM, y: 6 * MM }, diameter: 4 * MM },
        ],
      },
    },
    printSettings: { colorSpace: 'RGB', backSideFlip: 'HORIZONTAL', cropMarks: false },
    pages: [
      {
        id: 'page-front',
        name: 'Front',
        side: 'FRONT',
        background: null,
        groups: [{ id: 'grp-1', name: 'Group', visible: true, locked: false }],
        objects: [textObject(), barcodeObject()],
      },
      {
        id: 'page-back',
        name: 'Back',
        side: 'BACK',
        background: { space: 'RGB', hex: '#FFFFFF' },
        groups: [],
        objects: [],
      },
    ],
    dataSchema: {
      fields: [
        {
          key: 'product_name',
          displayName: 'Product name',
          type: 'string',
          required: true,
          defaultValue: null,
          description: '',
          validation: { minLength: null, maxLength: null, pattern: null, allowedValues: null },
        },
        {
          key: 'gtin',
          displayName: 'GTIN',
          type: 'string',
          required: true,
          defaultValue: null,
          description: '',
          validation: { minLength: null, maxLength: null, pattern: null, allowedValues: null },
        },
        {
          key: 'logo',
          displayName: 'Logo',
          type: 'image',
          required: false,
          defaultValue: null,
          description: '',
          validation: {},
        },
        {
          key: 'show_badge',
          displayName: 'Show badge',
          type: 'boolean',
          required: false,
          defaultValue: true,
          description: '',
          validation: {},
        },
      ],
    },
    settings: { missingDataPolicy: 'FAIL' },
  };
}

export function textObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'txt-name',
    type: 'text',
    name: 'Product name',
    x: 4 * MM,
    y: 30 * MM,
    width: 42 * MM,
    height: 10 * MM,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 1,
    groupId: 'grp-1',
    metadata: {},
    content: 'Organic Cotton Tee',
    fontAssetId: FONT_ASSET_ID,
    fontFamily: 'Noto Sans',
    fontSize: 11,
    fontWeight: 700,
    fontStyle: 'NORMAL',
    textAlign: 'CENTER',
    verticalAlign: 'MIDDLE',
    lineHeight: 1.2,
    letterSpacing: 0,
    textColor: { space: 'RGB', hex: '#1F2933' },
    direction: 'AUTO',
    language: null,
    wrap: 'WORD',
    overflow: { mode: 'SHRINK_TO_FIT', minFontSize: 7 },
    bindings: { content: { mode: 'FIELD', field: 'product_name' }, visible: { mode: 'STATIC' } },
    ...overrides,
  };
}

export function barcodeObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'bc-gtin',
    type: 'barcode',
    name: 'Barcode',
    x: 7 * MM,
    y: 60 * MM,
    width: 36 * MM,
    height: 22 * MM,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 2,
    groupId: null,
    metadata: { 'erp.field': 'EAN' },
    symbology: 'EAN13',
    value: '4006381333931',
    showHumanReadableText: true,
    quietZone: 11,
    barHeight: 18 * MM,
    foregroundColor: { space: 'RGB', hex: '#000000' },
    backgroundColor: null,
    bindings: { value: { mode: 'FIELD', field: 'gtin' }, visible: { mode: 'STATIC' } },
    ...overrides,
  };
}

export function imageObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'img-logo',
    type: 'image',
    name: 'Logo',
    x: 10 * MM,
    y: 12 * MM,
    width: 30 * MM,
    height: 12 * MM,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 3,
    groupId: null,
    metadata: {},
    assetId: '0192f0a0-5b1e-7c3d-9a4f-6b7c8d9e0f10',
    fitMode: 'CONTAIN',
    crop: null,
    preserveAspectRatio: true,
    bindings: { assetId: { mode: 'STATIC' }, visible: { mode: 'STATIC' } },
    ...overrides,
  };
}

type Mutable = Record<string, unknown>;

/**
 * The same document as persisted with schema version 2 (before data fields had validation rules).
 * Used to prove that stored v2 documents still load.
 */
export function minimalDocumentV2(): Mutable {
  const document = minimalDocument();
  document.schemaVersion = 2;
  for (const field of (document.dataSchema as Mutable).fields as Mutable[]) {
    delete field.validation;
  }
  return document;
}

/**
 * The same document as persisted with schema version 1 (before text objects had fontAssetId and
 * wrap). Used to prove that stored v1 documents still load.
 */
export function minimalDocumentV1(): Mutable {
  const document = minimalDocumentV2();
  document.schemaVersion = 1;
  for (const page of document.pages as Mutable[]) {
    for (const object of page.objects as Mutable[]) {
      if (object.type === 'text') {
        delete object.fontAssetId;
        delete object.wrap;
      }
    }
  }
  return document;
}

/** Returns the objects array of a page for in-place mutation in tests. */
export function objectsOf(document: Mutable, pageIndex = 0): Mutable[] {
  return (document.pages as Mutable[])[pageIndex]!.objects as Mutable[];
}
