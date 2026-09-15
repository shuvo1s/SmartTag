import { z } from 'zod';
import {
  CSV_DELIMITERS,
  CSV_ENCODINGS,
  columnLetter,
  type SourceFormat,
  type SourceInspection,
  type SourceIssue,
  type SourceSheet,
} from './source';

/** Maximum header row number accepted by the schema; the preview size limits it further. */
export const MAX_HEADER_ROW = 100;

export const CsvSourceSettingsSchema = z.strictObject({
  format: z.literal('CSV'),
  encoding: z.enum(CSV_ENCODINGS),
  /** null until a delimiter is known: an ambiguous file needs the user's choice. */
  delimiter: z.enum(CSV_DELIMITERS).nullable(),
  headerRow: z.number().int().min(1).max(MAX_HEADER_ROW),
});
export type CsvSourceSettings = z.infer<typeof CsvSourceSettingsSchema>;

export const XlsxSourceSettingsSchema = z.strictObject({
  format: z.literal('XLSX'),
  /** Worksheet by name; null until chosen when a workbook has several visible sheets. */
  sheetName: z.string().min(1).max(31).nullable(),
  headerRow: z.number().int().min(1).max(MAX_HEADER_ROW),
});
export type XlsxSourceSettings = z.infer<typeof XlsxSourceSettingsSchema>;

export const SourceSettingsSchema = z.discriminatedUnion('format', [
  CsvSourceSettingsSchema,
  XlsxSourceSettingsSchema,
]);
export type SourceSettings = z.infer<typeof SourceSettingsSchema>;

export function defaultSourceSettings(format: SourceFormat): SourceSettings {
  return format === 'CSV'
    ? { format: 'CSV', encoding: 'UTF-8', delimiter: null, headerRow: 1 }
    : { format: 'XLSX', sheetName: null, headerRow: 1 };
}

/**
 * Settings after an inspection: the detected encoding and an unambiguous delimiter for CSV, the
 * only visible sheet for a single-sheet workbook. Ambiguous choices stay null so the user decides;
 * choices the user already made are kept.
 */
export function settingsAfterInspection(
  current: SourceSettings,
  inspection: SourceInspection,
): SourceSettings {
  if (current.format === 'CSV') {
    const csv = inspection.csv;
    if (!csv) return current;
    return {
      ...current,
      encoding: csv.encoding,
      delimiter: current.delimiter ?? (csv.delimiterAmbiguous ? null : csv.delimiter),
    };
  }
  if (current.sheetName && inspection.sheets.some((sheet) => sheet.name === current.sheetName)) {
    return current;
  }
  // Only a workbook with exactly one visible sheet is unambiguous (its problems, if any, are
  // reported by checkSourceSettings); several visible sheets always need the user's choice.
  const visible = inspection.sheets.filter((sheet) => sheet.visible);
  return { ...current, sheetName: visible.length === 1 ? visible[0]!.name : null };
}

export interface SourceSettingsProblem {
  readonly code:
    | 'SHEET_REQUIRED'
    | 'SHEET_NOT_FOUND'
    | 'DELIMITER_REQUIRED'
    | 'INVALID_HEADER_ROW'
    | 'SHEET_UNUSABLE'
    | 'NO_SHEETS';
  readonly message: string;
}

/** The worksheet the settings select (CSV files have exactly one pseudo-sheet). */
export function selectedSheet(
  settings: SourceSettings,
  inspection: SourceInspection,
): SourceSheet | null {
  if (settings.format === 'CSV') return inspection.sheets[0] ?? null;
  return inspection.sheets.find((sheet) => sheet.name === settings.sheetName) ?? null;
}

/** Why the source settings cannot be used yet, or an empty list. */
export function checkSourceSettings(
  settings: SourceSettings,
  inspection: SourceInspection,
): SourceSettingsProblem[] {
  const problems: SourceSettingsProblem[] = [];
  if (inspection.sheets.length === 0) {
    return [{ code: 'NO_SHEETS', message: 'The file contains no worksheets with data' }];
  }
  if (settings.format === 'CSV' && settings.delimiter === null) {
    problems.push({
      code: 'DELIMITER_REQUIRED',
      message: 'Choose the delimiter: more than one delimiter splits this file into columns',
    });
  }
  if (settings.format === 'XLSX' && settings.sheetName === null) {
    problems.push({
      code: 'SHEET_REQUIRED',
      message: 'Choose the worksheet that contains the data',
    });
    return problems;
  }
  const sheet = selectedSheet(settings, inspection);
  if (!sheet) {
    problems.push({
      code: 'SHEET_NOT_FOUND',
      message: `The workbook has no worksheet named "${settings.format === 'XLSX' ? settings.sheetName : ''}"`,
    });
    return problems;
  }
  const blocking = sheet.issues.filter((issue: SourceIssue) => issue.severity === 'ERROR');
  if (blocking.length > 0) {
    problems.push({
      code: 'SHEET_UNUSABLE',
      message: blocking.map((issue) => issue.message).join('; '),
    });
  }
  const header = sheet.previewRows.find((row) => row.rowNumber === settings.headerRow);
  if (settings.headerRow > sheet.previewRows.length || !header) {
    problems.push({
      code: 'INVALID_HEADER_ROW',
      message: `The header row must be one of the first ${sheet.previewRows.length} rows`,
    });
  } else if (header.cells.every((cell) => cell.text.trim() === '')) {
    problems.push({ code: 'INVALID_HEADER_ROW', message: `Row ${settings.headerRow} is empty` });
  }
  return problems;
}

/**
 * A source column. Identity is the column position together with its header text: headers are
 * not unique in real exports ("PRICE" in D and F), so the letter is always part of what people see
 * ("PRICE — Column D") and what mappings store.
 */
export interface SourceColumn {
  /** 0-based position. */
  readonly index: number;
  /** Spreadsheet letter, "A", "B", … */
  readonly letter: string;
  /** Header text, trimmed; empty for unnamed columns. */
  readonly header: string;
  /** 1-based position among columns with the same header text. */
  readonly occurrence: number;
  /** Another column has the same header text. */
  readonly duplicate: boolean;
  /** Up to three non-empty example values from the rows below the header (preview only). */
  readonly samples: readonly string[];
}

/** "PRICE — Column D", "Column H (no header)". */
export function describeColumn(column: Pick<SourceColumn, 'letter' | 'header'>): string {
  return column.header
    ? `${column.header} — Column ${column.letter}`
    : `Column ${column.letter} (no header)`;
}

/** Columns of the selected sheet below the chosen header row. */
export function buildSourceColumns(
  settings: SourceSettings,
  inspection: SourceInspection,
): SourceColumn[] {
  const sheet = selectedSheet(settings, inspection);
  if (!sheet) return [];
  const headerRow = sheet.previewRows.find((row) => row.rowNumber === settings.headerRow);
  if (!headerRow) return [];
  const width = Math.max(sheet.columnCount, headerRow.cells.length);
  const headers = Array.from(
    { length: width },
    (_, index) => headerRow.cells[index]?.text.trim() ?? '',
  );
  const counts = new Map<string, number>();
  for (const header of headers) if (header) counts.set(header, (counts.get(header) ?? 0) + 1);
  const seen = new Map<string, number>();
  const dataRows = sheet.previewRows.filter((row) => row.rowNumber > settings.headerRow);
  return headers.map((header, index): SourceColumn => {
    const occurrence = header ? (seen.get(header) ?? 0) + 1 : 1;
    if (header) seen.set(header, occurrence);
    const samples: string[] = [];
    for (const row of dataRows) {
      const text = row.cells[index]?.text ?? '';
      if (text.trim() !== '') samples.push(text);
      if (samples.length === 3) break;
    }
    return {
      index,
      letter: columnLetter(index),
      header,
      occurrence,
      duplicate: header !== '' && (counts.get(header) ?? 0) > 1,
      samples,
    };
  });
}

/** Data rows of the selected sheet: non-blank rows below the header row. */
export function countDataRows(
  settings: SourceSettings,
  inspection: SourceInspection,
): number | null {
  const sheet = selectedSheet(settings, inspection);
  if (!sheet) return null;
  const nonBlankAtOrAboveHeader = sheet.previewRows.filter(
    (row) =>
      row.rowNumber <= settings.headerRow &&
      row.cells.some((cell) => cell.text !== '' || cell.formula),
  ).length;
  return Math.max(0, sheet.nonBlankRows - nonBlankAtOrAboveHeader);
}
