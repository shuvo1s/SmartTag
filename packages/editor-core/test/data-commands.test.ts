import {
  validateDesignDocument,
  type DesignDocument,
  type TextObject,
} from '@smarttag/document-schema';
import { computeDocumentHash, createDataField, expressionBinding } from '@smarttag/document-utils';
import { createVariableDataHangTagDocument } from '@smarttag/document-utils/fixtures';
import { describe, expect, it } from 'vitest';
import {
  EditorCommandError,
  EditorStore,
  FieldInUseError,
  addDataField,
  checkNewFieldKey,
  countFieldUsages,
  createFieldObject,
  deleteDataField,
  findPage,
  moveDataField,
  renameDataField,
  setMissingDataPolicy,
  setPropertyBinding,
  updateDataField,
} from '../src';

const FRONT = 'page-front';
const BACK = 'page-back';

function object(document: DesignDocument, pageId: string, id: string) {
  return findPage(document, pageId).objects.find((candidate) => candidate.id === id)!;
}

function expectValid(document: DesignDocument) {
  expect(validateDesignDocument(document).errors).toEqual([]);
}

describe('adding fields', () => {
  it('adds a string and a decimal field', () => {
    let document = createVariableDataHangTagDocument();
    document = addDataField(
      document,
      createDataField({ key: 'care_note', displayName: 'Care note', type: 'string' }),
    );
    document = addDataField(
      document,
      createDataField({
        key: 'retail_price',
        type: 'decimal',
        required: true,
        validation: { min: '0.01', max: null, allowedValues: null },
      }),
    );
    expect(document.dataSchema.fields.slice(-2).map((field) => [field.key, field.type])).toEqual([
      ['care_note', 'string'],
      ['retail_price', 'decimal'],
    ]);
    expectValid(document);
  });

  it.each([
    ['product_name', 'already exists'],
    ['Product Name', 'lowercase letter'],
    ['__serial', 'reserved for system fields'],
    ['__proto__', 'reserved for system fields'],
    ['constructor', 'is reserved'],
    ['prototype', 'is reserved'],
    ['', 'Enter a key'],
  ])('refuses the key %j', (key, message) => {
    const document = createVariableDataHangTagDocument();
    expect(checkNewFieldKey(document, key)).toContain(message);
    expect(() =>
      addDataField(document, { ...createDataField({ key: 'x', type: 'string' }), key }),
    ).toThrow(message);
  });

  it('refuses invalid defaults and inconsistent rules with a readable message', () => {
    const document = createVariableDataHangTagDocument();
    expect(() =>
      addDataField(
        document,
        createDataField({ key: 'price_2', type: 'decimal', defaultValue: '19,99' }),
      ),
    ).toThrow(EditorCommandError);
    expect(() =>
      addDataField(
        document,
        createDataField({
          key: 'code',
          type: 'string',
          validation: { minLength: 5, maxLength: 1, pattern: null, allowedValues: null },
        }),
      ),
    ).toThrow('minimum length is greater');
    expect(() =>
      addDataField(
        document,
        createDataField({
          key: 'code',
          type: 'string',
          validation: { minLength: null, maxLength: null, pattern: '(a+)\\1', allowedValues: null },
        }),
      ),
    ).toThrow('Back-references');
  });
});

describe('editing fields', () => {
  it('edits display name, required, default, description and rules without touching bindings', () => {
    const before = createVariableDataHangTagDocument();
    const after = updateDataField(before, 'size', {
      displayName: 'Garment size',
      required: false,
      defaultValue: 'M',
      description: 'Size code',
    });
    expect(after.dataSchema.fields.find((field) => field.key === 'size')).toMatchObject({
      key: 'size',
      displayName: 'Garment size',
      required: false,
      defaultValue: 'M',
    });
    expect(after.pages).toBe(before.pages);
    expectValid(after);
  });

  it('returns the same document for a no-op edit (no undo step)', () => {
    const document = createVariableDataHangTagDocument();
    expect(updateDataField(document, 'size', { displayName: 'Size' })).toBe(document);
  });

  it('refuses a default outside the allowed values', () => {
    expect(() =>
      updateDataField(createVariableDataHangTagDocument(), 'size', { defaultValue: 'XXXL' }),
    ).toThrow('must be one of');
  });

  it('refuses changing the type of a used field, but allows it for unused fields', () => {
    const document = createVariableDataHangTagDocument();
    expect(() => updateDataField(document, 'size', { type: 'number' })).toThrow(FieldInUseError);
    const withUnused = addDataField(document, createDataField({ key: 'note', type: 'string' }));
    const changed = updateDataField(withUnused, 'note', { type: 'boolean' });
    expect(changed.dataSchema.fields.at(-1)).toMatchObject({
      type: 'boolean',
      defaultValue: null,
      validation: {},
    });
    expectValid(changed);
  });

  it('reorders fields', () => {
    const document = moveDataField(createVariableDataHangTagDocument(), 'price', 0);
    expect(document.dataSchema.fields[0]?.key).toBe('price');
  });
});

describe('renaming field keys', () => {
  it('updates every field binding and expression atomically', async () => {
    const before = createVariableDataHangTagDocument();
    expect(countFieldUsages(before, 'size')).toBe(2);
    const { document, updatedBindings } = renameDataField(before, 'size', 'item_size');
    expect(updatedBindings).toBe(2);
    expect(document.dataSchema.fields.some((field) => field.key === 'size')).toBe(false);
    expect(object(document, FRONT, 'vd-size').bindings).toMatchObject({
      content: expressionBinding('concat("SIZE: ", item_size)'),
    });
    expect((object(document, FRONT, 'vd-sku') as TextObject).bindings.content).toEqual(
      expressionBinding('upper(concat(style, "-", color, "-", item_size))'),
    );
    expect(countFieldUsages(document, 'size')).toBe(0);
    expectValid(document);
    // Untouched objects keep their identity.
    expect(object(document, BACK, 'vd-qr')).toBe(object(before, BACK, 'vd-qr'));
    expect(await computeDocumentHash(before)).not.toBe(await computeDocumentHash(document));
  });

  it('renames a field bound directly', () => {
    const { document } = renameDataField(createVariableDataHangTagDocument(), 'gtin', 'ean');
    expect(object(document, FRONT, 'vd-barcode').bindings).toMatchObject({
      value: { mode: 'FIELD', field: 'ean' },
    });
    expectValid(document);
  });

  it('refuses keys that are taken, reserved or malformed', () => {
    const document = createVariableDataHangTagDocument();
    expect(() => renameDataField(document, 'size', 'color')).toThrow('already exists');
    expect(() => renameDataField(document, 'size', '__size')).toThrow('reserved');
    expect(() => renameDataField(document, 'size', 'Size')).toThrow('lowercase');
  });

  it('is one undo step', () => {
    const store = new EditorStore({ document: createVariableDataHangTagDocument() });
    const original = store.getState().document;
    store.apply(
      'Rename field',
      (document) => renameDataField(document, 'size', 'item_size').document,
    );
    expect(store.getState().undoLabel).toBe('Rename field');
    store.undo();
    expect(store.getState().document).toBe(original);
    store.redo();
    expect(countFieldUsages(store.getState().document, 'item_size')).toBe(2);
  });
});

describe('deleting fields', () => {
  it('deletes an unused field', () => {
    const document = addDataField(
      createVariableDataHangTagDocument(),
      createDataField({ key: 'note', type: 'string' }),
    );
    const result = deleteDataField(document, 'note', { removeBindings: false });
    expect(result.removedBindings).toBe(0);
    expect(result.document.dataSchema.fields.some((field) => field.key === 'note')).toBe(false);
  });

  it('never lets a used field disappear silently', () => {
    const document = createVariableDataHangTagDocument();
    expect(() => deleteDataField(document, 'size', { removeBindings: false })).toThrow(
      'used by 2 design properties',
    );
  });

  it('with confirmation, returns every affected binding to its static value in one change', () => {
    const store = new EditorStore({ document: createVariableDataHangTagDocument() });
    const original = store.getState().document;
    store.apply(
      'Delete field',
      (document) => deleteDataField(document, 'size', { removeBindings: true }).document,
    );
    const document = store.getState().document;
    expect(object(document, FRONT, 'vd-size')).toMatchObject({
      content: 'SIZE: M',
      bindings: { content: { mode: 'STATIC' } },
    });
    expect(object(document, FRONT, 'vd-sku').bindings).toMatchObject({
      content: { mode: 'STATIC' },
    });
    expectValid(document);
    store.undo();
    expect(store.getState().document).toBe(original);
  });
});

describe('property bindings', () => {
  it('binds text content to a field and returns to static, keeping the static value', () => {
    const document = createVariableDataHangTagDocument();
    const bound = setPropertyBinding(document, BACK, 'vd-origin', 'content', {
      mode: 'FIELD',
      field: 'country_of_origin',
    });
    expect(object(bound, BACK, 'vd-origin')).toMatchObject({ content: 'MADE IN BANGLADESH' });
    const restored = setPropertyBinding(bound, BACK, 'vd-origin', 'content', { mode: 'STATIC' });
    expect(object(restored, BACK, 'vd-origin')).toMatchObject({
      content: 'MADE IN BANGLADESH',
      bindings: { content: { mode: 'STATIC' } },
    });
    expectValid(restored);
  });

  it('binds barcode and QR values, visibility and image sources', () => {
    let document = createVariableDataHangTagDocument();
    document = setPropertyBinding(document, BACK, 'vd-qr', 'value', {
      mode: 'FIELD',
      field: 'product_url',
    });
    document = setPropertyBinding(document, FRONT, 'vd-band', 'visible', {
      mode: 'EXPRESSION',
      expression: 'currency != "EUR"',
    });
    document = setPropertyBinding(document, FRONT, 'vd-barcode', 'value', {
      mode: 'EXPRESSION',
      expression: 'trim(gtin)',
    });
    document = setPropertyBinding(document, FRONT, 'vd-product-image', 'visible', {
      mode: 'FIELD',
      field: 'is_sustainable',
    });
    expectValid(document);
  });

  it.each([
    [
      'vd-product-image',
      'assetId',
      { mode: 'FIELD', field: 'is_sustainable' },
      'cannot be used for',
    ],
    ['vd-recycled', 'visible', { mode: 'FIELD', field: 'product_name' }, 'needs true/false'],
    ['vd-price', 'content', { mode: 'FIELD', field: 'missing_field' }, 'unknown data field'],
    ['vd-price', 'content', { mode: 'EXPRESSION', expression: 'concat(price' }, 'Expected'],
    ['vd-price', 'content', { mode: 'EXPRESSION', expression: 'fetch("x")' }, 'no function'],
    ['vd-price', 'fontSize', { mode: 'FIELD', field: 'price' }, 'cannot be bound'],
    ['vd-price', 'x', { mode: 'FIELD', field: 'price' }, 'cannot be bound'],
  ] as const)('refuses nonsensical binding %s.%s', (objectId, property, binding, message) => {
    expect(() =>
      setPropertyBinding(createVariableDataHangTagDocument(), FRONT, objectId, property, binding),
    ).toThrow(message);
  });

  it('a no-op binding change returns the same document', () => {
    const document = createVariableDataHangTagDocument();
    expect(
      setPropertyBinding(document, FRONT, 'vd-barcode', 'value', { mode: 'FIELD', field: 'gtin' }),
    ).toBe(document);
  });

  it('sets the missing-data policy', () => {
    const document = createVariableDataHangTagDocument();
    expect(setMissingDataPolicy(document, 'FAIL')).toBe(document);
    expect(setMissingDataPolicy(document, 'WARN').settings.missingDataPolicy).toBe('WARN');
  });
});

describe('objects created from dropped fields', () => {
  it('creates bound text at the drop point — also for a GTIN field', () => {
    const document = createVariableDataHangTagDocument();
    const gtin = document.dataSchema.fields.find((field) => field.key === 'gtin')!;
    const text = createFieldObject(gtin, document, { center: { x: 70, y: 100 } });
    expect(text).toMatchObject({
      type: 'text',
      name: 'GTIN',
      content: 'GTIN',
      bindings: { content: { mode: 'FIELD', field: 'gtin' } },
    });
    expect(text.x + text.width / 2).toBeCloseTo(70, 3);
    const currency = document.dataSchema.fields.find((field) => field.key === 'currency')!;
    expect(createFieldObject(currency, document)).toMatchObject({ content: 'USD' });
  });

  it('creates an image frame for image fields and refuses booleans', () => {
    const document = createVariableDataHangTagDocument();
    const image = document.dataSchema.fields.find((field) => field.key === 'product_image')!;
    expect(createFieldObject(image, document)).toMatchObject({
      type: 'image',
      assetId: null,
      bindings: { assetId: { mode: 'FIELD', field: 'product_image' } },
    });
    const flag = document.dataSchema.fields.find((field) => field.key === 'is_sustainable')!;
    expect(() => createFieldObject(flag, document)).toThrow('visibility');
  });
});
