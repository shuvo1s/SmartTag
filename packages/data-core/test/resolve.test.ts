import type { DesignDocument, TextObject } from '@smarttag/document-schema';
import { validateDesignDocument } from '@smarttag/document-schema';
import {
  computeDocumentHash,
  createDataField,
  createTextObject,
  expressionBinding,
} from '@smarttag/document-utils';
import {
  VARIABLE_DATA_RECORD,
  createVariableDataHangTagDocument,
} from '@smarttag/document-utils/fixtures';
import { createApproximateTextMeasurer, createTextLayoutEngine } from '@smarttag/rendering-core';
import { describe, expect, it } from 'vitest';
import {
  buildDataPreview,
  collectFieldUsages,
  computeResolvedInputHash,
  resolveDocumentBindings,
  validateDataRecord,
} from '../src';

function objectById(document: DesignDocument, id: string) {
  const object = document.pages.flatMap((page) => page.objects).find((o) => o.id === id);
  if (!object) throw new Error(`no object ${id}`);
  return object;
}

function resolve(document: DesignDocument, record: unknown) {
  const validation = validateDataRecord(document.dataSchema, record);
  return { validation, ...resolveDocumentBindings(document, validation) };
}

const layout = createTextLayoutEngine({ measurer: createApproximateTextMeasurer() });

describe('resolveDocumentBindings — values', () => {
  it('resolves fields, expressions, visibility, barcode and QR values', () => {
    const document = createVariableDataHangTagDocument();
    const { document: resolved, issues } = resolve(document, VARIABLE_DATA_RECORD);
    expect(issues).toEqual([]);
    expect(objectById(resolved, 'vd-product-name')).toMatchObject({
      content: 'Premium Cotton Shirt',
    });
    expect(objectById(resolved, 'vd-size')).toMatchObject({ content: 'SIZE: XL' });
    expect(objectById(resolved, 'vd-price')).toMatchObject({ content: 'USD 39.95' });
    expect(objectById(resolved, 'vd-sku')).toMatchObject({ content: 'YT-2045-NAVY-XL' });
    expect(objectById(resolved, 'vd-recycled')).toMatchObject({ visible: true });
    expect(objectById(resolved, 'vd-barcode')).toMatchObject({ value: '9501234567891' });
    expect(objectById(resolved, 'vd-qr')).toMatchObject({
      value: 'https://example.com/products/YT-2045',
    });
    expect(objectById(resolved, 'vd-origin')).toMatchObject({ content: 'MADE IN BANGLADESH' });
    // Hidden because the optional image is empty.
    expect(objectById(resolved, 'vd-product-image')).toMatchObject({
      assetId: null,
      visible: false,
    });
    // Bindings stay, the resolved document is still a valid canonical document.
    expect((objectById(resolved, 'vd-size') as TextObject).bindings.content).toEqual(
      expressionBinding('concat("SIZE: ", size)'),
    );
    expect(validateDesignDocument(resolved).valid).toBe(true);
  });

  it('conditional visibility follows the data', () => {
    const document = createVariableDataHangTagDocument();
    const off = resolve(document, { ...VARIABLE_DATA_RECORD, is_sustainable: false });
    expect(objectById(off.document, 'vd-recycled').visible).toBe(false);
    expect(off.hiddenObjectIds.has('vd-recycled')).toBe(true);
  });

  it('fallback() expressions use their alternative', () => {
    const document = createVariableDataHangTagDocument();
    const { document: resolved, issues } = resolve(document, {
      ...VARIABLE_DATA_RECORD,
      product_url: null,
    });
    expect(objectById(resolved, 'vd-qr')).toMatchObject({ value: 'https://example.com/p/YT-2045' });
    expect(issues).toEqual([]);
  });

  it('never mutates the template and never changes its hash', async () => {
    const document = createVariableDataHangTagDocument();
    const snapshot = JSON.stringify(document);
    const hash = await computeDocumentHash(document);
    for (const record of [VARIABLE_DATA_RECORD, { ...VARIABLE_DATA_RECORD, size: 'S' }, {}]) {
      buildDataPreview(document, record, { textLayout: layout });
      expect(JSON.stringify(document)).toBe(snapshot);
      expect(await computeDocumentHash(document)).toBe(hash);
    }
  });

  it('keeps the identity of objects whose resolved values did not change', () => {
    const document = createVariableDataHangTagDocument();
    const first = resolve(document, VARIABLE_DATA_RECORD).document;
    const second = resolve(document, { ...VARIABLE_DATA_RECORD, size: 'M' }).document;
    expect(objectById(second, 'vd-product-name')).toBe(objectById(first, 'vd-product-name'));
    expect(objectById(second, 'vd-size')).not.toBe(objectById(first, 'vd-size'));
    expect(objectById(second, 'vd-band')).toBe(objectById(document, 'vd-band'));
    expect(second.pages[1]).toBe(first.pages[1]);
  });
});

describe('missing-data policy', () => {
  function documentWithOptionalText(policy: 'FAIL' | 'WARN' | 'EMPTY') {
    const document = createVariableDataHangTagDocument();
    document.settings = { missingDataPolicy: policy };
    document.dataSchema.fields.push(createDataField({ key: 'care_note', type: 'string' }));
    document.pages[1]!.objects.push(
      createTextObject({
        id: 'vd-care',
        name: 'Care note',
        x: 10,
        y: 10,
        width: 100,
        height: 20,
        zIndex: 10,
        content: 'Sample care note',
        bindings: { content: { mode: 'FIELD', field: 'care_note' } },
      }),
      createTextObject({
        id: 'vd-care-label',
        name: 'Care label',
        x: 10,
        y: 40,
        width: 100,
        height: 20,
        zIndex: 11,
        content: 'CARE: …',
        bindings: { content: expressionBinding('concat("CARE: ", care_note)') },
      }),
    );
    return document;
  }

  it('FAIL: a missing optional value is a blocking error', () => {
    const { issues, document } = resolve(documentWithOptionalText('FAIL'), VARIABLE_DATA_RECORD);
    expect(issues.map((issue) => [issue.code, issue.severity, issue.target?.objectId])).toEqual([
      ['MISSING_DATA_VALUE', 'ERROR', 'vd-care'],
      ['MISSING_DATA_VALUE', 'ERROR', 'vd-care-label'],
    ]);
    // The sample value is never shown as if it were data.
    expect(objectById(document, 'vd-care')).toMatchObject({ content: '' });
  });

  it('WARN: renders empty and warns', () => {
    const preview = buildDataPreview(documentWithOptionalText('WARN'), VARIABLE_DATA_RECORD);
    expect(preview.issues.map((issue) => [issue.code, issue.severity])).toEqual([
      ['MISSING_DATA_VALUE', 'WARNING'],
      ['MISSING_DATA_VALUE', 'WARNING'],
    ]);
    expect(preview.productionValid).toBe(true);
    expect(objectById(preview.resolution.document, 'vd-care-label')).toMatchObject({
      content: 'CARE: ',
    });
  });

  it('EMPTY: renders empty silently', () => {
    const { issues, document } = resolve(documentWithOptionalText('EMPTY'), VARIABLE_DATA_RECORD);
    expect(issues).toEqual([]);
    expect(objectById(document, 'vd-care')).toMatchObject({ content: '' });
  });

  it('required values are errors whatever the policy', () => {
    const { issues } = resolve(documentWithOptionalText('EMPTY'), {
      ...VARIABLE_DATA_RECORD,
      size: undefined,
    });
    expect(issues.map((issue) => [issue.code, issue.severity, issue.target?.objectId])).toEqual([
      ['MISSING_DATA_VALUE', 'ERROR', 'vd-size'],
      ['MISSING_DATA_VALUE', 'ERROR', 'vd-sku'],
    ]);
  });

  it('invalid values propagate as INVALID_DATA_VALUE, not as missing values', () => {
    const { validation, issues } = resolve(createVariableDataHangTagDocument(), {
      ...VARIABLE_DATA_RECORD,
      price: '19,99',
    });
    expect(validation.issues.map((issue) => issue.code)).toEqual(['INVALID_VALUE']);
    expect(issues).toEqual([
      expect.objectContaining({
        layer: 'BINDING',
        code: 'INVALID_DATA_VALUE',
        field: 'price',
        target: expect.objectContaining({ objectId: 'vd-price', property: 'content' }) as unknown,
      }),
    ]);
  });
});

describe('validation layers after resolution', () => {
  it('an invalid EAN-13 check digit is an OBJECT issue, not a data issue', () => {
    const preview = buildDataPreview(createVariableDataHangTagDocument(), {
      ...VARIABLE_DATA_RECORD,
      // The GTIN of the specification's example record: its check digit should be 1.
      gtin: '9501234567893',
    });
    expect(preview.issues.map((issue) => [issue.layer, issue.code])).toEqual([
      ['OBJECT', 'BARCODE_VALUE_INVALID'],
    ]);
    expect(preview.issues[0]?.message).toMatch(/check digit should be 1/i);
    expect(preview.productionValid).toBe(false);
  });

  it('a missing GTIN is a DATA issue and does not also report the empty barcode', () => {
    const preview = buildDataPreview(createVariableDataHangTagDocument(), {
      ...VARIABLE_DATA_RECORD,
      gtin: '',
    });
    expect(preview.issues.map((issue) => [issue.layer, issue.code])).toEqual([
      ['DATA', 'REQUIRED_VALUE_EMPTY'],
      ['BINDING', 'MISSING_DATA_VALUE'],
    ]);
  });

  it('long real data overflows text that fits the sample — a LAYOUT warning, never truncated', () => {
    const preview = buildDataPreview(
      createVariableDataHangTagDocument(),
      {
        ...VARIABLE_DATA_RECORD,
        color: 'Midnight Navy Heather With Contrast Stitching And Extra Long Colour Name',
      },
      { textLayout: layout },
    );
    const overflow = preview.issues.filter((issue) => issue.code === 'TEXT_OVERFLOW');
    expect(overflow).toEqual([
      expect.objectContaining({
        layer: 'LAYOUT',
        severity: 'WARNING',
        target: expect.objectContaining({ objectId: 'vd-sku' }) as unknown,
      }),
    ]);
    const sku = objectById(preview.resolution.document, 'vd-sku') as TextObject;
    expect(sku.content).toContain('EXTRA LONG COLOUR NAME');
  });

  it('shrink-to-fit text reports overflow only below its minimum size', () => {
    const fits = buildDataPreview(createVariableDataHangTagDocument(), VARIABLE_DATA_RECORD, {
      textLayout: layout,
    });
    expect(fits.issues).toEqual([]);
    const document = createVariableDataHangTagDocument();
    const nameField = document.dataSchema.fields.find((field) => field.key === 'product_name')!;
    nameField.validation = { minLength: null, maxLength: null, pattern: null, allowedValues: null };
    const tooLong = buildDataPreview(
      document,
      {
        ...VARIABLE_DATA_RECORD,
        product_name:
          'PREMIUM ORGANIC COTTON OVERSIZED SHIRT WITH A VERY LONG MARKETING DESCRIPTION '.repeat(
            2,
          ),
      },
      { textLayout: layout },
    );
    expect(tooLong.issues.map((issue) => issue.code)).toContain('TEXT_OVERFLOW');
    expect(tooLong.issues.find((issue) => issue.code === 'TEXT_OVERFLOW')?.message).toContain(
      'minimum size',
    );
  });

  it('image fields: empty is a warning when visible, unavailable assets are errors', () => {
    const document = createVariableDataHangTagDocument();
    document.settings = { missingDataPolicy: 'EMPTY' };
    const image = objectById(document, 'vd-product-image');
    image.bindings = {
      assetId: { mode: 'FIELD', field: 'product_image' },
      visible: { mode: 'STATIC' },
    };
    expect(buildDataPreview(document, VARIABLE_DATA_RECORD).issues).toEqual([
      expect.objectContaining({
        layer: 'OBJECT',
        code: 'IMAGE_SOURCE_MISSING',
        severity: 'WARNING',
      }),
    ]);
    const foreign = '0192f0a0-0000-7000-8000-00000000dead';
    const preview = buildDataPreview(
      document,
      { ...VARIABLE_DATA_RECORD, product_image: foreign },
      { assetAvailability: (id) => (id === foreign ? 'UNAVAILABLE' : 'AVAILABLE') },
    );
    expect(preview.issues).toEqual([
      expect.objectContaining({
        layer: 'OBJECT',
        code: 'IMAGE_ASSET_UNAVAILABLE',
        severity: 'ERROR',
      }),
    ]);
  });

  it('summarizes fields as valid, warning or error', () => {
    const preview = buildDataPreview(createVariableDataHangTagDocument(), {
      ...VARIABLE_DATA_RECORD,
      size: 'XXXL',
      colour: 'Navy',
    });
    expect(preview.summary).toMatchObject({ fieldsChecked: 11, valid: 10, warnings: 0, errors: 1 });
    expect(preview.summary.fields.find((field) => field.key === 'size')?.state).toBe('ERROR');
    expect(preview.summary.layers.DATA).toEqual({ errors: 1, warnings: 1 });
  });
});

describe('expression errors stay local', () => {
  it('one failing expression does not stop other properties from resolving', () => {
    const document = createVariableDataHangTagDocument();
    const size = objectById(document, 'vd-size');
    size.bindings = { ...size.bindings, content: expressionBinding('formatNumber(price, 2, "1")') };
    const { document: resolved, issues } = resolve(document, VARIABLE_DATA_RECORD);
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'EXPRESSION_EVALUATION_ERROR',
        target: expect.objectContaining({ objectId: 'vd-size' }) as unknown,
      }),
    ]);
    expect(objectById(resolved, 'vd-size')).toMatchObject({ content: '' });
    expect(objectById(resolved, 'vd-price')).toMatchObject({ content: 'USD 39.95' });
  });
});

describe('resolved input identity', () => {
  it('is deterministic for equal logical records and changes with the data', async () => {
    const document = createVariableDataHangTagDocument();
    const templateHash = await computeDocumentHash(document);
    const hashOf = (record: unknown) =>
      computeResolvedInputHash(
        templateHash,
        validateDataRecord(document.dataSchema, record).normalizedRecord,
      );

    const a = await hashOf(VARIABLE_DATA_RECORD);
    const b = await hashOf({
      ...Object.fromEntries(Object.entries(VARIABLE_DATA_RECORD).reverse()),
      price: '39.95',
    });
    const c = await hashOf({ ...VARIABLE_DATA_RECORD, size: 'M' });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(await computeDocumentHash(document)).toBe(templateHash);
    await expect(computeResolvedInputHash('not-a-hash', {})).rejects.toThrow(RangeError);
  });
});

describe('field usages', () => {
  it('lists every property that reads a field, including expressions', () => {
    const usages = collectFieldUsages(createVariableDataHangTagDocument());
    expect(usages.get('size')?.map((usage) => usage.label)).toEqual([
      'Front / Size / Content',
      'Front / SKU code / Content',
    ]);
    expect(usages.get('product_image')?.map((usage) => [usage.property, usage.mode])).toEqual([
      ['assetId', 'FIELD'],
      ['visible', 'EXPRESSION'],
    ]);
    expect(usages.get('color')).toHaveLength(1);
  });
});
