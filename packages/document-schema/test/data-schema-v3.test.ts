import { describe, expect, it } from 'vitest';
import {
  checkFieldDefinition,
  checkFieldRules,
  checkPropertyBinding,
  emptyValidationFor,
  fieldLookup,
  isReservedFieldKey,
  validateDesignDocument,
  type DataField,
  type DocumentIssueCode,
} from '../src';
import { imageObject, minimalDocument, objectsOf, textObject } from './fixtures';

type Mutable = Record<string, unknown>;

function errors(input: unknown) {
  return validateDesignDocument(input).errors;
}

function codes(input: unknown): DocumentIssueCode[] {
  return errors(input).map((issue) => issue.code);
}

function fieldsOf(document: Mutable): Mutable[] {
  return (document.dataSchema as { fields: Mutable[] }).fields;
}

function withTextBindings(bindings: Mutable): Mutable {
  const document = minimalDocument();
  objectsOf(document)[0] = textObject({ bindings });
  return document;
}

const STATIC = { mode: 'STATIC' };

describe('EXPRESSION bindings in canonical validation', () => {
  it('accepts a valid text expression and a visibility condition', () => {
    const document = withTextBindings({
      content: { mode: 'EXPRESSION', expression: 'concat("NAME: ", upper(product_name))' },
      visible: { mode: 'EXPRESSION', expression: 'show_badge == true && gtin != ""' },
    });
    expect(validateDesignDocument(document)).toMatchObject({ valid: true, errors: [] });
  });

  it('accepts an image expression and rejects a text expression for an image', () => {
    const document = minimalDocument();
    objectsOf(document).push(
      imageObject({
        bindings: {
          assetId: { mode: 'EXPRESSION', expression: 'fallback(logo, logo)' },
          visible: STATIC,
        },
      }),
    );
    expect(codes(document)).toEqual([]);

    const wrong = minimalDocument();
    objectsOf(wrong).push(
      imageObject({
        bindings: { assetId: { mode: 'EXPRESSION', expression: 'upper(gtin)' }, visible: STATIC },
      }),
    );
    expect(errors(wrong)).toEqual([
      expect.objectContaining({
        code: 'INCOMPATIBLE_BINDING',
        path: ['pages', 0, 'objects', 2, 'bindings', 'assetId', 'expression'],
      }),
    ]);
  });

  it.each([
    ['concat(product_nam)', 'UNKNOWN_FIELD'],
    ['concat("a"', 'EXPRESSION_PARSE_ERROR'],
    ['process.env', 'EXPRESSION_PARSE_ERROR'],
    ['capitalize(product_name)', 'UNKNOWN_FUNCTION'],
    ['upper(product_name, gtin)', 'WRONG_ARGUMENT_COUNT'],
    ['if(product_name, "a", "b")', 'TYPE_MISMATCH'],
    [`"${'x'.repeat(1_990)}" == "y"`, 'EXPRESSION_LIMIT_EXCEEDED'],
  ] as const)('%s → %s with a precise path', (expression, code) => {
    const issues = errors(
      withTextBindings({ content: { mode: 'EXPRESSION', expression }, visible: STATIC }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code,
      path: ['pages', 0, 'objects', 0, 'bindings', 'content', 'expression'],
    });
    expect(issues[0]?.message).toMatch(/^Product name: .+\(character \d+\)$/);
  });

  it('a visibility expression must produce true/false', () => {
    expect(
      codes(
        withTextBindings({ content: STATIC, visible: { mode: 'EXPRESSION', expression: 'gtin' } }),
      ),
    ).toEqual(['INCOMPATIBLE_BINDING']);
  });

  it('rejects an empty expression structurally', () => {
    expect(
      codes(withTextBindings({ content: { mode: 'EXPRESSION', expression: '' }, visible: STATIC })),
    ).toEqual(['INVALID_STRUCTURE']);
  });

  it('reports unknown binding modes precisely, without structural noise', () => {
    const issues = errors(
      withTextBindings({
        content: { mode: 'TEMPLATE', template: '{{product_name}}' },
        visible: STATIC,
      }),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'UNKNOWN_BINDING_MODE',
        path: ['pages', 0, 'objects', 0, 'bindings', 'content', 'mode'],
      }),
    ]);
  });

  it('refuses bindings on properties that cannot be data-driven (geometry, fonts)', () => {
    const issues = errors(
      withTextBindings({
        content: STATIC,
        visible: STATIC,
        x: { mode: 'FIELD', field: 'product_name' },
        fontSize: { mode: 'EXPRESSION', expression: '12' },
      }),
    );
    expect(issues.map((issue) => [issue.code, issue.path.at(-1)])).toEqual([
      ['INVALID_PROPERTY_BINDING', 'x'],
      ['INVALID_PROPERTY_BINDING', 'fontSize'],
    ]);
  });
});

describe('data field definitions', () => {
  it('requires validation rules on every field (schema v3)', () => {
    const document = minimalDocument();
    delete fieldsOf(document)[0]!.validation;
    expect(codes(document)).toEqual(['INVALID_STRUCTURE']);
  });

  it('accepts rules and a default that satisfies them', () => {
    const document = minimalDocument();
    fieldsOf(document).push(
      {
        key: 'size',
        displayName: 'Size',
        type: 'string',
        required: false,
        defaultValue: 'M',
        description: '',
        validation: {
          minLength: 1,
          maxLength: 4,
          pattern: '[A-Z0-9/]+',
          allowedValues: ['S', 'M', 'L', 'XL'],
        },
      },
      {
        key: 'price',
        displayName: 'Price',
        type: 'decimal',
        required: true,
        defaultValue: null,
        description: '',
        validation: { min: '0.01', max: '9999.99', allowedValues: null },
      },
      {
        key: 'quantity',
        displayName: 'Quantity',
        type: 'number',
        required: false,
        defaultValue: 1,
        description: '',
        validation: { min: 1, max: 1000, allowedValues: null },
      },
    );
    expect(validateDesignDocument(document)).toMatchObject({ valid: true });
  });

  it.each([
    ['constructor', 'INVALID_FIELD_KEY'],
    ['prototype', 'INVALID_FIELD_KEY'],
    ['__proto__', 'INVALID_STRUCTURE'],
    ['__serial', 'INVALID_STRUCTURE'],
    ['Product Name', 'INVALID_STRUCTURE'],
    ['1st', 'INVALID_STRUCTURE'],
  ])('refuses the field key %s', (key, code) => {
    const document = minimalDocument();
    // JSON.parse creates "__proto__" as an own property, exactly like a request body would.
    const field = JSON.parse(JSON.stringify({ ...fieldsOf(document)[0], key })) as Mutable;
    fieldsOf(document)[0] = field;
    expect(codes(document)).toContain(code);
  });

  it('reserves the "__" namespace and dangerous object keys', () => {
    expect(isReservedFieldKey('__record_index')).toBe(true);
    expect(isReservedFieldKey('__proto__')).toBe(true);
    expect(isReservedFieldKey('constructor')).toBe(true);
    expect(isReservedFieldKey('prototype')).toBe(true);
    expect(isReservedFieldKey('product_name')).toBe(false);
  });

  it.each([
    [
      { minLength: 5, maxLength: 2, pattern: null, allowedValues: null },
      'INVALID_FIELD_RULE',
      'minLength',
    ],
    [
      { minLength: null, maxLength: null, pattern: '(a)\\1', allowedValues: null },
      'INVALID_FIELD_RULE',
      'pattern',
    ],
    [
      { minLength: null, maxLength: null, pattern: '(a+)+?', allowedValues: null },
      'INVALID_FIELD_RULE',
      'pattern',
    ],
    [
      { minLength: null, maxLength: null, pattern: null, allowedValues: ['S', 'S'] },
      'INVALID_FIELD_RULE',
      'allowedValues',
    ],
    [
      { minLength: null, maxLength: 1, pattern: null, allowedValues: ['XL'] },
      'INVALID_FIELD_RULE',
      'allowedValues',
    ],
  ])('refuses inconsistent string rules %j', (validation, code, rule) => {
    const document = minimalDocument();
    fieldsOf(document)[0]!.validation = validation;
    expect(errors(document)).toEqual([
      expect.objectContaining({ code, path: ['dataSchema', 'fields', 0, 'validation', rule] }),
    ]);
  });

  it('refuses numeric rules whose minimum exceeds the maximum', () => {
    const document = minimalDocument();
    fieldsOf(document).push({
      key: 'price',
      displayName: 'Price',
      type: 'decimal',
      required: false,
      defaultValue: null,
      description: '',
      validation: { min: '10.00', max: '9.99', allowedValues: null },
    });
    expect(codes(document)).toEqual(['INVALID_FIELD_RULE']);
  });

  it('refuses defaults that are malformed, not real dates or break the rules', () => {
    const malformed = minimalDocument();
    fieldsOf(malformed).push({
      key: 'price',
      displayName: 'Price',
      type: 'decimal',
      required: false,
      defaultValue: '19,99',
      description: '',
      validation: { min: null, max: null, allowedValues: null },
    });
    expect(codes(malformed)).toEqual(['INVALID_STRUCTURE']);

    const date = minimalDocument();
    fieldsOf(date).push({
      key: 'launch',
      displayName: 'Launch',
      type: 'date',
      required: false,
      defaultValue: '2026-02-30',
      description: '',
      validation: {},
    });
    expect(codes(date)).toEqual(['INVALID_FIELD_DEFAULT']);

    const rules = minimalDocument();
    Object.assign(fieldsOf(rules)[0]!, {
      defaultValue: 'A much too long default',
      validation: { minLength: null, maxLength: 5, pattern: null, allowedValues: null },
    });
    expect(errors(rules)).toEqual([
      expect.objectContaining({
        code: 'INVALID_FIELD_DEFAULT',
        path: ['dataSchema', 'fields', 0, 'defaultValue'],
      }),
    ]);
  });

  it('accepts the WARN missing-data policy', () => {
    const document = minimalDocument();
    document.settings = { missingDataPolicy: 'WARN' };
    expect(codes(document)).toEqual([]);
    document.settings = { missingDataPolicy: 'USE_DEFAULT' };
    expect(codes(document)).toEqual(['INVALID_STRUCTURE']);
  });
});

describe('shared rule helpers', () => {
  const size: DataField = {
    key: 'size',
    displayName: 'Size',
    type: 'string',
    required: true,
    defaultValue: null,
    description: '',
    validation: { minLength: 1, maxLength: 3, pattern: '[A-Z]+', allowedValues: ['S', 'M', 'XL'] },
  };
  const price: DataField = {
    key: 'price',
    displayName: 'Price',
    type: 'decimal',
    required: true,
    defaultValue: null,
    description: '',
    validation: { min: '1.00', max: '100', allowedValues: null },
  };

  it('checks values against rules', () => {
    expect(checkFieldRules(size, 'XL')).toEqual([]);
    expect(checkFieldRules(size, 'xxxl').map((v) => v.code)).toEqual([
      'VALUE_TOO_LONG',
      'PATTERN_MISMATCH',
      'VALUE_NOT_ALLOWED',
    ]);
    expect(checkFieldRules(price, '0.99').map((v) => v.code)).toEqual(['VALUE_BELOW_MINIMUM']);
    expect(checkFieldRules(price, '100.00')).toEqual([]);
    expect(checkFieldRules(price, '100.01').map((v) => v.code)).toEqual(['VALUE_ABOVE_MAXIMUM']);
  });

  it('counts length in code points', () => {
    const emoji: DataField = {
      ...size,
      validation: { ...size.validation, pattern: null, allowedValues: null, maxLength: 2 },
    };
    expect(checkFieldRules(emoji, '😀😀')).toEqual([]);
  });

  it('provides empty rule sets per type', () => {
    expect(emptyValidationFor('string')).toEqual({
      minLength: null,
      maxLength: null,
      pattern: null,
      allowedValues: null,
    });
    expect(emptyValidationFor('decimal')).toEqual({ min: null, max: null, allowedValues: null });
    expect(emptyValidationFor('url')).toEqual({});
    expect(checkFieldDefinition(size)).toEqual([]);
  });

  it('checks a single binding exactly like document validation', () => {
    const fields = fieldLookup([size, price]);
    expect(
      checkPropertyBinding('content', 'TEXT', { mode: 'FIELD', field: 'price' }, fields),
    ).toEqual([]);
    expect(
      checkPropertyBinding('visible', 'VISIBILITY', { mode: 'FIELD', field: 'price' }, fields),
    ).toMatchObject([{ code: 'INCOMPATIBLE_BINDING', path: ['field'] }]);
    expect(
      checkPropertyBinding(
        'content',
        'TEXT',
        { mode: 'EXPRESSION', expression: 'concat(sise)' },
        fields,
      ),
    ).toMatchObject([
      { code: 'UNKNOWN_FIELD', path: ['expression'], range: { start: 7, end: 11 } },
    ]);
  });
});
