import { isRealCalendarDate } from '@smarttag/document-schema';
import { z } from 'zod';

/**
 * Ingestion normalization rules: how text from a file is read as numbers, dates and booleans.
 * Nothing here guesses from the browser or server locale — every interpretation is explicit
 * configuration, so the same file and rules always give the same values
 * (docs/import-normalization.md).
 *
 * Business logic (combining style + color + size, formatting prices for print) is NOT an import
 * concern; it belongs in template expressions.
 */

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

export const DECIMAL_SEPARATORS = ['.', ','] as const;
export type DecimalSeparator = (typeof DECIMAL_SEPARATORS)[number];

export const THOUSANDS_SEPARATORS = ['NONE', ',', '.', 'SPACE', 'APOSTROPHE'] as const;
export type ThousandsSeparator = (typeof THOUSANDS_SEPARATORS)[number];

export const NumberFormatSchema = z
  .strictObject({
    decimalSeparator: z.enum(DECIMAL_SEPARATORS),
    thousandsSeparator: z.enum(THOUSANDS_SEPARATORS),
  })
  .refine((format) => format.decimalSeparator !== format.thousandsSeparator, {
    error: 'The decimal and thousands separators must differ',
  });
export type NumberFormat = z.infer<typeof NumberFormatSchema>;

export function describeThousandsSeparator(separator: ThousandsSeparator): string {
  switch (separator) {
    case 'NONE':
      return 'no thousands separator';
    case 'SPACE':
      return 'space as thousands separator';
    case 'APOSTROPHE':
      return 'apostrophe as thousands separator';
    case ',':
    case '.':
      return `thousands separator "${separator}"`;
  }
}

export function describeNumberFormat(format: NumberFormat): string {
  return `decimal separator "${format.decimalSeparator}" and ${describeThousandsSeparator(format.thousandsSeparator)}`;
}

const GROUP_CHARACTERS: Readonly<Record<Exclude<ThousandsSeparator, 'NONE'>, string>> = {
  ',': ',',
  '.': '.',
  // Space, no-break space, narrow no-break space and thin space are all used for grouping.
  SPACE: ' \u00A0\u202F\u2009',
  APOSTROPHE: "'\u2019",
};

export type ParsedNumber =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string };

/**
 * Reads a number written with the given separators and returns plain decimal text with "." as
 * decimal separator ("1.234,95" → "1234.95"); the fraction digits are kept exactly as written.
 * Grouping must be regular (groups of three digits); scientific notation, currency symbols,
 * percentages and parentheses are refused rather than interpreted.
 */
export function parseNumberText(input: string, format: NumberFormat): ParsedNumber {
  const text = input.trim();
  const fail = (reason: string): ParsedNumber => ({ ok: false, reason });
  if (text === '') return fail('the value is empty');
  if (/^[+-]?\d*[.,]?\d+[eE][+-]?\d+$/.test(text)) {
    return fail(
      'scientific notation is not accepted (digits may have been lost when the file was exported)',
    );
  }
  let sign = '';
  let body = text;
  if (body.startsWith('-') || body.startsWith('+')) {
    sign = body.startsWith('-') ? '-' : '';
    body = body.slice(1);
  }
  const decimal = format.decimalSeparator;
  const decimalIndex = body.lastIndexOf(decimal);
  const integerPart = decimalIndex === -1 ? body : body.slice(0, decimalIndex);
  const fractionPart = decimalIndex === -1 ? null : body.slice(decimalIndex + 1);
  if (fractionPart !== null && !/^\d+$/.test(fractionPart)) {
    return fail('the digits after the decimal separator are not valid');
  }
  let digits: string;
  if (/^\d+$/.test(integerPart)) {
    digits = integerPart;
  } else if (format.thousandsSeparator !== 'NONE') {
    const group = `[${escapeClass(GROUP_CHARACTERS[format.thousandsSeparator])}]`;
    if (!new RegExp(`^\\d{1,3}(${group}\\d{3})+$`).test(integerPart)) {
      return fail('the digits are not grouped in threes by the thousands separator');
    }
    digits = integerPart.replace(new RegExp(group, 'g'), '');
  } else {
    return fail('it contains characters other than digits and the decimal separator');
  }
  return { ok: true, text: `${sign}${digits}${fractionPart === null ? '' : `.${fractionPart}`}` };
}

function escapeClass(characters: string): string {
  return characters.replace(/[\\\]^-]/g, (character) => `\\${character}`);
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

export const DATE_FORMATS = [
  'YYYY-MM-DD',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD-MM-YYYY',
  'MM-DD-YYYY',
  'DD.MM.YYYY',
  'YYYY/MM/DD',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const DateFormatSchema = z.enum(DATE_FORMATS);

const DATE_PATTERNS: Readonly<
  Record<DateFormat, { pattern: RegExp; order: 'YMD' | 'DMY' | 'MDY' }>
> = {
  'YYYY-MM-DD': { pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: 'YMD' },
  'YYYY/MM/DD': { pattern: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, order: 'YMD' },
  'DD/MM/YYYY': { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: 'DMY' },
  'MM/DD/YYYY': { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: 'MDY' },
  'DD-MM-YYYY': { pattern: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: 'DMY' },
  'MM-DD-YYYY': { pattern: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: 'MDY' },
  'DD.MM.YYYY': { pattern: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: 'DMY' },
};

export type ParsedDate =
  { readonly ok: true; readonly date: string } | { readonly ok: false; readonly reason: string };

/**
 * Reads a calendar date written in exactly the configured format and returns ISO text
 * ("15/09/2026" with DD/MM/YYYY → "2026-09-15"). Days and months may have one or two digits;
 * years must have four (two-digit years are ambiguous). "03/04/2026" is never reinterpreted: with
 * YYYY-MM-DD it is simply not a date.
 */
export function parseDateText(input: string, format: DateFormat): ParsedDate {
  const text = input.trim();
  const { pattern, order } = DATE_PATTERNS[format];
  const match = pattern.exec(text);
  if (!match) {
    return {
      ok: false,
      reason: /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(text)
        ? `it is not written as ${format}; choose the date format the file uses`
        : `it is not a date in the format ${format}`,
    };
  }
  const [, a, b, c] = match as unknown as [string, string, string, string];
  const [year, month, day] = order === 'YMD' ? [a, b, c] : order === 'DMY' ? [c, b, a] : [c, a, b];
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (!isRealCalendarDate(iso)) {
    return { ok: false, reason: `it is not a real calendar date when read as ${format}` };
  }
  return { ok: true, date: iso };
}

/** Examples for pickers: the same day written in each format. */
export const DATE_FORMAT_EXAMPLES: Readonly<Record<DateFormat, string>> = {
  'YYYY-MM-DD': '2026-09-15',
  'YYYY/MM/DD': '2026/09/15',
  'DD/MM/YYYY': '15/09/2026',
  'MM/DD/YYYY': '09/15/2026',
  'DD-MM-YYYY': '15-09-2026',
  'MM-DD-YYYY': '09-15-2026',
  'DD.MM.YYYY': '15.09.2026',
};

/**
 * Formats that read all given texts as real dates. Used to explain the choice to people (e.g.
 * "03/04/2026 fits DD/MM/YYYY and MM/DD/YYYY"), never to pick a format automatically.
 */
export function datesFittingFormats(texts: readonly string[]): DateFormat[] {
  const values = texts.map((text) => text.trim()).filter((text) => text !== '');
  if (values.length === 0) return [];
  return DATE_FORMATS.filter((format) => values.every((value) => parseDateText(value, format).ok));
}

export interface SpreadsheetDate {
  readonly date: string;
  readonly time: string | null;
}

/**
 * Converts a spreadsheet date serial to an ISO date (and time of day).
 *
 * 1900 date system (Windows Excel default): serial 1 is 1900-01-01. Excel (for Lotus 1-2-3
 * compatibility) treats 1900 as a leap year, so serial 60 is the non-existent 1900-02-29 and is
 * refused; serials from 61 on are counted from 1899-12-30. 1904 date system (older Mac
 * workbooks, `date1904`): serial 0 is 1904-01-01. The fraction is the time of day, rounded to
 * the second.
 */
export function spreadsheetSerialToDate(serial: number, date1904: boolean): SpreadsheetDate | null {
  if (!Number.isFinite(serial) || serial < 0 || serial >= 2_958_466) return null;
  let totalSeconds = Math.round(serial * 86_400);
  let days = Math.floor(totalSeconds / 86_400);
  totalSeconds -= days * 86_400;
  if (!date1904) {
    if (days === 0 || days === 60) return null;
    if (days < 60) days += 1;
  }
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const instant = new Date(epoch + days * 86_400_000);
  const year = instant.getUTCFullYear();
  if (year > 9999) return null;
  const date = `${String(year).padStart(4, '0')}-${String(instant.getUTCMonth() + 1).padStart(2, '0')}-${String(instant.getUTCDate()).padStart(2, '0')}`;
  const time =
    totalSeconds === 0
      ? null
      : `${String(Math.floor(totalSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
  return { date, time };
}

// ---------------------------------------------------------------------------------------------
// Booleans
// ---------------------------------------------------------------------------------------------

const BooleanTokenSchema = z
  .string()
  .trim()
  .min(1, { error: 'Boolean values cannot be empty' })
  .max(32, { error: 'Boolean values are at most 32 characters' });

export const BooleanFormatSchema = z
  .strictObject({
    trueValues: z.array(BooleanTokenSchema).min(1).max(10),
    falseValues: z.array(BooleanTokenSchema).min(1).max(10),
  })
  .refine(
    (format) => {
      const truthy = new Set(format.trueValues.map(normalizeToken));
      return !format.falseValues.some((value) => truthy.has(normalizeToken(value)));
    },
    { error: 'A value cannot mean both true and false' },
  );
export type BooleanFormat = z.infer<typeof BooleanFormatSchema>;

export const BOOLEAN_PRESETS = {
  TRUE_FALSE: { trueValues: ['true'], falseValues: ['false'] },
  YES_NO: { trueValues: ['yes'], falseValues: ['no'] },
  Y_N: { trueValues: ['y'], falseValues: ['n'] },
  ONE_ZERO: { trueValues: ['1'], falseValues: ['0'] },
} as const satisfies Record<string, BooleanFormat>;
export type BooleanPreset = keyof typeof BOOLEAN_PRESETS;

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

export type ParsedBoolean =
  { readonly ok: true; readonly value: boolean } | { readonly ok: false; readonly reason: string };

/** Case-insensitive match against the configured tokens only; any other text is refused. */
export function parseBooleanText(input: string, format: BooleanFormat): ParsedBoolean {
  const token = normalizeToken(input);
  if (format.trueValues.some((value) => normalizeToken(value) === token))
    return { ok: true, value: true };
  if (format.falseValues.some((value) => normalizeToken(value) === token))
    return { ok: true, value: false };
  return {
    ok: false,
    reason: `it is not one of the configured values (${[...format.trueValues, ...format.falseValues].map((value) => `"${value}"`).join(', ')})`,
  };
}

// ---------------------------------------------------------------------------------------------
// Rule set
// ---------------------------------------------------------------------------------------------

export const ParsingRulesSchema = z.strictObject({
  /** Remove leading and trailing white space from text cells before anything else. */
  trimWhitespace: z.boolean(),
  /** Extra cell texts that mean "no value" (case-insensitive), e.g. "N/A". */
  emptyValues: z.array(z.string().trim().min(1).max(32)).max(10),
  number: NumberFormatSchema,
  dateFormat: DateFormatSchema,
  boolean: BooleanFormatSchema,
});
export type ParsingRules = z.infer<typeof ParsingRulesSchema>;

export const DEFAULT_PARSING_RULES: ParsingRules = {
  trimWhitespace: true,
  emptyValues: [],
  number: { decimalSeparator: '.', thousandsSeparator: 'NONE' },
  dateFormat: 'YYYY-MM-DD',
  boolean: { trueValues: ['true'], falseValues: ['false'] },
};

export function isConfiguredEmptyValue(
  text: string,
  rules: Pick<ParsingRules, 'emptyValues'>,
): boolean {
  const token = normalizeToken(text);
  return rules.emptyValues.some((value) => normalizeToken(value) === token);
}
