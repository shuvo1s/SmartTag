import type { DataSchema } from '@smarttag/document-schema';
import { canonicalizeJson, createDataField } from '@smarttag/document-utils';
import { VARIABLE_DATA_FIELDS, VARIABLE_DATA_RECORD } from '@smarttag/document-utils/fixtures';
import { describe, expect, it } from 'vitest';
import { DATA_LIMITS, createSampleRecord, validateDataRecord } from '../src';

const schema: DataSchema = { fields: [...VARIABLE_DATA_FIELDS] };

function codesFor(input: unknown, field?: string) {
  return validateDataRecord(schema, input)
    .issues.filter((issue) => field === undefined || issue.field === field)
    .map((issue) => issue.code);
}

describe('validateDataRecord — the specification record', () => {
  it('accepts the example record and keeps values typed', () => {
    const result = validateDataRecord(schema, VARIABLE_DATA_RECORD);
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.normalizedRecord).toEqual({
      color: 'Navy',
      country_of_origin: 'Bangladesh',
      currency: 'USD',
      gtin: '9501234567891',
      is_sustainable: true,
      price: '39.95',
      product_image: null,
      product_name: 'Premium Cotton Shirt',
      product_url: 'https://example.com/products/YT-2045',
      size: 'XL',
      style: 'YT-2045',
    });
    // Decimal values are exact decimal text; booleans stay booleans.
    expect(typeof result.normalizedRecord.price).toBe('string');
    expect(result.normalizedRecord.is_sustainable).toBe(true);
    expect(Object.keys(result.normalizedRecord)).toEqual(
      [...VARIABLE_DATA_FIELDS.map((field) => field.key)].sort(),
    );
  });

  it('keeps number fields numeric', () => {
    const numbers: DataSchema = {
      fields: [createDataField({ key: 'quantity', type: 'number', required: true })],
    };
    expect(validateDataRecord(numbers, { quantity: 39.95 }).normalizedRecord.quantity).toBe(39.95);
    expect(validateDataRecord(numbers, { quantity: ' 12 ' }).normalizedRecord.quantity).toBe(12);
    expect(validateDataRecord(numbers, { quantity: '-0' }).normalizedRecord.quantity).toBe(0);
  });
});

describe('required values: missing, null, empty and invalid type are distinguished', () => {
  it.each([
    [{ ...VARIABLE_DATA_RECORD, gtin: undefined }, 'REQUIRED_VALUE_MISSING'],
    [{ ...VARIABLE_DATA_RECORD, gtin: null }, 'REQUIRED_VALUE_NULL'],
    [{ ...VARIABLE_DATA_RECORD, gtin: '   ' }, 'REQUIRED_VALUE_EMPTY'],
    [{ ...VARIABLE_DATA_RECORD, gtin: true }, 'INVALID_TYPE'],
    [{ ...VARIABLE_DATA_RECORD, gtin: { value: 1 } }, 'INVALID_TYPE'],
    [{ ...VARIABLE_DATA_RECORD, gtin: ['9501234567891'] }, 'INVALID_TYPE'],
  ])('%j → %s', (record, code) => {
    const result = validateDataRecord(schema, record);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ layer: 'DATA', code, severity: 'ERROR', field: 'gtin' }),
    ]);
    expect(result.normalizedRecord.gtin).toBeNull();
  });

  it('removing a key and sending null are both absent in the normalized record', () => {
    const { gtin: _removed, ...withoutGtin } = VARIABLE_DATA_RECORD;
    expect(validateDataRecord(schema, withoutGtin).normalizedRecord).toEqual(
      validateDataRecord(schema, { ...VARIABLE_DATA_RECORD, gtin: null }).normalizedRecord,
    );
  });
});

describe('types and formats', () => {
  it.each([
    ['price', '19,99', 'INVALID_VALUE'],
    ['price', 'abc', 'INVALID_VALUE'],
    ['price', true, 'INVALID_TYPE'],
    ['price', '1e3', 'INVALID_VALUE'],
    ['product_url', 'javascript:alert(1)', 'INVALID_VALUE'],
    ['product_url', 'ftp://example.com/a', 'INVALID_VALUE'],
    ['product_url', 'https://user:secret@example.com/', 'INVALID_VALUE'],
    ['product_url', 'https://exa mple.com', 'INVALID_VALUE'],
    ['is_sustainable', 'maybe', 'INVALID_VALUE'],
    ['is_sustainable', 2, 'INVALID_VALUE'],
    ['product_image', 'logo.png', 'INVALID_VALUE'],
    ['product_image', 42, 'INVALID_TYPE'],
    ['product_name', `bad${String.fromCharCode(0)}text`, 'INVALID_VALUE'],
    ['product_name', 'lone \uD800 surrogate', 'INVALID_VALUE'],
  ])('%s ← %j is %s', (field, value, code) => {
    expect(codesFor({ ...VARIABLE_DATA_RECORD, [field]: value }, field)).toEqual([code]);
  });

  it('accepts the canonical text forms of forms, spreadsheets and ERP payloads', () => {
    const result = validateDataRecord(schema, {
      ...VARIABLE_DATA_RECORD,
      price: ' 0039.90 ',
      is_sustainable: 'Yes',
      product_image: '0192F0A0-5B1E-7C3D-9A4F-6B7C8D9E0F10',
    });
    expect(result.issues).toEqual([]);
    expect(result.normalizedRecord).toMatchObject({
      price: '39.90',
      is_sustainable: true,
      product_image: '0192f0a0-5b1e-7c3d-9a4f-6b7c8d9e0f10',
    });
  });

  it('dates must be real ISO calendar dates', () => {
    const dates: DataSchema = { fields: [createDataField({ key: 'launch', type: 'date' })] };
    expect(validateDataRecord(dates, { launch: '2026-02-28' }).valid).toBe(true);
    expect(validateDataRecord(dates, { launch: '2026-02-30' }).issues[0]?.code).toBe(
      'INVALID_VALUE',
    );
    expect(validateDataRecord(dates, { launch: '28/02/2026' }).issues[0]?.code).toBe(
      'INVALID_VALUE',
    );
    expect(validateDataRecord(dates, { launch: 20260228 }).issues[0]?.code).toBe('INVALID_TYPE');
  });
});

describe('validation rules', () => {
  it.each([
    ['size', 'XXXL', 'VALUE_NOT_ALLOWED'],
    ['style', 'yt2045', 'PATTERN_MISMATCH'],
    ['gtin', '950123456789', 'PATTERN_MISMATCH'],
    ['price', '0', 'VALUE_BELOW_MINIMUM'],
    ['price', 10_000, 'VALUE_ABOVE_MAXIMUM'],
    ['product_name', 'x'.repeat(61), 'VALUE_TOO_LONG'],
    ['currency', 'JPY', 'VALUE_NOT_ALLOWED'],
  ])('%s ← %j is %s', (field, value, code) => {
    const result = validateDataRecord(schema, { ...VARIABLE_DATA_RECORD, [field]: value });
    expect(result.issues.map((issue) => [issue.field, issue.code])).toEqual([[field, code]]);
    expect(result.invalidFields.has(field)).toBe(true);
    expect(result.normalizedRecord[field]).toBeNull();
  });
});

describe('defaults', () => {
  it('uses field defaults when the record has no value', () => {
    const result = validateDataRecord(schema, {
      ...VARIABLE_DATA_RECORD,
      currency: '',
      country_of_origin: undefined,
      is_sustainable: null,
    });
    expect(result.valid).toBe(true);
    expect(result.normalizedRecord).toMatchObject({
      currency: 'USD',
      country_of_origin: 'Bangladesh',
      is_sustainable: false,
    });
    expect(result.fields.find((field) => field.key === 'currency')).toEqual({
      key: 'currency',
      source: 'DEFAULT',
      empty: 'EMPTY',
      invalid: false,
    });
  });

  it('never substitutes a default for an invalid value', () => {
    const result = validateDataRecord(schema, { ...VARIABLE_DATA_RECORD, currency: 'JPY' });
    expect(result.normalizedRecord.currency).toBeNull();
    expect(result.valid).toBe(false);
  });

  it('a required field with a default accepts records without the value', () => {
    const required: DataSchema = {
      fields: [
        createDataField({ key: 'unit', type: 'string', required: true, defaultValue: 'pcs' }),
      ],
    };
    expect(validateDataRecord(required, {})).toMatchObject({
      valid: true,
      normalizedRecord: { unit: 'pcs' },
    });
  });
});

describe('values rejected before record validation (imports)', () => {
  it('are invalid: null, never replaced by the default, never reported as missing', () => {
    const result = validateDataRecord(
      schema,
      { ...VARIABLE_DATA_RECORD, price: undefined, currency: undefined },
      { rejectedFields: new Set(['price', 'currency']) },
    );
    expect(result.valid).toBe(false);
    // The caller (the importer) reports why; record validation adds nothing for these fields.
    expect(result.issues).toEqual([]);
    expect(result.normalizedRecord.price).toBeNull();
    // currency has a default ("USD") that must not hide the rejected source value.
    expect(result.normalizedRecord.currency).toBeNull();
    expect([...result.invalidFields].sort()).toEqual(['currency', 'price']);
    expect(result.fields.find((field) => field.key === 'price')).toEqual({
      key: 'price',
      source: 'RECORD',
      empty: null,
      invalid: true,
    });
  });

  it('without rejected fields the result is unchanged', () => {
    expect(validateDataRecord(schema, VARIABLE_DATA_RECORD, { rejectedFields: new Set() })).toEqual(
      validateDataRecord(schema, VARIABLE_DATA_RECORD),
    );
  });
});

describe('unknown keys, reserved keys and prototype pollution', () => {
  it('warns about unknown keys and ignores them', () => {
    const result = validateDataRecord(schema, { ...VARIABLE_DATA_RECORD, colour: 'Navy' });
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_FIELD', severity: 'WARNING' }),
    ]);
    expect(Object.hasOwn(result.normalizedRecord, 'colour')).toBe(false);
  });

  it.each(['__proto__', 'constructor', 'prototype', '__record_index', '__serial'])(
    'refuses the key %s without touching object prototypes',
    (key) => {
      const payload = JSON.parse(
        `{"product_name":"Shirt","${key}":{"polluted":"yes","toString":"x"}}`,
      ) as unknown;
      const result = validateDataRecord(schema, payload);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'FORBIDDEN_FIELD_KEY', severity: 'ERROR' }),
      );
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.getPrototypeOf(result.normalizedRecord)).toBeNull();
      expect(Object.hasOwn(result.normalizedRecord, key)).toBe(false);
    },
  );

  it('does not read inherited properties as field values', () => {
    const inherited = Object.create({ product_name: 'from prototype' }) as object;
    const result = validateDataRecord(schema, inherited);
    expect(codesFor(inherited)).toContain('INVALID_RECORD');
    expect(result.normalizedRecord.product_name).toBeNull();
    const ownOnly = Object.assign(Object.create(null) as object, { color: 'Navy' });
    expect(validateDataRecord(schema, ownOnly).normalizedRecord.color).toBe('Navy');
  });

  it('treats markup and script-like text as inert data', () => {
    const result = validateDataRecord(schema, {
      ...VARIABLE_DATA_RECORD,
      product_name: '<img src=x onerror=alert(1)>',
    });
    expect(result.valid).toBe(true);
    expect(result.normalizedRecord.product_name).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('limits', () => {
  it('refuses non-object records', () => {
    for (const input of [null, [], 'text', 42, new Date()]) {
      expect(validateDataRecord(schema, input).issues).toContainEqual(
        expect.objectContaining({ code: 'INVALID_RECORD' }),
      );
    }
  });

  it('refuses records with too many keys', () => {
    const record = Object.fromEntries(
      Array.from({ length: DATA_LIMITS.maxRecordKeys + 1 }, (_, index) => [`k${index}`, 'x']),
    );
    expect(codesFor(record)).toContain('PAYLOAD_LIMIT_EXCEEDED');
  });

  it('refuses text values longer than the limit', () => {
    expect(
      codesFor(
        { ...VARIABLE_DATA_RECORD, color: 'x'.repeat(DATA_LIMITS.maxStringValueLength + 1) },
        'color',
      ),
    ).toEqual(['PAYLOAD_LIMIT_EXCEEDED']);
  });
});

describe('normalization is deterministic', () => {
  it('equal logical records give identical canonical JSON regardless of order and form', () => {
    const a = validateDataRecord(schema, VARIABLE_DATA_RECORD).normalizedRecord;
    const reordered = Object.fromEntries(Object.entries(VARIABLE_DATA_RECORD).reverse());
    const b = validateDataRecord(schema, {
      ...reordered,
      price: '39.95',
      is_sustainable: 'true',
      currency: undefined,
      product_image: '',
    }).normalizedRecord;
    expect(canonicalizeJson(b)).toBe(canonicalizeJson(a));
  });

  it('a sample record is a useful starting point', () => {
    const sample = createSampleRecord(schema);
    expect(sample).toMatchObject({
      size: 'XS',
      currency: 'USD',
      price: '0.01',
      is_sustainable: false,
    });
    const result = validateDataRecord(schema, sample);
    // Patterned fields (style, gtin) are left for the user to fill in.
    expect(result.issues.map((issue) => issue.field).sort()).toEqual(['gtin', 'style']);
  });
});
