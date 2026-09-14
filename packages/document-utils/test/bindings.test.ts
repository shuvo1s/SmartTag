import { validateDesignDocument, type DesignDocument, type TextObject } from '@smarttag/document-schema';
import { describe, expect, it } from 'vitest';
import {
  SAMPLE_HANG_TAG_RECORD,
  createSampleHangTagDocument,
} from '../src/fixtures';
import {
  coerceDataValue,
  collectBoundProperties,
  createTextObject,
  fieldBinding,
  isMissingValue,
  listBoundFieldKeys,
  resolveDocumentBindings,
  type DataRecord,
} from '../src';

function findObject(document: DesignDocument, id: string) {
  const object = document.pages.flatMap((page) => page.objects).find((candidate) => candidate.id === id);
  if (!object) throw new Error(`object ${id} not found`);
  return object;
}

describe('collectBoundProperties', () => {
  it('lists every field-bound property with its kind', () => {
    const bound = collectBoundProperties(createSampleHangTagDocument());
    expect(bound).toContainEqual({
      pageId: 'page-front', objectId: 'front-product-name', objectType: 'text', property: 'content', kind: 'TEXT', field: 'product_name',
    });
    expect(bound).toContainEqual({
      pageId: 'page-front', objectId: 'front-barcode', objectType: 'barcode', property: 'value', kind: 'SYMBOL_DATA', field: 'gtin',
    });
    expect(bound.every((entry) => entry.property !== 'visible')).toBe(true);
  });

  it('lists distinct bound field keys', () => {
    expect(listBoundFieldKeys(createSampleHangTagDocument())).toEqual([
      'product_name', 'size', 'currency', 'price', 'gtin', 'style', 'color', 'country_of_origin', 'product_url',
    ]);
  });
});

describe('resolveDocumentBindings', () => {
  it('replaces bound values with record values and keeps static values untouched', () => {
    const document = createSampleHangTagDocument();
    const record: DataRecord = { ...SAMPLE_HANG_TAG_RECORD, product_name: 'Linen Shirt', size: 'XL', price: '49.50', gtin: '5901234123457' };
    const { ok, issues, document: resolved } = resolveDocumentBindings(document, record);

    expect(issues).toEqual([]);
    expect(ok).toBe(true);
    expect(findObject(resolved, 'front-product-name')).toMatchObject({ content: 'Linen Shirt' });
    expect(findObject(resolved, 'front-size')).toMatchObject({ content: 'XL' });
    expect(findObject(resolved, 'front-price')).toMatchObject({ content: '49.50' });
    expect(findObject(resolved, 'front-barcode')).toMatchObject({ value: '5901234123457' });
    expect(findObject(resolved, 'front-size-label')).toMatchObject({ content: 'SIZE' });
    expect(findObject(resolved, 'back-origin-bn')).toMatchObject({ content: 'বাংলাদেশে তৈরি' });
    // bindings are retained so the resolved document is still traceable to its data schema
    expect(findObject(resolved, 'front-price').bindings).toEqual({ content: { mode: 'FIELD', field: 'price' }, visible: { mode: 'STATIC' } });
    expect(validateDesignDocument(resolved).valid).toBe(true);
  });

  it('never mutates the source document', () => {
    const document = createSampleHangTagDocument();
    const snapshot = JSON.stringify(document);
    resolveDocumentBindings(document, { ...SAMPLE_HANG_TAG_RECORD, product_name: 'Changed' });
    expect(JSON.stringify(document)).toBe(snapshot);
  });

  it('falls back to field default values', () => {
    const { document, ok } = resolveDocumentBindings(createSampleHangTagDocument(), {
      ...SAMPLE_HANG_TAG_RECORD, currency: undefined, country_of_origin: null,
    });
    expect(ok).toBe(true);
    expect(findObject(document, 'front-currency')).toMatchObject({ content: 'EUR' });
    expect(findObject(document, 'back-origin')).toMatchObject({ content: 'Bangladesh' });
  });

  it('reports missing required values', () => {
    const { ok, issues } = resolveDocumentBindings(createSampleHangTagDocument(), { ...SAMPLE_HANG_TAG_RECORD, gtin: undefined });
    expect(ok).toBe(false);
    expect(issues).toEqual([expect.objectContaining({ code: 'MISSING_DATA_VALUE', objectId: 'front-barcode', field: 'gtin' })]);
  });

  it('reports values that do not match the field type', () => {
    const { issues } = resolveDocumentBindings(createSampleHangTagDocument(), { ...SAMPLE_HANG_TAG_RECORD, price: '19,99' });
    expect(issues).toEqual([expect.objectContaining({ code: 'INVALID_DATA_VALUE', field: 'price' })]);
  });

  it('applies the EMPTY missing-data policy to optional fields without defaults', () => {
    const document = createSampleHangTagDocument();
    document.settings = { missingDataPolicy: 'EMPTY' };
    const { ok, document: resolved } = resolveDocumentBindings(document, { ...SAMPLE_HANG_TAG_RECORD, product_url: undefined });
    expect(ok).toBe(true);
    expect(findObject(resolved, 'back-qr')).toMatchObject({ value: '' });
  });

  it('applies the FAIL missing-data policy to optional fields without defaults', () => {
    const { issues } = resolveDocumentBindings(createSampleHangTagDocument(), { ...SAMPLE_HANG_TAG_RECORD, product_url: undefined });
    expect(issues.map((issue) => issue.field)).toEqual(['product_url']);
  });

  it('binds object visibility to boolean fields', () => {
    const document = createSampleHangTagDocument();
    document.dataSchema.fields.push({ key: 'show_sale', displayName: 'Show sale badge', type: 'boolean', required: false, defaultValue: false, description: '' });
    const badge: TextObject = createTextObject({
      id: 'sale-badge', x: 10, y: 10, width: 40, height: 10, zIndex: 99, content: 'SALE',
      bindings: { visible: fieldBinding('show_sale') },
    });
    document.pages[0]!.objects.push(badge);
    expect(validateDesignDocument(document).valid).toBe(true);

    const shown = resolveDocumentBindings(document, { ...SAMPLE_HANG_TAG_RECORD, show_sale: 'yes' });
    const hidden = resolveDocumentBindings(document, { ...SAMPLE_HANG_TAG_RECORD });
    expect(findObject(shown.document, 'sale-badge').visible).toBe(true);
    expect(findObject(hidden.document, 'sale-badge').visible).toBe(false);
  });
});

describe('coerceDataValue', () => {
  const field = <T extends string>(type: T) =>
    ({ key: 'f', displayName: 'F', type, required: false, defaultValue: null, description: '' }) as never;

  it.each([
    ['string', 42, '42'],
    ['number', ' 12.5 ', 12.5],
    ['number', 7, 7],
    ['decimal', '0019.990', '0019.990'],
    ['decimal', 4.5, '4.5'],
    ['boolean', 'Yes', true],
    ['boolean', '0', false],
    ['date', '2026-02-28', '2026-02-28'],
    ['url', 'https://example.com/a?b=c', 'https://example.com/a?b=c'],
    ['image', '0192F0A0-5B1E-7C3D-9A4F-6B7C8D9E0F10', '0192f0a0-5b1e-7c3d-9a4f-6b7c8d9e0f10'],
  ])('coerces %s ← %p', (type, raw, expected) => {
    expect(coerceDataValue(field(type), raw)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['number', 'twelve'],
    ['decimal', '1,5'],
    ['decimal', true],
    ['boolean', 'maybe'],
    ['date', '2026-02-30'],
    ['date', '28/02/2026'],
    ['url', 'javascript:alert(1)'],
    ['url', 'ftp://example.com'],
    ['image', 'logo.png'],
  ])('rejects %s ← %p', (type, raw) => {
    expect(coerceDataValue(field(type), raw).ok).toBe(false);
  });

  it('treats empty cells as missing for non-text fields only', () => {
    expect(isMissingValue(field('number'), '  ')).toBe(true);
    expect(isMissingValue(field('string'), '')).toBe(false);
    expect(isMissingValue(field('string'), null)).toBe(true);
  });
});
