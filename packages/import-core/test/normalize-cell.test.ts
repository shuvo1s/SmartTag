import { createDataField } from '@smarttag/document-utils';
import { describe, expect, it } from 'vitest';
import {
  BOOLEAN_PRESETS,
  DEFAULT_PARSING_RULES,
  normalizeSourceCell,
  type ParsingRules,
  type SourceCell,
} from '../src';

const context = { column: { index: 4, letter: 'E', header: 'RETAIL' }, maxCellChars: 100 };
const decimal = createDataField({ key: 'price', displayName: 'Price', type: 'decimal' });
const number = createDataField({ key: 'quantity', displayName: 'Quantity', type: 'number' });
const date = createDataField({ key: 'ship_date', displayName: 'Ship date', type: 'date' });
const flag = createDataField({
  key: 'is_sustainable',
  displayName: 'Sustainable',
  type: 'boolean',
});
const string = createDataField({ key: 'gtin', displayName: 'GTIN', type: 'string' });
const image = createDataField({
  key: 'product_image',
  displayName: 'Product Image',
  type: 'image',
});

const run = (
  field: typeof decimal,
  cell: SourceCell,
  rules: ParsingRules = DEFAULT_PARSING_RULES,
) => normalizeSourceCell(field, cell, rules, context);
const textCell = (text: string): SourceCell => ({ kind: 'TEXT', text });

describe('text cells', () => {
  it('parses numbers with the configured separators into plain decimal text', () => {
    const comma = {
      ...DEFAULT_PARSING_RULES,
      number: { decimalSeparator: ',', thousandsSeparator: '.' },
    } as const;
    expect(run(decimal, textCell('1.234,95'), comma)).toMatchObject({
      kind: 'VALUE',
      value: '1234.95',
    });
    expect(run(number, textCell('12'), comma)).toMatchObject({ kind: 'VALUE', value: '12' });
  });

  it('explains a decimal comma read with the default decimal point', () => {
    const result = run(decimal, textCell('19,99'));
    expect(result).toMatchObject({
      kind: 'REJECTED',
      issue: {
        layer: 'IMPORT',
        code: 'DECIMAL_PARSE_FAILED',
        severity: 'ERROR',
        field: 'price',
        column: { index: 4, letter: 'E', header: 'RETAIL' },
      },
    });
    if (result.kind === 'REJECTED') {
      expect(result.issue.message).toBe(
        'Price: cannot parse "19,99" using decimal separator "." and no thousands separator: it contains characters other than digits and the decimal separator',
      );
    }
    expect(run(number, textCell('abc'))).toMatchObject({ issue: { code: 'NUMBER_PARSE_FAILED' } });
  });

  it('reads dates with the configured format only', () => {
    expect(
      run(date, textCell('15/09/2026'), { ...DEFAULT_PARSING_RULES, dateFormat: 'DD/MM/YYYY' }),
    ).toMatchObject({
      kind: 'VALUE',
      value: '2026-09-15',
    });
    expect(run(date, textCell('03/04/2026'))).toMatchObject({
      kind: 'REJECTED',
      issue: { code: 'DATE_PARSE_FAILED' },
    });
  });

  it('reads booleans from configured tokens only', () => {
    const yesNo = { ...DEFAULT_PARSING_RULES, boolean: BOOLEAN_PRESETS.YES_NO };
    expect(run(flag, textCell('YES'), yesNo)).toMatchObject({ kind: 'VALUE', value: true });
    expect(run(flag, textCell('true'), yesNo)).toMatchObject({
      kind: 'REJECTED',
      issue: { code: 'BOOLEAN_PARSE_FAILED' },
    });
  });

  it('trims, and treats blank and configured empty values as no value', () => {
    expect(run(string, textCell('  950  '))).toMatchObject({ kind: 'VALUE', value: '950' });
    expect(
      run(string, textCell('  950  '), { ...DEFAULT_PARSING_RULES, trimWhitespace: false }),
    ).toMatchObject({
      kind: 'VALUE',
      value: '  950  ',
    });
    expect(run(string, textCell('   '))).toMatchObject({ kind: 'EMPTY' });
    expect(
      run(decimal, textCell('n/a'), { ...DEFAULT_PARSING_RULES, emptyValues: ['N/A'] }),
    ).toMatchObject({ kind: 'EMPTY' });
    expect(run(string, { kind: 'EMPTY' })).toMatchObject({ kind: 'EMPTY', warnings: [] });
  });

  it('refuses cells longer than the limit', () => {
    expect(run(string, textCell('x'.repeat(101)))).toMatchObject({
      kind: 'REJECTED',
      issue: { code: 'CELL_TOO_LONG' },
    });
  });

  it('image cells accept asset ids but never links or file paths', () => {
    const id = '0192b8a0-0000-7000-8000-000000000001';
    expect(run(image, textCell(` ${id} `))).toMatchObject({ kind: 'VALUE', value: id });
    for (const reference of [
      'https://cdn.example.com/shirt.png',
      'http://169.254.169.254/latest/meta-data',
      'file:///etc/passwd',
      '\\\\fileserver\\images\\shirt.png',
      'C:\\images\\shirt.png',
      '/var/images/shirt.png',
      '../shirt.png',
      'shirt.jpg',
      'data:image/png;base64,AAAA',
    ]) {
      expect(run(image, textCell(reference))).toMatchObject({
        kind: 'REJECTED',
        issue: { code: 'IMAGE_REFERENCE_NOT_SUPPORTED' },
      });
    }
  });

  it('formula-looking CSV text is only text', () => {
    expect(run(string, textCell('=HYPERLINK("http://evil")'))).toMatchObject({
      kind: 'VALUE',
      value: '=HYPERLINK("http://evil")',
    });
  });
});

describe('typed spreadsheet cells', () => {
  it('numbers', () => {
    expect(run(decimal, { kind: 'NUMBER', value: 39.95 })).toMatchObject({
      kind: 'VALUE',
      value: '39.95',
    });
    expect(run(decimal, { kind: 'NUMBER', value: 0.1 + 0.2 })).toMatchObject({
      kind: 'VALUE',
      value: '0.3',
    });
    expect(run(number, { kind: 'NUMBER', value: 7 })).toMatchObject({ kind: 'VALUE', value: 7 });
    expect(run(string, { kind: 'NUMBER', value: 9501234567891 })).toMatchObject({
      kind: 'VALUE',
      value: '9501234567891',
    });
    expect(run(string, { kind: 'NUMBER', value: 12345, zeroPad: 8 })).toMatchObject({
      kind: 'VALUE',
      value: '00012345',
    });
    expect(run(date, { kind: 'NUMBER', value: 46280 })).toMatchObject({
      kind: 'REJECTED',
      issue: { code: 'DATE_PARSE_FAILED' },
    });
    expect(
      run(
        flag,
        { kind: 'NUMBER', value: 1 },
        { ...DEFAULT_PARSING_RULES, boolean: BOOLEAN_PRESETS.ONE_ZERO },
      ),
    ).toMatchObject({
      kind: 'VALUE',
      value: true,
    });
  });

  it('dates, ignoring a time of day with a warning', () => {
    expect(run(date, { kind: 'DATE', date: '2026-09-15', time: null })).toMatchObject({
      kind: 'VALUE',
      value: '2026-09-15',
      warnings: [],
    });
    const timed = run(date, { kind: 'DATE', date: '2026-09-15', time: '13:45:00' });
    expect(timed).toMatchObject({
      kind: 'VALUE',
      value: '2026-09-15',
      warnings: [{ code: 'DATE_TIME_IGNORED', severity: 'WARNING' }],
    });
    expect(run(string, { kind: 'DATE', date: '2026-09-15', time: '13:45:00' })).toMatchObject({
      value: '2026-09-15T13:45:00',
    });
    expect(run(decimal, { kind: 'DATE', date: '2026-09-15', time: null })).toMatchObject({
      kind: 'REJECTED',
    });
  });

  it('booleans and spreadsheet errors', () => {
    expect(run(flag, { kind: 'BOOLEAN', value: false })).toMatchObject({
      kind: 'VALUE',
      value: false,
    });
    expect(run(string, { kind: 'BOOLEAN', value: true })).toMatchObject({
      kind: 'VALUE',
      value: 'TRUE',
    });
    expect(run(string, { kind: 'ERROR', code: '#N/A' })).toMatchObject({
      kind: 'REJECTED',
      issue: {
        code: 'SOURCE_VALUE_INVALID',
        message: 'GTIN: the cell contains the spreadsheet error #N/A',
      },
    });
  });

  it('formulas are never calculated: cached results import with a warning, missing results fail', () => {
    const cached = run(decimal, { kind: 'NUMBER', value: 42.5, formula: true });
    expect(cached).toMatchObject({
      kind: 'VALUE',
      value: '42.5',
      warnings: [{ code: 'FORMULA_CACHED_VALUE', severity: 'WARNING', field: 'price' }],
    });
    expect(run(decimal, { kind: 'EMPTY', formula: true })).toMatchObject({
      kind: 'REJECTED',
      issue: { code: 'FORMULA_VALUE_UNAVAILABLE', severity: 'ERROR' },
    });
  });
});
