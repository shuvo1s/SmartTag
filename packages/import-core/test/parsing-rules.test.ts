import { describe, expect, it } from 'vitest';
import {
  BOOLEAN_PRESETS,
  BooleanFormatSchema,
  NumberFormatSchema,
  datesFittingFormats,
  parseBooleanText,
  parseDateText,
  parseNumberText,
  spreadsheetSerialToDate,
  type NumberFormat,
} from '../src';

const DOT: NumberFormat = { decimalSeparator: '.', thousandsSeparator: 'NONE' };
const DOT_COMMA: NumberFormat = { decimalSeparator: '.', thousandsSeparator: ',' };
const COMMA: NumberFormat = { decimalSeparator: ',', thousandsSeparator: 'NONE' };
const COMMA_DOT: NumberFormat = { decimalSeparator: ',', thousandsSeparator: '.' };
const COMMA_SPACE: NumberFormat = { decimalSeparator: ',', thousandsSeparator: 'SPACE' };

describe('parseNumberText — explicit separators, never the locale', () => {
  it.each([
    ['39.95', DOT, '39.95'],
    ['39,95', COMMA, '39.95'],
    ['1,234.95', DOT_COMMA, '1234.95'],
    ['1.234,95', COMMA_DOT, '1234.95'],
    ['1 234,95', COMMA_SPACE, '1234.95'],
    ['1\u00A0234,95', COMMA_SPACE, '1234.95'],
    ['1\u202F234\u202F567,5', COMMA_SPACE, '1234567.5'],
    ["1'234.50", { decimalSeparator: '.', thousandsSeparator: 'APOSTROPHE' }, '1234.50'],
    ['-12.500', DOT, '-12.500'],
    ['+7', DOT, '7'],
    ['  42  ', DOT, '42'],
    ['1234.95', DOT_COMMA, '1234.95'],
    ['0039.90', DOT, '0039.90'],
  ])('%j with %j → %s (scale kept)', (text, format, expected) => {
    expect(parseNumberText(text, format)).toEqual({ ok: true, text: expected });
  });

  it('"1,234" means 1234 or 1.234 only because the configuration says so', () => {
    expect(parseNumberText('1,234', DOT_COMMA)).toEqual({ ok: true, text: '1234' });
    expect(parseNumberText('1,234', COMMA)).toEqual({ ok: true, text: '1.234' });
    expect(parseNumberText('1,234', DOT).ok).toBe(false);
  });

  it.each([
    ['19,99', DOT, /other than digits/],
    ['12.34', COMMA_DOT, /grouped in threes/],
    ['1,23,456.00', DOT_COMMA, /grouped in threes/],
    ['9.50123E+12', DOT, /scientific notation/],
    ['1e3', DOT, /scientific notation/],
    ['$39.95', DOT, /other than digits/],
    ['39.95%', DOT, /decimal separator/],
    ['(39.95)', DOT, /not valid/],
    ['1.2.3', DOT, /other than digits/],
    ['', DOT, /empty/],
    ['39.', DOT, /after the decimal separator/],
  ])('refuses %j with %j', (text, format, reason) => {
    const result = parseNumberText(text, format);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });

  it('refuses identical decimal and thousands separators', () => {
    expect(
      NumberFormatSchema.safeParse({ decimalSeparator: ',', thousandsSeparator: ',' }).success,
    ).toBe(false);
  });
});

describe('parseDateText — exactly the configured format', () => {
  it.each([
    ['2026-09-15', 'YYYY-MM-DD', '2026-09-15'],
    ['2026/9/5', 'YYYY/MM/DD', '2026-09-05'],
    ['15/09/2026', 'DD/MM/YYYY', '2026-09-15'],
    ['09/15/2026', 'MM/DD/YYYY', '2026-09-15'],
    ['15-09-2026', 'DD-MM-YYYY', '2026-09-15'],
    ['09-15-2026', 'MM-DD-YYYY', '2026-09-15'],
    ['5.9.2026', 'DD.MM.YYYY', '2026-09-05'],
  ] as const)('%s as %s → %s', (text, format, iso) => {
    expect(parseDateText(text, format)).toEqual({ ok: true, date: iso });
  });

  it('never reinterprets 03/04/2026: its meaning comes only from the format', () => {
    expect(parseDateText('03/04/2026', 'DD/MM/YYYY')).toEqual({ ok: true, date: '2026-04-03' });
    expect(parseDateText('03/04/2026', 'MM/DD/YYYY')).toEqual({ ok: true, date: '2026-03-04' });
    const iso = parseDateText('03/04/2026', 'YYYY-MM-DD');
    expect(iso.ok).toBe(false);
    if (!iso.ok) expect(iso.reason).toMatch(/choose the date format/);
    expect(datesFittingFormats(['03/04/2026'])).toEqual(['DD/MM/YYYY', 'MM/DD/YYYY']);
    expect(datesFittingFormats(['03/04/2026', '25/04/2026'])).toEqual(['DD/MM/YYYY']);
  });

  it.each([
    ['2026-02-30', 'YYYY-MM-DD'],
    ['31/04/2026', 'DD/MM/YYYY'],
    ['13/01/2026', 'MM/DD/YYYY'],
    ['15/09/26', 'DD/MM/YYYY'],
    ['2026-09-15T10:00:00', 'YYYY-MM-DD'],
    ['next monday', 'YYYY-MM-DD'],
  ] as const)('refuses %s as %s', (text, format) => {
    expect(parseDateText(text, format).ok).toBe(false);
  });
});

describe('spreadsheet date serials', () => {
  it.each([
    [1, '1900-01-01'],
    [59, '1900-02-28'],
    [61, '1900-03-01'],
    [45000, '2023-03-15'],
    [46280, '2026-09-15'],
  ])('1900 system: %d → %s', (serial, date) => {
    expect(spreadsheetSerialToDate(serial, false)).toEqual({ date, time: null });
  });

  it('refuses serial 0 and the fictitious 1900-02-29 (serial 60)', () => {
    expect(spreadsheetSerialToDate(0, false)).toBeNull();
    expect(spreadsheetSerialToDate(60, false)).toBeNull();
    expect(spreadsheetSerialToDate(-1, false)).toBeNull();
    expect(spreadsheetSerialToDate(Number.NaN, false)).toBeNull();
  });

  it('1904 system counts from 1904-01-01', () => {
    expect(spreadsheetSerialToDate(0, true)).toEqual({ date: '1904-01-01', time: null });
    expect(spreadsheetSerialToDate(44818, true)).toEqual({ date: '2026-09-15', time: null });
  });

  it('keeps the time of day, rounded to the second', () => {
    expect(spreadsheetSerialToDate(46280.5, false)).toEqual({
      date: '2026-09-15',
      time: '12:00:00',
    });
    expect(spreadsheetSerialToDate(46280.999999999, false)).toEqual({
      date: '2026-09-16',
      time: null,
    });
  });
});

describe('parseBooleanText — configured tokens only', () => {
  it('matches case-insensitively and trims', () => {
    expect(parseBooleanText(' TRUE ', BOOLEAN_PRESETS.TRUE_FALSE)).toEqual({
      ok: true,
      value: true,
    });
    expect(parseBooleanText('False', BOOLEAN_PRESETS.TRUE_FALSE)).toEqual({
      ok: true,
      value: false,
    });
    expect(parseBooleanText('Y', BOOLEAN_PRESETS.Y_N)).toEqual({ ok: true, value: true });
    expect(parseBooleanText('0', BOOLEAN_PRESETS.ONE_ZERO)).toEqual({ ok: true, value: false });
    expect(parseBooleanText('yes', BOOLEAN_PRESETS.YES_NO)).toEqual({ ok: true, value: true });
  });

  it('never converts arbitrary words', () => {
    for (const text of ['yes', 'maybe', 'on', '1', 'ok', '']) {
      expect(parseBooleanText(text, BOOLEAN_PRESETS.TRUE_FALSE).ok).toBe(false);
    }
  });

  it('refuses a token that means both true and false', () => {
    expect(BooleanFormatSchema.safeParse({ trueValues: ['Y'], falseValues: ['y'] }).success).toBe(
      false,
    );
    expect(
      BooleanFormatSchema.safeParse({ trueValues: ['ja'], falseValues: ['nein'] }).success,
    ).toBe(true);
  });
});
