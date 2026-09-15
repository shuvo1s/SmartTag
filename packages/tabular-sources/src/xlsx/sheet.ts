import {
  columnIndexFromLetters,
  columnLetter,
  spreadsheetSerialToDate,
  type ImportLimits,
  type SourceCell,
  type SourceRow,
} from '@smarttag/import-core';
import type { Readable } from 'node:stream';
import { SourceReadError } from '../errors';
import type { CellStyles } from './workbook';
import { decodeXmlStringEscapes } from './workbook';
import { attribute, createXmlParser, textChunks } from './xml';

export interface SheetReadContext {
  readonly sheetName: string;
  readonly part: string;
  readonly date1904: boolean;
  readonly sharedStrings: readonly string[];
  readonly styles: CellStyles;
  readonly limits: ImportLimits;
}

export interface SheetReadSummary {
  mergedCells: boolean;
}

const CELL_REFERENCE = /^([A-Z]{1,3})(\d+)$/;
const ISO_DATE_TIME = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}:\d{2}))?/;

/**
 * Streams the rows of one worksheet. Formulas (`<f>`) are recorded but never evaluated: the cell
 * value is the cached result (`<v>`) the saving application stored, or empty when there is none.
 * Rows that do not appear in the XML are simply not produced.
 */
export async function* readSheetRows(
  stream: Readable,
  context: SheetReadContext,
  summary: SheetReadSummary = { mergedCells: false },
): AsyncGenerator<SourceRow> {
  const { limits } = context;
  const completed: SourceRow[] = [];
  const cap = limits.maxCellChars + 1;

  let inSheetData = false;
  let rowNumber = 0;
  let cells: SourceCell[] = [];
  let nextColumn = 0;

  let inCell = false;
  let cellColumn = 0;
  let cellType = 'n';
  let cellStyle = 0;
  let formula = false;
  let value: string | null = null;
  let inValue = false;
  let inline: string | null = null;
  let inInlineText = false;
  let phonetic = 0;

  const tooLong = () =>
    new SourceReadError(
      'FILE_LIMIT_EXCEEDED',
      `The cell in "${context.sheetName}" row ${rowNumber}, column ${columnLetter(cellColumn)} is longer than ${limits.maxCellChars.toLocaleString('en-US')} characters.`,
    );
  const malformed = (reason: string) =>
    new SourceReadError(
      'MALFORMED_FILE',
      `The worksheet "${context.sheetName}" cannot be read: ${reason}.`,
    );

  const finishCell = (): SourceCell => {
    const flag = formula ? ({ formula: true } as const) : {};
    const text = (raw: string): SourceCell => {
      if (raw.length > limits.maxCellChars) throw tooLong();
      return raw === '' ? { kind: 'EMPTY', ...flag } : { kind: 'TEXT', text: raw, ...flag };
    };
    switch (cellType) {
      case 's': {
        if (value === null || value.trim() === '') return { kind: 'EMPTY', ...flag };
        const index = Number(value);
        const shared = Number.isInteger(index) ? context.sharedStrings[index] : undefined;
        if (shared === undefined) throw malformed(`row ${rowNumber} refers to missing shared text`);
        return text(shared);
      }
      case 'inlineStr':
        return text(decodeXmlStringEscapes(inline ?? ''));
      case 'str':
        return value === null ? { kind: 'EMPTY', ...flag } : text(decodeXmlStringEscapes(value));
      case 'b':
        if (value === null) return { kind: 'EMPTY', ...flag };
        return { kind: 'BOOLEAN', value: value.trim() === '1' || value.trim() === 'true', ...flag };
      case 'e':
        return value === null
          ? { kind: 'EMPTY', ...flag }
          : { kind: 'ERROR', code: value.trim(), ...flag };
      case 'd': {
        const match = value === null ? null : ISO_DATE_TIME.exec(value.trim());
        if (!match) return value === null ? { kind: 'EMPTY', ...flag } : text(value);
        return { kind: 'DATE', date: match[1]!, time: match[2] ?? null, ...flag };
      }
      default: {
        if (value === null || value.trim() === '') return { kind: 'EMPTY', ...flag };
        const number = Number(value);
        if (!Number.isFinite(number))
          throw malformed(`row ${rowNumber} contains the invalid number "${value.slice(0, 40)}"`);
        if (context.styles.date[cellStyle]) {
          const date = spreadsheetSerialToDate(number, context.date1904);
          if (date) return { kind: 'DATE', date: date.date, time: date.time, ...flag };
        }
        const zeroPad = context.styles.zeroPad[cellStyle] ?? 0;
        return zeroPad > 0
          ? { kind: 'NUMBER', value: number, zeroPad, ...flag }
          : { kind: 'NUMBER', value: number, ...flag };
      }
    }
  };

  const parser = createXmlParser(context.part, {
    open(name, attributes) {
      if (name === 'sheetData') {
        inSheetData = true;
      } else if (name === 'mergeCell') {
        summary.mergedCells = true;
      } else if (!inSheetData) {
        return;
      } else if (name === 'row') {
        const declared = Number(attribute(attributes, 'r'));
        const next = Number.isInteger(declared) && declared > 0 ? declared : rowNumber + 1;
        if (next <= rowNumber || next > 1_048_576) throw malformed('rows are out of order');
        rowNumber = next;
        cells = [];
        nextColumn = 0;
      } else if (name === 'c') {
        inCell = true;
        const reference = attribute(attributes, 'r');
        const match = reference ? CELL_REFERENCE.exec(reference) : null;
        cellColumn = match ? columnIndexFromLetters(match[1]!) : nextColumn;
        if (cellColumn < 0 || cellColumn < nextColumn)
          throw malformed(`row ${rowNumber} has cells out of order`);
        cellType = attribute(attributes, 't') ?? 'n';
        cellStyle = Number(attribute(attributes, 's') ?? '0') || 0;
        formula = false;
        value = null;
        inline = null;
      } else if (inCell && name === 'f') {
        formula = true;
      } else if (inCell && name === 'v') {
        inValue = true;
        value = '';
      } else if (inCell && name === 'is') {
        inline = '';
      } else if (inCell && name === 'rPh') {
        phonetic += 1;
      } else if (inCell && name === 't' && inline !== null && phonetic === 0) {
        inInlineText = true;
      }
    },
    text(chunk) {
      if (inValue && value !== null) {
        if (value.length + chunk.length > cap) throw tooLong();
        value += chunk;
      } else if (inInlineText && inline !== null) {
        if (inline.length + chunk.length > cap) throw tooLong();
        inline += chunk;
      }
    },
    close(name) {
      if (name === 'sheetData') {
        inSheetData = false;
      } else if (!inSheetData) {
        return;
      } else if (name === 'v') {
        inValue = false;
      } else if (name === 't') {
        inInlineText = false;
      } else if (name === 'rPh') {
        phonetic -= 1;
      } else if (name === 'c' && inCell) {
        inCell = false;
        const cell = finishCell();
        nextColumn = cellColumn + 1;
        if (cellColumn >= limits.maxColumns) {
          // Formatting-only cells far to the right are common; values there are not supported.
          if (cell.kind === 'EMPTY' && !cell.formula) return;
          throw new SourceReadError(
            'FILE_LIMIT_EXCEEDED',
            `"${context.sheetName}" has data in column ${columnLetter(cellColumn)}; at most ${limits.maxColumns} columns are supported.`,
          );
        }
        while (cells.length < cellColumn) cells.push({ kind: 'EMPTY' });
        cells[cellColumn] = cell;
        nextColumn = cellColumn + 1;
      } else if (name === 'row') {
        let width = cells.length;
        while (width > 0 && cells[width - 1]!.kind === 'EMPTY' && !cells[width - 1]!.formula)
          width -= 1;
        completed.push({
          rowNumber,
          cells: width === cells.length ? cells : cells.slice(0, width),
        });
      }
    },
  });

  for await (const text of textChunks(stream, context.part)) {
    parser.write(text);
    while (completed.length > 0) yield completed.shift()!;
  }
  parser.close();
  while (completed.length > 0) yield completed.shift()!;
}
