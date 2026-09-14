import type { DataField, DesignDocument, Page } from '@smarttag/document-schema';
import { createBlankDesignDocument, BACK_PAGE_ID, FRONT_PAGE_ID } from '../builders/document';
import {
  createBarcodeObject,
  createImageObject,
  createLineObject,
  createQrCodeObject,
  createRectangleObject,
  createTextObject,
} from '../builders/objects';
import { fieldBinding, rgb, solidStroke } from '../builders/primitives';
import type { DataRecord } from '../bindings/coerce';
import { mmToPt as mm } from '../units';

/** Deterministic ids so that seeds, tests and docs can refer to the sample. */
export const SAMPLE_HANG_TAG_DOCUMENT_ID = '0192f0a0-5b1e-7c3d-8e4f-1a2b3c4d5e6f';
export const SAMPLE_BRAND_LOGO_ASSET_ID = '0192f0a0-5b1e-7c3d-9a4f-6b7c8d9e0f10';

const INK = rgb('#1F2933');
const MUTED = rgb('#52606D');
const BRAND = rgb('#0B6E4F');

export const SAMPLE_HANG_TAG_DATA_FIELDS: readonly DataField[] = [
  {
    key: 'product_name',
    displayName: 'Product name',
    type: 'string',
    required: true,
    defaultValue: null,
    description: 'Customer-facing product name',
  },
  {
    key: 'style',
    displayName: 'Style',
    type: 'string',
    required: true,
    defaultValue: null,
    description: 'Style / article number',
  },
  {
    key: 'color',
    displayName: 'Color',
    type: 'string',
    required: true,
    defaultValue: null,
    description: 'Color name',
  },
  {
    key: 'size',
    displayName: 'Size',
    type: 'string',
    required: true,
    defaultValue: null,
    description: 'Size code, e.g. M or 32/34',
  },
  {
    key: 'price',
    displayName: 'Price',
    type: 'decimal',
    required: true,
    defaultValue: null,
    description: 'Retail price without currency symbol',
  },
  {
    key: 'currency',
    displayName: 'Currency',
    type: 'string',
    required: false,
    defaultValue: 'EUR',
    description: 'ISO 4217 currency code',
  },
  {
    key: 'gtin',
    displayName: 'GTIN',
    type: 'string',
    required: true,
    defaultValue: null,
    description: 'GTIN-13 encoded as EAN-13',
  },
  {
    key: 'country_of_origin',
    displayName: 'Country of origin',
    type: 'string',
    required: false,
    defaultValue: 'Bangladesh',
    description: 'Country of manufacture',
  },
  {
    key: 'product_url',
    displayName: 'Product URL',
    type: 'url',
    required: false,
    defaultValue: null,
    description: 'Encoded in the QR code',
  },
  {
    key: 'product_image',
    displayName: 'Product image',
    type: 'image',
    required: false,
    defaultValue: null,
    description: 'Optional product image asset',
  },
];

export const SAMPLE_HANG_TAG_RECORD: DataRecord = {
  product_name: 'Organic Cotton Tee',
  style: 'ST-1001',
  color: 'Navy',
  size: 'M',
  price: '19.99',
  currency: 'EUR',
  gtin: '4006381333931',
  country_of_origin: 'Bangladesh',
  product_url: 'https://example.com/products/st-1001',
  product_image: null,
};

function buildFront(logoAssetId: string): Page {
  const label = { fontSize: 6, fontWeight: 600, textColor: MUTED, letterSpacing: 0.4 } as const;
  return {
    id: FRONT_PAGE_ID,
    name: 'Front',
    side: 'FRONT',
    background: rgb('#FFFFFF'),
    groups: [{ id: 'grp-pricing', name: 'Size & price', visible: true, locked: false }],
    objects: [
      createRectangleObject({
        id: 'front-band',
        name: 'Brand band',
        zIndex: 0,
        x: mm(-3),
        y: mm(-3),
        width: mm(56),
        height: mm(13),
        fill: BRAND,
        stroke: null,
      }),
      createImageObject({
        id: 'front-logo',
        name: 'Brand logo',
        zIndex: 1,
        x: mm(10),
        y: mm(13),
        width: mm(30),
        height: mm(12),
        assetId: logoAssetId,
        fitMode: 'CONTAIN',
      }),
      createTextObject({
        id: 'front-product-name',
        name: 'Product name',
        zIndex: 2,
        x: mm(4),
        y: mm(29),
        width: mm(42),
        height: mm(10),
        content: 'Organic Cotton Tee',
        fontSize: 11,
        fontWeight: 700,
        textAlign: 'CENTER',
        verticalAlign: 'MIDDLE',
        textColor: INK,
        overflow: { mode: 'SHRINK_TO_FIT', minFontSize: 7 },
        bindings: { content: fieldBinding('product_name') },
      }),
      createTextObject({
        id: 'front-size-label',
        name: 'Size label',
        zIndex: 3,
        groupId: 'grp-pricing',
        x: mm(4),
        y: mm(42),
        width: mm(18),
        height: mm(3.5),
        content: 'SIZE',
        ...label,
      }),
      createTextObject({
        id: 'front-size',
        name: 'Size',
        zIndex: 4,
        groupId: 'grp-pricing',
        x: mm(4),
        y: mm(45.5),
        width: mm(18),
        height: mm(8),
        content: 'M',
        fontSize: 16,
        fontWeight: 700,
        textColor: INK,
        bindings: { content: fieldBinding('size') },
      }),
      createTextObject({
        id: 'front-currency',
        name: 'Currency',
        zIndex: 5,
        groupId: 'grp-pricing',
        x: mm(24),
        y: mm(42),
        width: mm(22),
        height: mm(3.5),
        content: 'EUR',
        textAlign: 'END',
        ...label,
        bindings: { content: fieldBinding('currency') },
      }),
      createTextObject({
        id: 'front-price',
        name: 'Price',
        zIndex: 6,
        groupId: 'grp-pricing',
        x: mm(24),
        y: mm(45.5),
        width: mm(22),
        height: mm(8),
        content: '19.99',
        fontSize: 16,
        fontWeight: 700,
        textAlign: 'END',
        textColor: INK,
        bindings: { content: fieldBinding('price') },
      }),
      createLineObject({
        id: 'front-divider',
        name: 'Divider',
        zIndex: 7,
        x: mm(4),
        y: mm(57),
        width: mm(42),
        height: 0,
        stroke: solidStroke(rgb('#CBD2D9'), 0.5),
      }),
      createBarcodeObject({
        id: 'front-barcode',
        name: 'EAN-13 barcode',
        zIndex: 8,
        x: mm(7),
        y: mm(61),
        width: mm(36),
        height: mm(23),
        symbology: 'EAN13',
        value: '4006381333931',
        barHeight: mm(19),
        quietZone: 11,
        showHumanReadableText: true,
        bindings: { value: fieldBinding('gtin') },
      }),
    ],
  };
}

function buildBack(): Page {
  const label = { fontSize: 6, fontWeight: 600, textColor: MUTED, letterSpacing: 0.4 } as const;
  const value = { fontSize: 10, fontWeight: 500, textColor: INK } as const;
  return {
    id: BACK_PAGE_ID,
    name: 'Back',
    side: 'BACK',
    background: rgb('#FFFFFF'),
    groups: [],
    objects: [
      createTextObject({
        id: 'back-style-label',
        name: 'Style label',
        zIndex: 0,
        x: mm(5),
        y: mm(14),
        width: mm(40),
        height: mm(3.5),
        content: 'STYLE',
        ...label,
      }),
      createTextObject({
        id: 'back-style',
        name: 'Style',
        zIndex: 1,
        x: mm(5),
        y: mm(17.5),
        width: mm(40),
        height: mm(6),
        content: 'ST-1001',
        ...value,
        bindings: { content: fieldBinding('style') },
      }),
      createTextObject({
        id: 'back-color-label',
        name: 'Color label',
        zIndex: 2,
        x: mm(5),
        y: mm(26),
        width: mm(40),
        height: mm(3.5),
        content: 'COLOR',
        ...label,
      }),
      createTextObject({
        id: 'back-color',
        name: 'Color',
        zIndex: 3,
        x: mm(5),
        y: mm(29.5),
        width: mm(40),
        height: mm(6),
        content: 'Navy',
        ...value,
        bindings: { content: fieldBinding('color') },
      }),
      createTextObject({
        id: 'back-origin-label',
        name: 'Origin label',
        zIndex: 4,
        x: mm(5),
        y: mm(38),
        width: mm(40),
        height: mm(3.5),
        content: 'MADE IN',
        ...label,
      }),
      createTextObject({
        id: 'back-origin',
        name: 'Country of origin',
        zIndex: 5,
        x: mm(5),
        y: mm(41.5),
        width: mm(40),
        height: mm(6),
        content: 'Bangladesh',
        ...value,
        bindings: { content: fieldBinding('country_of_origin') },
      }),
      createTextObject({
        id: 'back-origin-bn',
        name: 'Country of origin (Bengali)',
        zIndex: 6,
        x: mm(5),
        y: mm(48),
        width: mm(40),
        height: mm(5),
        content: 'বাংলাদেশে তৈরি',
        language: 'bn',
        fontFamily: 'Noto Sans Bengali',
        fontSize: 8,
        textColor: MUTED,
      }),
      createQrCodeObject({
        id: 'back-qr',
        name: 'Product QR code',
        zIndex: 7,
        x: mm(15),
        y: mm(58),
        width: mm(20),
        height: mm(20),
        value: 'https://example.com/products/st-1001',
        errorCorrection: 'M',
        bindings: { value: fieldBinding('product_url') },
      }),
    ],
  };
}

export interface SampleHangTagOptions {
  readonly documentId?: string;
  readonly logoAssetId?: string;
}

/**
 * Development fixture: 50 mm × 90 mm hang tag, 3 mm bleed, 3 mm safe margin, front + back,
 * a Ø4 mm punch hole and 4 mm rounded corners. Demonstrates static objects, field bindings
 * (product_name, size, price, currency, gtin, style, color, country_of_origin, product_url)
 * and non-Latin text.
 */
export function createSampleHangTagDocument(options: SampleHangTagOptions = {}): DesignDocument {
  const blank = createBlankDesignDocument({
    documentId: options.documentId ?? SAMPLE_HANG_TAG_DOCUMENT_ID,
    name: 'Sample hang tag 50 × 90 mm',
    description: 'Development fixture demonstrating the canonical document model.',
    documentType: 'HANG_TAG',
    unit: 'mm',
    width: 50,
    height: 90,
    bleed: 3,
    safeMargin: 3,
    margin: 4,
    pageLayout: 'FRONT_AND_BACK',
    language: 'en',
    dataFields: SAMPLE_HANG_TAG_DATA_FIELDS,
  });

  return {
    ...blank,
    metadata: { ...blank.metadata, tags: ['sample', 'hang-tag'] },
    dimensions: {
      ...blank.dimensions,
      dieline: {
        trimShape: { type: 'RECTANGLE', cornerRadius: mm(4) },
        features: [
          { id: 'hole-top', type: 'PUNCH_HOLE', center: { x: mm(25), y: mm(6) }, diameter: mm(4) },
        ],
      },
    },
    pages: [buildFront(options.logoAssetId ?? SAMPLE_BRAND_LOGO_ASSET_ID), buildBack()],
  };
}
