import {
  isBlankRow,
  toPreviewCell,
  type ImportLimits,
  type ParserInfo,
  type PreviewRow,
  type SourceFormat,
  type SourceInspection,
  type SourceIssue,
  type SourceRow,
  type SourceSettings,
  type SourceSheet,
} from '@smarttag/import-core';
import { Readable } from 'node:stream';

/** The bytes of an uploaded source file. Parsers never touch paths, URLs or storage. */
export interface SourceInput {
  readonly sizeBytes: number;
  /** A new stream over the whole file each call. */
  openStream(): Promise<Readable>;
  /** The whole file (workbooks need random access to their ZIP directory). */
  readAll(): Promise<Buffer>;
}

export function sourceFromBuffer(buffer: Buffer): SourceInput {
  return {
    sizeBytes: buffer.length,
    openStream: () => Promise.resolve(Readable.from([buffer])),
    readAll: () => Promise.resolve(buffer),
  };
}

export interface RowReadOptions {
  /** Checked between rows; reading stops with an AbortError when aborted. */
  readonly signal?: AbortSignal;
}

/**
 * A reader for one tabular format. Future sources (ERP exports, API payloads) implement the same
 * contract, so everything after reading — mapping, normalization, validation, datasets — is shared.
 */
export interface TabularSourceParser {
  readonly format: SourceFormat;
  readonly info: ParserInfo;
  /** Sheets, preview rows, counts and detected settings. Throws SourceReadError. */
  inspect(
    input: SourceInput,
    settings: SourceSettings,
    limits: ImportLimits,
  ): Promise<SourceInspection>;
  /**
   * Every row of the selected sheet in order (header rows included; rows that do not exist in a
   * workbook are skipped). Throws SourceReadError while iterating when the file is malformed.
   */
  rows(
    input: SourceInput,
    settings: SourceSettings,
    limits: ImportLimits,
    options?: RowReadOptions,
  ): AsyncIterable<SourceRow>;
}

/** Collects the inspection of one sheet while its rows stream past. */
export class SheetInspectionBuilder {
  private nonBlankRows = 0;
  private columnCount = 0;
  private formulaCells = 0;
  private formulaCellsWithoutValue = 0;
  private readonly preview: PreviewRow[] = [];
  private readonly issues: SourceIssue[] = [];
  private lastRowNumber = 0;

  constructor(
    private readonly name: string,
    private readonly index: number,
    private readonly visible: boolean,
    private readonly limits: ImportLimits,
  ) {}

  add(row: SourceRow): void {
    // Rows missing from a workbook are blank rows; the preview shows them.
    for (
      let number = this.lastRowNumber + 1;
      number < row.rowNumber && number <= this.limits.previewRows;
      number += 1
    ) {
      this.preview.push({ rowNumber: number, cells: [] });
    }
    this.lastRowNumber = row.rowNumber;
    if (row.rowNumber <= this.limits.previewRows) {
      this.preview.push({ rowNumber: row.rowNumber, cells: row.cells.map(toPreviewCell) });
    }
    for (const cell of row.cells) {
      if (!cell.formula) continue;
      this.formulaCells += 1;
      if (cell.kind === 'EMPTY') this.formulaCellsWithoutValue += 1;
    }
    if (isBlankRow(row)) return;
    this.nonBlankRows += 1;
    this.columnCount = Math.max(this.columnCount, row.cells.length);
  }

  /** Data rows exceed the limit (one header row assumed): the sheet cannot be imported. */
  get exceedsRowLimit(): boolean {
    return this.nonBlankRows - 1 > this.limits.maxRows;
  }

  addIssue(issue: SourceIssue): void {
    if (!this.issues.some((existing) => existing.code === issue.code)) this.issues.push(issue);
  }

  build(): SourceSheet {
    if (this.exceedsRowLimit) {
      this.addIssue({
        code: 'FILE_LIMIT_EXCEEDED',
        severity: 'ERROR',
        message: `"${this.name}" has more than ${this.limits.maxRows.toLocaleString('en-US')} data rows`,
      });
    }
    if (this.formulaCells > 0) {
      this.addIssue({
        code: 'FORMULAS_PRESENT',
        severity: 'WARNING',
        message: `"${this.name}" contains ${this.formulaCells} formula cells. Formulas are never calculated: saved results are imported with a warning${this.formulaCellsWithoutValue > 0 ? `, and ${this.formulaCellsWithoutValue} formula cells have no saved result` : ''}.`,
      });
    }
    return {
      name: this.name,
      index: this.index,
      visible: this.visible,
      nonBlankRows: this.nonBlankRows,
      columnCount: this.columnCount,
      previewRows: this.preview.slice(0, this.limits.previewRows),
      formulaCells: this.formulaCells,
      formulaCellsWithoutValue: this.formulaCellsWithoutValue,
      issues: this.issues,
    };
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Reading was aborted');
  }
}
