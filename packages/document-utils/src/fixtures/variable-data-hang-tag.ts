import type { DataField, DesignDocument, Page } from '@smarttag/document-schema';
import { createDataField } from '../builders/data-fields';
import { BACK_PAGE_ID, FRONT_PAGE_ID, createBlankDesignDocument } from '../builders/document';
import {
  createBarcodeObject,
  createImageObject,
  createQrCodeObject,
  createRectangleObject,
  createTextObject,
} from '../builders/objects';
import { expressionBinding, fieldBinding, rgb } from '../builders/primitives';
import { mmToPt as mm } from '../units';
import { SAMPLE_FONT_ASSET_IDS, type SampleFontAssetIds } from './hang-tag';

export const VARIABLE_DATA_HANG_TAG_DOCUMENT_ID = '0192f0a0-5b1e-7c3d-8e4f-3a4b5c6d7e8f';

/** Data schema of the Phase 3 sample: typed fields with defaults and validation rules. */
export const VARIABLE_DATA_FIELDS: readonly DataField[] = [
  createDataField({
    key: 'product_name',
    displayName: 'Product Name',
    type: 'string',
    required: true,
    description: 'Product description displayed on the hang tag',
    validation: { minLength: 1, maxLength: 60, pattern: null, allowedValues: null },
  }),
  createDataField({
    key: 'style',
    displayName: 'Style',
    type: 'string',
    required: true,
    description: 'Style number, e.g. YT-2045',
    validation: {
      minLength: null,
      maxLength: null,
      pattern: '[A-Z]{2}-?\\d{4}',
      allowedValues: null,
    },
  }),
  createDataField({ key: 'color', displayName: 'Color', type: 'string', required: true }),
  createDataField({
    key: 'size',
    displayName: 'Size',
    type: 'string',
    required: true,
    validation: {
      minLength: null,
      maxLength: null,
      pattern: null,
      allowedValues: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    },
  }),
  createDataField({
    key: 'price',
    displayName: 'Price',
    type: 'decimal',
    required: true,
    description: 'Retail price without currency symbol',
    validation: { min: '0.01', max: '9999.99', allowedValues: null },
  }),
  createDataField({
    key: 'currency',
    displayName: 'Currency',
    type: 'string',
    defaultValue: 'USD',
    validation: {
      minLength: null,
      maxLength: null,
      pattern: null,
      allowedValues: ['USD', 'EUR', 'GBP', 'CAD'],
    },
  }),
  createDataField({
    key: 'gtin',
    displayName: 'GTIN',
    type: 'string',
    required: true,
    description: 'GTIN-13 printed as EAN-13',
    validation: { minLength: null, maxLength: null, pattern: '\\d{13}', allowedValues: null },
  }),
  createDataField({
    key: 'country_of_origin',
    displayName: 'Country of Origin',
    type: 'string',
    defaultValue: 'Bangladesh',
  }),
  createDataField({ key: 'product_url', displayName: 'Product URL', type: 'url' }),
  createDataField({
    key: 'is_sustainable',
    displayName: 'Sustainable',
    type: 'boolean',
    defaultValue: false,
    description: 'Shows the recycled badge',
  }),
  createDataField({ key: 'product_image', displayName: 'Product Image', type: 'image' }),
];

/**
 * The example record of the Phase 3 specification, with one correction: the specification's GTIN
 * 9501234567893 fails the EAN-13 check digit (it must end in 1), which the OBJECT validation layer
 * reports. The fixture uses the valid GTIN so that it resolves without issues.
 */
export const VARIABLE_DATA_RECORD: Readonly<Record<string, string | number | boolean | null>> = {
  product_name: 'Premium Cotton Shirt',
  style: 'YT-2045',
  color: 'Navy',
  size: 'XL',
  price: 39.95,
  currency: 'USD',
  gtin: '9501234567891',
  country_of_origin: 'Bangladesh',
  product_url: 'https://example.com/products/YT-2045',
  is_sustainable: true,
};

const INK = rgb('#1F2933');

function font(fonts: SampleFontAssetIds, weight: 400 | 600 | 700) {
  const fontAssetId = {
    400: fonts.notoSansRegular,
    600: fonts.notoSansSemiBold,
    700: fonts.notoSansBold,
  }[weight];
  return { fontFamily: 'Noto Sans', fontWeight: weight, fontAssetId } as const;
}

function front(fonts: SampleFontAssetIds): Page {
  return {
    id: FRONT_PAGE_ID,
    name: 'Front',
    side: 'FRONT',
    background: rgb('#FFFFFF'),
    groups: [],
    objects: [
      createRectangleObject({
        id: 'vd-band',
        name: 'Brand band',
        zIndex: 0,
        x: mm(-3),
        y: mm(-3),
        width: mm(56),
        height: mm(12),
        fill: rgb('#0B6E4F'),
        stroke: null,
      }),
      createTextObject({
        id: 'vd-product-name',
        name: 'Product Name',
        zIndex: 1,
        x: mm(4),
        y: mm(14),
        width: mm(42),
        height: mm(9),
        content: 'Product name',
        fontSize: 11,
        ...font(fonts, 700),
        textAlign: 'CENTER',
        verticalAlign: 'MIDDLE',
        textColor: INK,
        overflow: { mode: 'SHRINK_TO_FIT', minFontSize: 7 },
        bindings: { content: fieldBinding('product_name') },
      }),
      createTextObject({
        id: 'vd-size',
        name: 'Size',
        zIndex: 2,
        x: mm(4),
        y: mm(26),
        width: mm(20),
        height: mm(6),
        content: 'SIZE: M',
        fontSize: 10,
        ...font(fonts, 600),
        textColor: INK,
        bindings: { content: expressionBinding('concat("SIZE: ", size)') },
      }),
      createTextObject({
        id: 'vd-price',
        name: 'Price',
        zIndex: 3,
        x: mm(24),
        y: mm(26),
        width: mm(22),
        height: mm(6),
        content: 'USD 19.99',
        fontSize: 10,
        ...font(fonts, 700),
        textAlign: 'END',
        textColor: INK,
        bindings: { content: expressionBinding('concat(currency, " ", formatNumber(price, 2))') },
      }),
      createTextObject({
        id: 'vd-sku',
        name: 'SKU code',
        zIndex: 4,
        x: mm(4),
        y: mm(34),
        width: mm(42),
        height: mm(5),
        content: 'ST-1001-NAVY-M',
        fontSize: 7,
        ...font(fonts, 400),
        textAlign: 'CENTER',
        textColor: INK,
        bindings: { content: expressionBinding('upper(concat(style, "-", color, "-", size))') },
      }),
      createTextObject({
        id: 'vd-recycled',
        name: 'Recycled badge',
        zIndex: 5,
        x: mm(12),
        y: mm(41),
        width: mm(26),
        height: mm(6),
        content: 'RECYCLED',
        fontSize: 9,
        ...font(fonts, 700),
        textAlign: 'CENTER',
        textColor: rgb('#0B6E4F'),
        bindings: { visible: expressionBinding('is_sustainable == true') },
      }),
      createBarcodeObject({
        id: 'vd-barcode',
        name: 'EAN-13 barcode',
        zIndex: 6,
        x: mm(7),
        y: mm(50),
        width: mm(36),
        height: mm(23),
        symbology: 'EAN13',
        value: '4006381333931',
        barHeight: mm(19),
        quietZone: 11,
        showHumanReadableText: true,
        bindings: { value: fieldBinding('gtin') },
      }),
      createImageObject({
        id: 'vd-product-image',
        name: 'Product Image',
        zIndex: 7,
        x: mm(15),
        y: mm(75),
        width: mm(20),
        height: mm(10),
        assetId: null,
        fitMode: 'CONTAIN',
        bindings: {
          assetId: fieldBinding('product_image'),
          visible: expressionBinding('!isEmpty(product_image)'),
        },
      }),
    ],
  };
}

function back(fonts: SampleFontAssetIds): Page {
  return {
    id: BACK_PAGE_ID,
    name: 'Back',
    side: 'BACK',
    background: rgb('#FFFFFF'),
    groups: [],
    objects: [
      createTextObject({
        id: 'vd-origin',
        name: 'Country of Origin',
        zIndex: 0,
        x: mm(5),
        y: mm(14),
        width: mm(40),
        height: mm(6),
        content: 'MADE IN BANGLADESH',
        fontSize: 9,
        ...font(fonts, 600),
        textColor: INK,
        bindings: { content: expressionBinding('concat("MADE IN ", upper(country_of_origin))') },
      }),
      createQrCodeObject({
        id: 'vd-qr',
        name: 'Product QR code',
        zIndex: 1,
        x: mm(15),
        y: mm(30),
        width: mm(20),
        height: mm(20),
        value: 'https://example.com',
        errorCorrection: 'M',
        bindings: {
          value: expressionBinding(
            'fallback(product_url, concat("https://example.com/p/", style))',
          ),
        },
      }),
    ],
  };
}

export interface VariableDataHangTagOptions {
  readonly documentId?: string;
  readonly fontAssetIds?: SampleFontAssetIds;
}

/**
 * Phase 3 fixture: a 50 × 90 mm hang tag driven by a typed data schema. Demonstrates field
 * bindings, text/QR expressions, conditional visibility, an image field and validation rules
 * (pattern, allowed values, min/max, defaults).
 */
export function createVariableDataHangTagDocument(
  options: VariableDataHangTagOptions = {},
): DesignDocument {
  const fonts = options.fontAssetIds ?? SAMPLE_FONT_ASSET_IDS;
  const blank = createBlankDesignDocument({
    documentId: options.documentId ?? VARIABLE_DATA_HANG_TAG_DOCUMENT_ID,
    name: 'Variable data hang tag 50 × 90 mm',
    description: 'Phase 3 fixture: data schema, bindings, expressions and validation rules.',
    documentType: 'HANG_TAG',
    unit: 'mm',
    width: 50,
    height: 90,
    bleed: 3,
    safeMargin: 3,
    margin: 4,
    pageLayout: 'FRONT_AND_BACK',
    language: 'en',
    dataFields: VARIABLE_DATA_FIELDS,
  });
  return { ...blank, pages: [front(fonts), back(fonts)] };
}

export interface LargeVariableDataOptions {
  readonly documentId?: string;
  readonly objectCount?: number;
  readonly fieldCount?: number;
  readonly fieldBindingCount?: number;
  readonly expressionCount?: number;
  readonly fontAssetIds?: SampleFontAssetIds;
}

/**
 * Performance scenario: by default 120 artwork objects, 40 data fields, 60 bound properties of
 * which 20 are expressions (the other 40 bind fields directly). Deterministic ids.
 */
export function createLargeVariableDataDocument(
  options: LargeVariableDataOptions = {},
): DesignDocument {
  const objectCount = options.objectCount ?? 120;
  const fieldCount = options.fieldCount ?? 40;
  const fieldBindings = options.fieldBindingCount ?? 40;
  const expressions = options.expressionCount ?? 20;
  const fonts = options.fontAssetIds ?? SAMPLE_FONT_ASSET_IDS;

  const fields: DataField[] = Array.from({ length: fieldCount }, (_, index) =>
    createDataField({
      key: `field_${index + 1}`,
      displayName: `Field ${index + 1}`,
      type: 'string',
      required: index % 4 === 0,
      defaultValue: index % 4 === 0 ? null : `Default ${index + 1}`,
      validation: { minLength: null, maxLength: 80, pattern: null, allowedValues: null },
    }),
  );

  const blank = createBlankDesignDocument({
    documentId: options.documentId ?? '0192f0a0-5b1e-7c3d-8e4f-0000000c0120',
    name: 'Large variable data document',
    documentType: 'HANG_TAG',
    unit: 'mm',
    width: 100,
    height: 150,
    bleed: 3,
    safeMargin: 3,
    pageLayout: 'FRONT_ONLY',
    dataFields: fields,
  });

  const columns = 6;
  const objects = Array.from({ length: objectCount }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const frame = {
      id: `perf-${index + 1}`,
      name: `Object ${index + 1}`,
      zIndex: index,
      x: mm(4 + column * 15.5),
      y: mm(4 + row * 7),
      width: mm(14.5),
      height: mm(6),
    };
    const field = (offset: number) => `field_${((index + offset) % fieldCount) + 1}`;
    if (index < fieldBindings) {
      return createTextObject({
        ...frame,
        content: `Sample ${index + 1}`,
        fontSize: 6,
        ...font(fonts, 400),
        bindings: { content: fieldBinding(field(0)) },
      });
    }
    if (index < fieldBindings + expressions) {
      return createTextObject({
        ...frame,
        content: `Calc ${index + 1}`,
        fontSize: 6,
        ...font(fonts, 400),
        bindings: {
          content: expressionBinding(
            `upper(concat(${field(0)}, "-", fallback(${field(1)}, ${field(2)})))`,
          ),
        },
      });
    }
    return createRectangleObject({
      ...frame,
      fill: rgb(index % 2 === 0 ? '#D9E2EC' : '#BCCCDC'),
      stroke: null,
    });
  });

  return { ...blank, pages: [{ ...blank.pages[0]!, objects }] };
}

/** A record with a value for every field of `createLargeVariableDataDocument`. */
export function createLargeVariableDataRecord(fieldCount = 40): Record<string, string> {
  return Object.fromEntries(
    Array.from({ length: fieldCount }, (_, index) => [`field_${index + 1}`, `Value ${index + 1}`]),
  );
}
