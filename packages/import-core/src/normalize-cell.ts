import type { DataField } from '@smarttag/document-schema';
import { decimalFromNumber } from '@smarttag/expression-core';
import { issueColumn, type ImportIssue, type ImportIssueCode } from './issues';
import {
  describeNumberFormat,
  isConfiguredEmptyValue,
  parseBooleanText,
  parseDateText,
  parseNumberText,
  type ParsingRules,
} from './parsing-rules';
import type { SourceColumn } from './settings';
import {
  cellDisplayText,
  formatSpreadsheetNumber,
  spreadsheetPrecision,
  type SourceCell,
} from './source';

/**
 * The result of reading one source cell for one data field.
 *
 * VALUE values are handed to the shared record validation (`validateDataRecord`) exactly like a
 * JSON record value: numbers and decimals as plain decimal text or numbers, dates as ISO text,
 * booleans as booleans, text as text. EMPTY means "no value" — the template's required flag,
 * default and missing-data policy decide what that means, not the importer.
 */
export type CellNormalization =
  | {
      readonly kind: 'VALUE';
      readonly value: string | number | boolean;
      readonly warnings: readonly ImportIssue[];
    }
  | { readonly kind: 'EMPTY'; readonly warnings: readonly ImportIssue[] }
  | {
      readonly kind: 'REJECTED';
      readonly issue: ImportIssue;
      readonly warnings: readonly ImportIssue[];
    };

export interface CellContext {
  readonly column: Pick<SourceColumn, 'index' | 'letter' | 'header'>;
  readonly maxCellChars: number;
}

const MAX_QUOTED = 60;

function quote(text: string): string {
  const shown = text.length > MAX_QUOTED ? `${text.slice(0, MAX_QUOTED)}…` : text;
  return `"${shown}"`;
}

/** Looks like a link, network share or file path rather than an asset id. */
function looksLikeExternalReference(text: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(text) ||
    text.startsWith('\\\\') ||
    text.startsWith('/') ||
    text.startsWith('./') ||
    text.startsWith('../') ||
    text.includes('\\') ||
    /\.(png|jpe?g|gif|webp|svg|tiff?|bmp|pdf|eps|ai)$/i.test(text)
  );
}

export function normalizeSourceCell(
  field: DataField,
  cell: SourceCell,
  rules: ParsingRules,
  context: CellContext,
): CellNormalization {
  const column = issueColumn(context.column);
  const issue = (
    code: ImportIssueCode,
    severity: ImportIssue['severity'],
    message: string,
  ): ImportIssue => ({
    layer: 'IMPORT',
    code,
    severity,
    message: `${field.displayName}: ${message}`,
    field: field.key,
    target: null,
    column,
  });
  const warnings: ImportIssue[] = [];
  const reject = (code: ImportIssueCode, message: string): CellNormalization => ({
    kind: 'REJECTED',
    issue: issue(code, 'ERROR', message),
    warnings,
  });
  const value = (result: string | number | boolean): CellNormalization => ({
    kind: 'VALUE',
    value: result,
    warnings,
  });

  if (cell.formula) {
    if (cell.kind === 'EMPTY') {
      return reject(
        'FORMULA_VALUE_UNAVAILABLE',
        `column ${context.column.letter} contains a formula without a saved result. Formulas are never calculated during import; open the workbook in a spreadsheet application, let it calculate, save it and upload it again (or paste the values).`,
      );
    }
    warnings.push(
      issue(
        'FORMULA_CACHED_VALUE',
        'WARNING',
        `column ${context.column.letter} contains a formula; the result saved in the file (${quote(cellDisplayText(cell))}) was imported without recalculating it`,
      ),
    );
  }

  switch (cell.kind) {
    case 'EMPTY':
      return { kind: 'EMPTY', warnings };

    case 'ERROR':
      return reject('SOURCE_VALUE_INVALID', `the cell contains the spreadsheet error ${cell.code}`);

    case 'TEXT': {
      const text = rules.trimWhitespace ? cell.text.trim() : cell.text;
      if (text.trim() === '' || isConfiguredEmptyValue(text, rules))
        return { kind: 'EMPTY', warnings };
      if (text.length > context.maxCellChars) {
        return reject(
          'CELL_TOO_LONG',
          `the cell is longer than ${context.maxCellChars} characters`,
        );
      }
      return normalizeText(field, text, rules, reject, value);
    }

    case 'NUMBER': {
      switch (field.type) {
        case 'string':
          return value(formatSpreadsheetNumber(cell.value, cell.zeroPad ?? 0));
        case 'number':
          return value(spreadsheetPrecision(cell.value));
        case 'decimal':
          return value(decimalFromNumber(spreadsheetPrecision(cell.value)));
        case 'boolean': {
          const text = formatSpreadsheetNumber(cell.value);
          const parsed = parseBooleanText(text, rules.boolean);
          return parsed.ok
            ? value(parsed.value)
            : reject(
                'BOOLEAN_PARSE_FAILED',
                `cannot read the number ${text} as true/false: ${parsed.reason}`,
              );
        }
        case 'date':
          return reject(
            'DATE_PARSE_FAILED',
            `the cell holds the number ${formatSpreadsheetNumber(cell.value)}, not a date. Format the column as a date in the workbook, or store dates as text in the configured format.`,
          );
        case 'url':
          return reject(
            'SOURCE_VALUE_INVALID',
            `the cell holds the number ${formatSpreadsheetNumber(cell.value)}, not a URL`,
          );
        case 'image':
          return reject(
            'IMAGE_REFERENCE_NOT_SUPPORTED',
            'image cells must contain the asset ID of an image of this organization',
          );
      }
      break;
    }

    case 'DATE': {
      const hasTime = cell.time !== null && cell.time !== '00:00:00';
      switch (field.type) {
        case 'date':
          if (hasTime) {
            warnings.push(
              issue(
                'DATE_TIME_IGNORED',
                'WARNING',
                `the time of day ${cell.time} in column ${context.column.letter} was ignored; only the date ${cell.date} was imported`,
              ),
            );
          }
          return value(cell.date);
        case 'string':
          return value(hasTime ? `${cell.date}T${cell.time}` : cell.date);
        case 'number':
        case 'decimal':
        case 'boolean':
        case 'url':
          return reject(
            'SOURCE_VALUE_INVALID',
            `the cell holds the date ${cell.date}, not ${expected(field)}`,
          );
        case 'image':
          return reject(
            'IMAGE_REFERENCE_NOT_SUPPORTED',
            'image cells must contain the asset ID of an image of this organization',
          );
      }
      break;
    }

    case 'BOOLEAN':
      switch (field.type) {
        case 'boolean':
          return value(cell.value);
        case 'string':
          return value(cell.value ? 'TRUE' : 'FALSE');
        case 'number':
        case 'decimal':
        case 'date':
        case 'url':
        case 'image':
          return reject(
            'SOURCE_VALUE_INVALID',
            `the cell holds ${cell.value ? 'TRUE' : 'FALSE'}, not ${expected(field)}`,
          );
      }
  }
  return reject('SOURCE_VALUE_INVALID', 'the cell cannot be read');
}

function normalizeText(
  field: DataField,
  text: string,
  rules: ParsingRules,
  reject: (code: ImportIssueCode, message: string) => CellNormalization,
  value: (result: string | number | boolean) => CellNormalization,
): CellNormalization {
  switch (field.type) {
    case 'string':
    case 'url':
      return value(text);
    case 'image':
      if (looksLikeExternalReference(text.trim())) {
        return reject(
          'IMAGE_REFERENCE_NOT_SUPPORTED',
          `${quote(text)} is a link or file path. Image cells must contain the asset ID of an image already uploaded to this organization; links, network paths and files are never downloaded or read during import.`,
        );
      }
      return value(text.trim());
    case 'number':
    case 'decimal': {
      const parsed = parseNumberText(text, rules.number);
      if (!parsed.ok) {
        return reject(
          field.type === 'decimal' ? 'DECIMAL_PARSE_FAILED' : 'NUMBER_PARSE_FAILED',
          `cannot parse ${quote(text)} using ${describeNumberFormat(rules.number)}: ${parsed.reason}`,
        );
      }
      return value(parsed.text);
    }
    case 'date': {
      const parsed = parseDateText(text, rules.dateFormat);
      return parsed.ok
        ? value(parsed.date)
        : reject('DATE_PARSE_FAILED', `cannot read ${quote(text)} as a date: ${parsed.reason}`);
    }
    case 'boolean': {
      const parsed = parseBooleanText(text, rules.boolean);
      return parsed.ok
        ? value(parsed.value)
        : reject(
            'BOOLEAN_PARSE_FAILED',
            `cannot read ${quote(text)} as true/false: ${parsed.reason}`,
          );
    }
  }
}

function expected(field: DataField): string {
  switch (field.type) {
    case 'string':
      return 'text';
    case 'number':
    case 'decimal':
      return 'a number';
    case 'boolean':
      return 'true/false';
    case 'date':
      return 'a date';
    case 'url':
      return 'a URL';
    case 'image':
      return 'an asset ID';
  }
}
