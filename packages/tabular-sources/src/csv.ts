import {
  CSV_DELIMITERS,
  columnLetter,
  describeDelimiter,
  type CsvDelimiter,
  type CsvEncoding,
  type CsvInspectionDetails,
  type ImportLimits,
  type ParserInfo,
  type SourceCell,
  type SourceInspection,
  type SourceRow,
  type SourceSettings,
} from '@smarttag/import-core';
import { CsvError, parse, type Options as CsvParseOptions } from 'csv-parse';
import { parse as parseSync } from 'csv-parse/sync';
import { Transform, type Readable } from 'node:stream';
import { SourceReadError } from './errors';
import {
  SheetInspectionBuilder,
  throwIfAborted,
  type RowReadOptions,
  type SourceInput,
  type TabularSourceParser,
} from './parser';

export const CSV_PARSER_INFO: ParserInfo = {
  id: 'smarttag-csv',
  version: '1',
  libraries: { 'csv-parse': '7.0.2' },
};

const SAMPLE_BYTES = 64 * 1024;
const SAMPLE_RECORDS = 50;

const TEXT_DECODER_LABELS: Readonly<Record<CsvEncoding, string>> = {
  'UTF-8': 'utf-8',
  'UTF-16LE': 'utf-16le',
  'UTF-16BE': 'utf-16be',
  'WINDOWS-1252': 'windows-1252',
  'ISO-8859-1': 'iso-8859-1',
};

export interface DecodingPlan {
  readonly encoding: CsvEncoding;
  readonly bom: boolean;
  readonly source: CsvInspectionDetails['encodingSource'];
}

/**
 * A byte order mark decides the encoding. Without one the configured encoding is used; for UTF-8
 * (the default) the bytes must be valid UTF-8 — other encodings are never guessed.
 */
export function planDecoding(head: Uint8Array, configured: CsvEncoding): DecodingPlan {
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    return { encoding: 'UTF-8', bom: true, source: 'BOM' };
  }
  if (head[0] === 0xff && head[1] === 0xfe)
    return { encoding: 'UTF-16LE', bom: true, source: 'BOM' };
  if (head[0] === 0xfe && head[1] === 0xff)
    return { encoding: 'UTF-16BE', bom: true, source: 'BOM' };
  return {
    encoding: configured,
    bom: false,
    source: configured === 'UTF-8' ? 'VALID_UTF8' : 'SETTINGS',
  };
}

function encodingError(plan: DecodingPlan, offset: number): SourceReadError {
  return new SourceReadError(
    'ENCODING_INVALID',
    plan.encoding === 'UTF-8'
      ? `The file is not valid UTF-8 text (invalid bytes near byte ${offset}). If it was saved as "CSV" by Excel on Windows, choose the Windows-1252 encoding.`
      : `The file cannot be read as ${plan.encoding} text (near byte ${offset}).`,
  );
}

/** Decodes bytes in the planned encoding (strict: invalid sequences fail) into UTF-8 text chunks. */
function decodingStream(plan: DecodingPlan): Transform {
  const decoder = new TextDecoder(TEXT_DECODER_LABELS[plan.encoding], { fatal: true });
  let offset = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        const text = decoder.decode(chunk, { stream: true });
        offset += chunk.length;
        callback(null, text);
      } catch {
        callback(encodingError(plan, offset));
      }
    },
    flush(callback) {
      try {
        callback(null, decoder.decode());
      } catch {
        callback(encodingError(plan, offset));
      }
    },
  });
}

async function readHead(input: SourceInput, bytes: number): Promise<Buffer> {
  const stream = await input.openStream();
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
    length += chunk.length;
    if (length >= bytes) break;
  }
  stream.destroy();
  return Buffer.concat(chunks).subarray(0, bytes);
}

export interface DelimiterDetection {
  readonly candidates: readonly CsvDelimiter[];
  readonly suggested: CsvDelimiter;
  readonly ambiguous: boolean;
}

/**
 * Delimiters that split the sample into a consistent number (> 1) of fields: at least 90% of the
 * sampled records have the most common field count. Exactly one candidate is a suggestion the
 * user can override; several candidates are ambiguous and the user must choose.
 */
export function detectDelimiters(sample: string, complete: boolean): DelimiterDetection {
  const text = complete ? sample : sample.slice(0, Math.max(0, sample.lastIndexOf('\n') + 1));
  const candidates = CSV_DELIMITERS.filter((delimiter) => {
    let records: string[][];
    try {
      records = parseSync(text, {
        delimiter,
        relax_column_count: true,
        skip_empty_lines: true,
        to: SAMPLE_RECORDS,
      });
    } catch {
      return false;
    }
    if (records.length === 0) return false;
    const counts = new Map<number, number>();
    for (const record of records) counts.set(record.length, (counts.get(record.length) ?? 0) + 1);
    const [modal, frequency] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]!;
    return modal > 1 && frequency / records.length >= 0.9;
  });
  return {
    candidates,
    suggested: candidates[0] ?? ',',
    ambiguous: candidates.length > 1,
  };
}

function csvParserOptions(delimiter: CsvDelimiter, limits: ImportLimits): CsvParseOptions {
  return {
    delimiter,
    quote: '"',
    escape: '"',
    // RFC 4180: stray quotes in unquoted values are malformed, never reinterpreted.
    relax_quotes: false,
    relax_column_count: true,
    skip_empty_lines: false,
    // Bounds the memory one record can take (every cell is also checked individually).
    max_record_size: Math.min(limits.maxCellChars * limits.maxColumns, 64 * 1024 * 1024),
    encoding: 'utf8',
  };
}

function translateCsvError(error: unknown): unknown {
  if (!(error instanceof CsvError)) return error;
  const line = /line (\d+)/.exec(error.message)?.[1];
  const at = line ? ` (line ${line})` : '';
  switch (error.code) {
    case 'CSV_QUOTE_NOT_CLOSED':
      return new SourceReadError(
        'MALFORMED_FILE',
        `The CSV file is malformed: a quoted value is never closed${at}. Values containing quotes, delimiters or line breaks must be enclosed in double quotes, with quotes inside doubled ("").`,
      );
    case 'CSV_INVALID_CLOSING_QUOTE':
    case 'INVALID_OPENING_QUOTE':
    case 'CSV_NON_TRIMABLE_CHAR_AFTER_CLOSING_QUOTE':
      return new SourceReadError(
        'MALFORMED_FILE',
        `The CSV file is malformed: a double quote appears inside a value that is not correctly quoted${at}. Enclose such values in double quotes and double the quotes inside ("").`,
      );
    case 'CSV_MAX_RECORD_SIZE':
      return new SourceReadError(
        'FILE_LIMIT_EXCEEDED',
        `A row of the CSV file is too large${at}. Check the delimiter, or split very long values.`,
      );
    default:
      return new SourceReadError(
        'MALFORMED_FILE',
        `The CSV file cannot be read${at}: ${error.message}`,
      );
  }
}

/** Streams CSV records as source rows (record index = row number). */
async function* csvRows(
  input: SourceInput,
  plan: DecodingPlan,
  delimiter: CsvDelimiter,
  limits: ImportLimits,
  signal?: AbortSignal,
): AsyncGenerator<SourceRow> {
  const source: Readable = await input.openStream();
  const decoder = decodingStream(plan);
  const parser = parse(csvParserOptions(delimiter, limits));
  const failures: unknown[] = [];
  const fail = (error: unknown) => {
    failures.push(error);
    parser.destroy(error instanceof Error ? error : new Error(String(error)));
  };
  source.on('error', fail);
  decoder.on('error', fail);
  source.pipe(decoder).pipe(parser);
  let rowNumber = 0;
  try {
    for await (const record of parser as AsyncIterable<string[]>) {
      throwIfAborted(signal);
      rowNumber += 1;
      yield toRow(rowNumber, record, limits);
    }
  } catch (error) {
    throw translateCsvError(failures[0] ?? error);
  } finally {
    source.destroy();
    decoder.destroy();
    parser.destroy();
  }
  if (failures.length > 0) throw translateCsvError(failures[0]);
}

function toRow(rowNumber: number, record: readonly string[], limits: ImportLimits): SourceRow {
  let width = record.length;
  while (width > 0 && record[width - 1] === '') width -= 1;
  if (width > limits.maxColumns) {
    throw new SourceReadError(
      'FILE_LIMIT_EXCEEDED',
      `Row ${rowNumber} has ${width} columns; at most ${limits.maxColumns} are supported.`,
    );
  }
  const cells: SourceCell[] = new Array<SourceCell>(width);
  for (let index = 0; index < width; index += 1) {
    const value = record[index]!;
    if (value.length > limits.maxCellChars) {
      throw new SourceReadError(
        'FILE_LIMIT_EXCEEDED',
        `The cell in row ${rowNumber}, column ${columnLetter(index)} is longer than ${limits.maxCellChars.toLocaleString('en-US')} characters.`,
      );
    }
    cells[index] = value === '' ? { kind: 'EMPTY' } : { kind: 'TEXT', text: value };
  }
  return { rowNumber, cells };
}

function assertCsvSettings(
  settings: SourceSettings,
): asserts settings is Extract<SourceSettings, { format: 'CSV' }> {
  if (settings.format !== 'CSV') throw new Error('CSV parser received non-CSV settings');
}

export class CsvSourceParser implements TabularSourceParser {
  readonly format = 'CSV' as const;
  readonly info = CSV_PARSER_INFO;

  async inspect(
    input: SourceInput,
    settings: SourceSettings,
    limits: ImportLimits,
  ): Promise<SourceInspection> {
    assertCsvSettings(settings);
    const head = await readHead(input, SAMPLE_BYTES);
    const plan = planDecoding(head, settings.encoding);
    let sample: string;
    try {
      const decoder = new TextDecoder(TEXT_DECODER_LABELS[plan.encoding], { fatal: true });
      const complete = head.length >= input.sizeBytes;
      // A multi-byte character may be cut at the end of the sample.
      sample = decoder.decode(head, { stream: !complete });
    } catch {
      throw encodingError(plan, 0);
    }
    const detection = detectDelimiters(sample, head.length >= input.sizeBytes);
    const delimiter = settings.delimiter ?? detection.suggested;

    const sheet = new SheetInspectionBuilder('CSV', 0, true, limits);
    for await (const row of csvRows(input, plan, delimiter, limits)) {
      sheet.add(row);
      if (sheet.exceedsRowLimit) break;
    }
    const built = sheet.build();
    if (built.nonBlankRows === 0) {
      throw new SourceReadError('NO_SHEETS', 'The CSV file contains no data.');
    }
    return {
      format: 'CSV',
      parser: CSV_PARSER_INFO,
      csv: {
        encoding: plan.encoding,
        encodingSource: plan.source,
        bom: plan.bom,
        delimiter,
        delimiterCandidates: detection.candidates,
        delimiterAmbiguous: settings.delimiter === null && detection.ambiguous,
      },
      workbook: null,
      sheets: [built],
      issues:
        settings.delimiter === null && detection.ambiguous
          ? [
              {
                code: 'DELIMITER_AMBIGUOUS',
                severity: 'WARNING',
                message: `Both ${detection.candidates.map(describeDelimiter).join(' and ')} split this file into columns. Choose the delimiter.`,
              },
            ]
          : [],
    };
  }

  async *rows(
    input: SourceInput,
    settings: SourceSettings,
    limits: ImportLimits,
    options: RowReadOptions = {},
  ): AsyncIterable<SourceRow> {
    assertCsvSettings(settings);
    if (settings.delimiter === null)
      throw new Error('A delimiter must be chosen before reading rows');
    const head = await readHead(input, 4);
    yield* csvRows(
      input,
      planDecoding(head, settings.encoding),
      settings.delimiter,
      limits,
      options.signal,
    );
  }
}
