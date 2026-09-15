import { describe, expect, it } from 'vitest';
import { createSampleHangTagDocument, createVariableDataHangTagDocument } from '../src/fixtures';
import {
  bindingFieldKeys,
  collectBoundProperties,
  expressionBinding,
  fieldsReferencedByExpression,
  isObjectDataBound,
  listBoundFieldKeys,
} from '../src';

describe('collectBoundProperties', () => {
  it('lists every field-bound property with its kind', () => {
    const bound = collectBoundProperties(createSampleHangTagDocument());
    expect(bound).toContainEqual({
      pageId: 'page-front',
      objectId: 'front-product-name',
      objectType: 'text',
      property: 'content',
      kind: 'TEXT',
      mode: 'FIELD',
      field: 'product_name',
      expression: null,
      fields: ['product_name'],
    });
    expect(bound).toContainEqual({
      pageId: 'page-front',
      objectId: 'front-barcode',
      objectType: 'barcode',
      property: 'value',
      kind: 'SYMBOL_DATA',
      mode: 'FIELD',
      field: 'gtin',
      expression: null,
      fields: ['gtin'],
    });
    expect(bound.every((entry) => entry.property !== 'visible')).toBe(true);
  });

  it('lists distinct bound field keys', () => {
    expect(listBoundFieldKeys(createSampleHangTagDocument())).toEqual([
      'product_name',
      'size',
      'currency',
      'price',
      'gtin',
      'style',
      'color',
      'country_of_origin',
      'product_url',
    ]);
  });
});

describe('expression bindings', () => {
  it('lists expression-bound properties with the fields they read', () => {
    const bound = collectBoundProperties(createVariableDataHangTagDocument());
    expect(bound).toContainEqual({
      pageId: 'page-front',
      objectId: 'vd-sku',
      objectType: 'text',
      property: 'content',
      kind: 'TEXT',
      mode: 'EXPRESSION',
      field: null,
      expression: 'upper(concat(style, "-", color, "-", size))',
      fields: ['style', 'color', 'size'],
    });
    expect(bound.find((entry) => entry.objectId === 'vd-recycled')).toMatchObject({
      property: 'visible',
      kind: 'VISIBILITY',
      fields: ['is_sustainable'],
    });
  });

  it('includes expression dependencies in the bound field keys', () => {
    expect(listBoundFieldKeys(createVariableDataHangTagDocument()).sort()).toEqual(
      [
        'color',
        'country_of_origin',
        'currency',
        'gtin',
        'is_sustainable',
        'price',
        'product_image',
        'product_name',
        'product_url',
        'size',
        'style',
      ].sort(),
    );
  });

  it('reads dependencies from expression source and tolerates broken expressions', () => {
    expect(fieldsReferencedByExpression('concat(a, b, a)')).toEqual(['a', 'b']);
    expect(fieldsReferencedByExpression('concat(a')).toEqual([]);
    expect(bindingFieldKeys(expressionBinding('if(flag, x, y)'))).toEqual(['flag', 'x', 'y']);
    expect(bindingFieldKeys({ mode: 'STATIC' })).toEqual([]);
  });

  it('detects data-bound objects', () => {
    const document = createVariableDataHangTagDocument();
    const objects = document.pages[0]!.objects;
    expect(isObjectDataBound(objects.find((o) => o.id === 'vd-band')!)).toBe(false);
    expect(isObjectDataBound(objects.find((o) => o.id === 'vd-recycled')!)).toBe(true);
  });
});
