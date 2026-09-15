/**
 * The tabular source model: what every parser (CSV, XLSX, later ERP/API payloads) produces and
 * what mapping and normalization consume. Parsers live in @smarttag/tabular-sources; this module
 * is only data and pure helpers, so the browser can display inspections and mappings.
 */

export const SOURCE_FORMATS = ['CSV', 'XLSX'] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];

/**
 * One cell as read from the source, before any interpretation for a data field.
 *
 * - CSV cells are always TEXT or EMPTY.
 * - XLSX cells keep their stored type. Date-formatted numbers are converted to DATE by the reader
 *   (it knows the workbook's date system); other numbers stay NUMBER.
 * - `formula` marks spreadsheet formulas. Formulas are never evaluated: a formula cell carries its
 *   cached value (as stored by the application that saved the file) or is EMPTY when there is none.
 */
export type SourceCell =
  | { readonly kind: 'EMPTY'; readonly formula?: true }
  | { readonly kind: 'TEXT'; readonly text: string; readonly formula?: true }
  | {
      readonly kind: 'NUMBER';
      readonly value: number;
      /** Minimum digits of an all-zero number format such as "0000000000000" (0 otherwise). */
      readonly zeroPad?: number;
      readonly formula?: true;
    }
  | {
      readonly kind: 'DATE';
      /** ISO calendar date. */
      readonly date: string;
      /** "HH:MM:SS" when the value has a time of day, otherwise null. */
      readonly time: string | null;
      readonly formula?: true;
    }
  | { readonly kind: 'BOOLEAN'; readonly value: boolean; readonly formula?: true }
  | { readonly kind: 'ERROR'; readonly code: string; readonly formula?: true };

export type SourceCellKind = SourceCell['kind'];

export const EMPTY_CELL: SourceCell = Object.freeze({ kind: 'EMPTY' });

export interface SourceRow {
  /** 1-based row number as a person sees it: the spreadsheet row, or the CSV record index. */
  readonly rowNumber: number;
  readonly cells: readonly SourceCell[];
}

export function isBlankRow(row: SourceRow): boolean {
  return row.cells.every((cell) => cell.kind === 'EMPTY' && !cell.formula);
}

/** A cell as shown in previews (display text only; never used for import values). */
export interface PreviewCell {
  readonly text: string;
  readonly kind: SourceCellKind;
  readonly formula: boolean;
  /** The text was shortened for the preview. */
  readonly truncated: boolean;
}

export interface PreviewRow {
  readonly rowNumber: number;
  readonly cells: readonly PreviewCell[];
}

export const PREVIEW_CELL_MAX_CHARS = 200;

export interface SourceSheet {
  /** Worksheet name; "CSV" for CSV files. */
  readonly name: string;
  readonly index: number;
  readonly visible: boolean;
  /** Non-blank rows in the sheet, including header rows. */
  readonly nonBlankRows: number;
  /** Highest number of columns in any row. */
  readonly columnCount: number;
  /** Rows 1..N (blank rows included, with no cells) for header selection and the source preview. */
  readonly previewRows: readonly PreviewRow[];
  readonly formulaCells: number;
  readonly formulaCellsWithoutValue: number;
  /** Problems that make this sheet unusable (e.g. too many rows or columns). */
  readonly issues: readonly SourceIssue[];
}

export const SOURCE_ISSUE_CODES = [
  'FILE_LIMIT_EXCEEDED',
  'WORKBOOK_LIMIT_EXCEEDED',
  'NO_SHEETS',
  'MALFORMED_FILE',
  'UNSUPPORTED_IMPORT_FORMAT',
  'ENCODING_INVALID',
  'DELIMITER_AMBIGUOUS',
  'EXTERNAL_LINKS_IGNORED',
  'FORMULAS_PRESENT',
  'MERGED_CELLS_PRESENT',
] as const;
export type SourceIssueCode = (typeof SOURCE_ISSUE_CODES)[number];

export interface SourceIssue {
  readonly code: SourceIssueCode;
  readonly severity: 'ERROR' | 'WARNING';
  readonly message: string;
}

export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

export const CSV_ENCODINGS = [
  'UTF-8',
  'UTF-16LE',
  'UTF-16BE',
  'WINDOWS-1252',
  'ISO-8859-1',
] as const;
export type CsvEncoding = (typeof CSV_ENCODINGS)[number];

export function describeDelimiter(delimiter: CsvDelimiter): string {
  switch (delimiter) {
    case ',':
      return 'Comma (,)';
    case ';':
      return 'Semicolon (;)';
    case '\t':
      return 'Tab';
    case '|':
      return 'Pipe (|)';
  }
}

export interface ParserInfo {
  /** Stable parser identifier, e.g. "smarttag-csv". */
  readonly id: string;
  /** Version of SmartTag's parser implementation (bumped whenever results could change). */
  readonly version: string;
  /** Third-party libraries and their versions, for traceability. */
  readonly libraries: Readonly<Record<string, string>>;
}

export interface CsvInspectionDetails {
  readonly encoding: CsvEncoding;
  /** How the encoding was determined. */
  readonly encodingSource: 'BOM' | 'VALID_UTF8' | 'SETTINGS';
  readonly bom: boolean;
  readonly delimiter: CsvDelimiter;
  /** Delimiters that split the sample into consistent columns. */
  readonly delimiterCandidates: readonly CsvDelimiter[];
  /** True when more than one delimiter fits: the user must choose. */
  readonly delimiterAmbiguous: boolean;
}

export interface WorkbookInspectionDetails {
  readonly date1904: boolean;
  readonly externalLinks: boolean;
}

export interface SourceInspection {
  readonly format: SourceFormat;
  readonly parser: ParserInfo;
  readonly csv: CsvInspectionDetails | null;
  readonly workbook: WorkbookInspectionDetails | null;
  readonly sheets: readonly SourceSheet[];
  /** File-level warnings (errors make inspection fail instead). */
  readonly issues: readonly SourceIssue[];
}

/** "A", "B", …, "Z", "AA", … for a 0-based column index. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** 0-based index of a column reference ("A" → 0, "AA" → 26); -1 when not a column reference. */
export function columnIndexFromLetters(letters: string): number {
  if (!/^[A-Z]{1,3}$/.test(letters)) return -1;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Text shown for a cell in previews and column samples. */
export function cellDisplayText(cell: SourceCell): string {
  switch (cell.kind) {
    case 'EMPTY':
      return '';
    case 'TEXT':
      return cell.text;
    case 'NUMBER':
      return formatSpreadsheetNumber(cell.value, cell.zeroPad ?? 0);
    case 'DATE':
      return cell.time && cell.time !== '00:00:00' ? `${cell.date} ${cell.time}` : cell.date;
    case 'BOOLEAN':
      return cell.value ? 'TRUE' : 'FALSE';
    case 'ERROR':
      return cell.code;
  }
}

export function toPreviewCell(cell: SourceCell): PreviewCell {
  const text = cellDisplayText(cell);
  const truncated = text.length > PREVIEW_CELL_MAX_CHARS;
  return {
    text: truncated ? `${text.slice(0, PREVIEW_CELL_MAX_CHARS)}…` : text,
    kind: cell.kind,
    formula: cell.formula === true,
    truncated,
  };
}

/**
 * Spreadsheets store numbers as IEEE doubles and show at most 15 significant digits; digits
 * beyond that are floating-point noise (0.1 + 0.2 = 0.30000000000000004 is shown as 0.3). Typed
 * numbers are read with the same precision.
 */
export function spreadsheetPrecision(value: number): number {
  if (!Number.isFinite(value) || value === 0) return value === 0 ? 0 : value;
  return Number(value.toPrecision(15));
}

/**
 * Plain decimal text of a typed spreadsheet number (no exponent, no grouping, "." as decimal
 * separator), zero-padded when the cell's number format is all zeros (e.g. "0000000000000" keeps
 * the leading zeros of a GTIN stored as a number).
 */
export function formatSpreadsheetNumber(value: number, zeroPad = 0): string {
  const precise = spreadsheetPrecision(value);
  const text = plainNumberText(precise);
  if (zeroPad > 0 && /^\d+$/.test(text) && text.length < zeroPad) {
    return text.padStart(zeroPad, '0');
  }
  return text;
}

function plainNumberText(value: number): string {
  if (Object.is(value, -0)) return '0';
  const text = String(value);
  if (!/e/i.test(text)) return text;
  // Expand exponent notation exactly from the shortest round-trip digits.
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (!match) return text;
  const [, sign, lead, rest = '', exponentText] = match;
  const digits = `${lead}${rest}`;
  const exponent = Number(exponentText);
  const point = 1 + exponent;
  let result: string;
  if (point <= 0) result = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length) result = digits + '0'.repeat(point - digits.length);
  else result = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return `${sign}${result}`;
}
