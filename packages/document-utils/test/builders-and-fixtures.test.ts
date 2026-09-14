import { ELEMENT_ID_PATTERN, validateDesignDocument } from '@smarttag/document-schema';
import { describe, expect, it } from 'vitest';
import {
  SAMPLE_BRAND_LOGO_ASSET_ID,
  SAMPLE_FONT_ASSET_IDS,
  SAMPLE_HANG_TAG_DOCUMENT_ID,
  createSampleHangTagDocument,
} from '../src/fixtures';
import {
  DOCUMENT_TYPE_DEFINITIONS,
  collectAssetReferences,
  computeEffectiveResolution,
  createBlankDesignDocument,
  createElementId,
  isDocumentTypeAvailable,
  listDocumentTypes,
  mmToPt,
  rgb,
  summarizeDesignDocument,
} from '../src';

// The sample uses Noto Sans 500/600/700 and Noto Sans Bengali 400 (Noto Sans Regular is seeded but unused).
const SAMPLE_USED_FONT_ASSET_IDS = [
  SAMPLE_FONT_ASSET_IDS.notoSansMedium,
  SAMPLE_FONT_ASSET_IDS.notoSansSemiBold,
  SAMPLE_FONT_ASSET_IDS.notoSansBold,
  SAMPLE_FONT_ASSET_IDS.notoSansBengaliRegular,
];

describe('createBlankDesignDocument', () => {
  it('creates a valid front-only document with geometry converted to points', () => {
    const document = createBlankDesignDocument({
      name: 'Care label',
      documentType: 'CARE_LABEL',
      unit: 'in',
      width: 1.5,
      height: 3,
      bleed: 0.125,
      safeMargin: 0.0625,
      pageLayout: 'FRONT_ONLY',
    });
    expect(validateDesignDocument(document)).toMatchObject({
      valid: true,
      errors: [],
      warnings: [],
    });
    expect(document.dimensions).toMatchObject({
      width: 108,
      height: 216,
      orientation: 'PORTRAIT',
      displayUnit: 'in',
    });
    expect(document.dimensions.bleed).toEqual({ top: 9, right: 9, bottom: 9, left: 9 });
    expect(document.dimensions.safeArea.left).toBe(4.5);
    expect(document.pages.map((page) => page.side)).toEqual(['FRONT']);
  });

  it('creates front and back pages and derives landscape orientation', () => {
    const document = createBlankDesignDocument({
      name: 'Ticket',
      documentType: 'PRICE_TICKET',
      unit: 'mm',
      width: 60,
      height: 40,
      bleed: 2,
      safeMargin: 2,
      pageLayout: 'FRONT_AND_BACK',
    });
    expect(validateDesignDocument(document).valid).toBe(true);
    expect(document.dimensions.orientation).toBe('LANDSCAPE');
    expect(document.pages.map((page) => [page.id, page.side])).toEqual([
      ['page-front', 'FRONT'],
      ['page-back', 'BACK'],
    ]);
  });

  it('assigns a fresh document id unless one is given', () => {
    const options = {
      name: 'x',
      documentType: 'HANG_TAG',
      unit: 'mm',
      width: 10,
      height: 10,
      bleed: 0,
      safeMargin: 1,
      pageLayout: 'FRONT_ONLY',
    } as const;
    expect(createBlankDesignDocument(options).documentId).not.toBe(
      createBlankDesignDocument(options).documentId,
    );
    expect(
      createBlankDesignDocument({ ...options, documentId: SAMPLE_HANG_TAG_DOCUMENT_ID }).documentId,
    ).toBe(SAMPLE_HANG_TAG_DOCUMENT_ID);
  });
});

describe('sample hang tag fixture (50 × 90 mm, 3 mm bleed, 3 mm safe, front + back)', () => {
  const document = createSampleHangTagDocument();

  it('validates with no errors and no warnings', () => {
    expect(validateDesignDocument(document)).toMatchObject({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('has the specified physical dimensions in canonical points', () => {
    expect(document.dimensions.width).toBeCloseTo(mmToPt(50), 12);
    expect(document.dimensions.height).toBeCloseTo(mmToPt(90), 12);
    expect(document.dimensions.bleed.top).toBeCloseTo(mmToPt(3), 12);
    expect(document.dimensions.safeArea.right).toBeCloseTo(mmToPt(3), 12);
    expect(document.dimensions.displayUnit).toBe('mm');
  });

  it('contains the specified front and back content', () => {
    const [front, back] = document.pages;
    expect(front?.side).toBe('FRONT');
    expect(back?.side).toBe('BACK');
    expect(front?.objects.map((object) => object.name)).toEqual(
      expect.arrayContaining(['Brand logo', 'Product name', 'Size', 'Price', 'EAN-13 barcode']),
    );
    expect(back?.objects.map((object) => object.name)).toEqual(
      expect.arrayContaining(['Style', 'Color', 'Country of origin', 'Product QR code']),
    );
  });

  it('summarises the document', () => {
    const summary = summarizeDesignDocument(document);
    expect(summary).toMatchObject({
      documentType: 'HANG_TAG',
      pageCount: 2,
      pageSides: ['FRONT', 'BACK'],
      dataFieldCount: 10,
    });
    expect(summary.boundFieldKeys).toEqual(
      expect.arrayContaining(['product_name', 'size', 'price', 'gtin']),
    );
    expect(summary.assetIds).toEqual(
      [SAMPLE_BRAND_LOGO_ASSET_ID, ...SAMPLE_USED_FONT_ASSET_IDS].sort(),
    );
    expect(summary.fontAssetIds).toEqual([...SAMPLE_USED_FONT_ASSET_IDS].sort());
  });
});

describe('ids and colors', () => {
  it('creates unique, schema-compliant element ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => createElementId('txt')));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(ELEMENT_ID_PATTERN);
    expect(() => createElementId('Bad Prefix')).toThrow(RangeError);
  });

  it('normalises colors to canonical upper-case hex', () => {
    expect(rgb('#0b6e4f')).toEqual({ space: 'RGB', hex: '#0B6E4F' });
    expect(rgb('fa0')).toEqual({ space: 'RGB', hex: '#FFAA00' });
    expect(() => rgb('#12345')).toThrow(RangeError);
  });
});

describe('asset references and effective resolution', () => {
  it('collects image and font asset references including image-field defaults', () => {
    const document = createSampleHangTagDocument();
    const defaultImage = '0192f0a0-5b1e-7c3d-8a4f-000000000001';
    document.dataSchema.fields = document.dataSchema.fields.map((field) =>
      field.type === 'image' ? { ...field, defaultValue: defaultImage } : field,
    );
    expect(collectAssetReferences(document)).toEqual(
      [SAMPLE_BRAND_LOGO_ASSET_ID, defaultImage, ...SAMPLE_USED_FONT_ASSET_IDS].sort(),
    );
  });

  it('computes 300 ppi for 1181 px printed across 100 mm', () => {
    const result = computeEffectiveResolution(
      { widthPx: 1181, heightPx: 591 },
      { width: mmToPt(100), height: mmToPt(50), fitMode: 'STRETCH', crop: null },
    );
    expect(result.horizontalPpi).toBeCloseTo(299.97, 1);
    expect(result.effectivePpi).toBeCloseTo(Math.min(result.horizontalPpi, result.verticalPpi), 10);
  });

  it('accounts for fit mode and crop', () => {
    const source = { widthPx: 2000, heightPx: 1000 };
    const frame = { width: 72, height: 72 };
    // CONTAIN: 2000 px spans the 1 in frame width → 2000 ppi
    expect(
      computeEffectiveResolution(source, { ...frame, fitMode: 'CONTAIN', crop: null }).effectivePpi,
    ).toBeCloseTo(2000, 6);
    // COVER: 1000 px spans the 1 in frame height → 1000 ppi
    expect(
      computeEffectiveResolution(source, { ...frame, fitMode: 'COVER', crop: null }).effectivePpi,
    ).toBeCloseTo(1000, 6);
    // Cropping to the left half leaves 1000×1000 px on a 1 in square → 1000 ppi
    expect(
      computeEffectiveResolution(source, {
        ...frame,
        fitMode: 'CONTAIN',
        crop: { x: 0, y: 0, width: 0.5, height: 1 },
      }).effectivePpi,
    ).toBeCloseTo(1000, 6);
  });
});

describe('document type registry', () => {
  it('covers every document type and enables hang tags first', () => {
    expect(isDocumentTypeAvailable('HANG_TAG')).toBe(true);
    expect(isDocumentTypeAvailable('RFID_LABEL')).toBe(false);
    expect(listDocumentTypes('AVAILABLE').map((d) => d.type)).toEqual(['HANG_TAG']);
    expect(listDocumentTypes()).toHaveLength(Object.keys(DOCUMENT_TYPE_DEFINITIONS).length);
  });
});
