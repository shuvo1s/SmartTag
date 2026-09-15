import type { DesignDocument } from '@smarttag/document-schema';
import { createVariableDataHangTagDocument } from '@smarttag/document-utils/fixtures';
import {
  buildSourceColumns,
  toPreviewCell,
  type SourceCell,
  type SourceInspection,
  type CsvSourceSettings,
  type SourceRow,
} from '../src';

export const TEMPLATE_HASH = 'a'.repeat(64);

export function vdpDocument(): DesignDocument {
  return createVariableDataHangTagDocument();
}

export function text(value: string): SourceCell {
  return value === '' ? { kind: 'EMPTY' } : { kind: 'TEXT', text: value };
}

export function row(rowNumber: number, values: readonly (string | SourceCell)[]): SourceRow {
  return {
    rowNumber,
    cells: values.map((value) => (typeof value === 'string' ? text(value) : value)),
  };
}

/** An inspection of one CSV-like sheet whose first rows are `rows`. */
export function inspectionOf(
  rows: readonly SourceRow[],
  nonBlankRows = rows.length,
): SourceInspection {
  const width = Math.max(0, ...rows.map((candidate) => candidate.cells.length));
  return {
    format: 'CSV',
    parser: { id: 'test', version: '1', libraries: {} },
    csv: {
      encoding: 'UTF-8',
      encodingSource: 'VALID_UTF8',
      bom: false,
      delimiter: ',',
      delimiterCandidates: [','],
      delimiterAmbiguous: false,
    },
    workbook: null,
    sheets: [
      {
        name: 'CSV',
        index: 0,
        visible: true,
        nonBlankRows,
        columnCount: width,
        previewRows: rows.map((candidate) => ({
          rowNumber: candidate.rowNumber,
          cells: candidate.cells.map(toPreviewCell),
        })),
        formulaCells: 0,
        formulaCellsWithoutValue: 0,
        issues: [],
      },
    ],
    issues: [],
  };
}

export const CSV_SETTINGS: CsvSourceSettings = {
  format: 'CSV',
  encoding: 'UTF-8',
  delimiter: ',',
  headerRow: 1,
};

export const HANG_TAG_HEADERS = [
  'STYLE_NO',
  'PRODUCT NAME',
  'Color',
  'SIZE_CODE',
  'RETAIL',
  'Currency',
  'EAN_CODE',
  'Country of Origin',
  'product_url',
  'SUSTAINABLE',
  'IMAGE',
] as const;

export function columnsFor(headers: readonly string[], sample: readonly string[] = []) {
  return buildSourceColumns(CSV_SETTINGS, inspectionOf([row(1, headers), row(2, sample)]));
}
