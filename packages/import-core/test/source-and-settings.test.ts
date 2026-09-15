import { describe, expect, it } from 'vitest';
import {
  buildCsvTemplate,
  buildSourceColumns,
  checkSourceSettings,
  columnIndexFromLetters,
  columnLetter,
  countDataRows,
  describeColumn,
  formatSpreadsheetNumber,
  settingsAfterInspection,
  spreadsheetPrecision,
  type SourceInspection,
} from '../src';
import { CSV_SETTINGS, inspectionOf, row, vdpDocument } from './fixtures';

describe('column letters', () => {
  it.each([
    [0, 'A'],
    [25, 'Z'],
    [26, 'AA'],
    [51, 'AZ'],
    [701, 'ZZ'],
    [702, 'AAA'],
    [16_383, 'XFD'],
  ])('%d ↔ %s', (index, letters) => {
    expect(columnLetter(index)).toBe(letters);
    expect(columnIndexFromLetters(letters)).toBe(index);
  });

  it('refuses things that are not column references', () => {
    expect(columnIndexFromLetters('a1')).toBe(-1);
    expect(columnIndexFromLetters('')).toBe(-1);
  });
});

describe('spreadsheet numbers', () => {
  it('reads typed numbers with 15 significant digits, in plain notation', () => {
    expect(spreadsheetPrecision(0.1 + 0.2)).toBe(0.3);
    expect(formatSpreadsheetNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatSpreadsheetNumber(9501234567891)).toBe('9501234567891');
    expect(formatSpreadsheetNumber(1e21)).toBe('1000000000000000000000');
    expect(formatSpreadsheetNumber(1.5e-7)).toBe('0.00000015');
    expect(formatSpreadsheetNumber(-0)).toBe('0');
  });

  it('keeps the leading zeros of an all-zero number format', () => {
    expect(formatSpreadsheetNumber(12345678, 13)).toBe('0000012345678');
    expect(formatSpreadsheetNumber(12.5, 13)).toBe('12.5');
  });
});

describe('source columns', () => {
  const inspection = inspectionOf([
    row(1, ['Customer order export', '', '', '', '']),
    row(2, ['STYLE', 'PRICE', '', 'PRICE', 'SIZE']),
    row(3, ['YT2045', '39,95', 'x', '42,00', 'XL']),
    row(4, ['', '', '', '', '']),
    row(5, ['YT2046', '19,99', '', '21,00', 'M']),
  ]);
  const settings = { ...CSV_SETTINGS, headerRow: 2 };

  it('keeps duplicate headers distinguishable by position', () => {
    const columns = buildSourceColumns(settings, inspection);
    expect(columns.map(describeColumn)).toEqual([
      'STYLE — Column A',
      'PRICE — Column B',
      'Column C (no header)',
      'PRICE — Column D',
      'SIZE — Column E',
    ]);
    expect(columns[1]).toMatchObject({
      duplicate: true,
      occurrence: 1,
      samples: ['39,95', '19,99'],
    });
    expect(columns[3]).toMatchObject({ duplicate: true, occurrence: 2 });
    expect(columns[2]).toMatchObject({ header: '', duplicate: false, samples: ['x'] });
  });

  it('counts data rows below the header', () => {
    expect(
      countDataRows(settings, inspectionOf(inspection.sheets[0]!.previewRows.map(toRow), 4)),
    ).toBe(2);
    expect(countDataRows(CSV_SETTINGS, inspectionOf([row(1, ['a']), row(2, ['b'])]))).toBe(1);
  });

  it('checks the header row', () => {
    expect(checkSourceSettings(settings, inspection)).toEqual([]);
    expect(checkSourceSettings({ ...settings, headerRow: 4 }, inspection)).toMatchObject([
      { code: 'INVALID_HEADER_ROW', message: 'Row 4 is empty' },
    ]);
    expect(checkSourceSettings({ ...settings, headerRow: 40 }, inspection)).toMatchObject([
      { code: 'INVALID_HEADER_ROW' },
    ]);
  });
});

function toRow(previewRow: SourceInspection['sheets'][number]['previewRows'][number]) {
  return row(
    previewRow.rowNumber,
    previewRow.cells.map((cell) => cell.text),
  );
}

describe('source settings after inspection', () => {
  it('keeps an ambiguous delimiter unset until the user chooses', () => {
    const ambiguous: SourceInspection = {
      ...inspectionOf([row(1, ['a;b,c'])]),
      csv: {
        encoding: 'UTF-8',
        encodingSource: 'VALID_UTF8',
        bom: false,
        delimiter: ',',
        delimiterCandidates: [',', ';'],
        delimiterAmbiguous: true,
      },
    };
    const settings = settingsAfterInspection({ ...CSV_SETTINGS, delimiter: null }, ambiguous);
    expect(settings).toMatchObject({ delimiter: null });
    expect(checkSourceSettings(settings, ambiguous)).toMatchObject([
      { code: 'DELIMITER_REQUIRED' },
    ]);
    // A choice already made is never replaced.
    expect(settingsAfterInspection({ ...CSV_SETTINGS, delimiter: ';' }, ambiguous)).toMatchObject({
      delimiter: ';',
    });
  });

  it('selects the only visible worksheet, but never guesses between several', () => {
    const sheet = inspectionOf([row(1, ['a'])]).sheets[0]!;
    const workbook = (names: string[], hidden: string[] = []): SourceInspection => ({
      ...inspectionOf([]),
      format: 'XLSX',
      csv: null,
      workbook: { date1904: false, externalLinks: false },
      sheets: names.map((name, index) => ({
        ...sheet,
        name,
        index,
        visible: !hidden.includes(name),
      })),
    });
    const xlsx = { format: 'XLSX' as const, sheetName: null, headerRow: 1 };
    expect(settingsAfterInspection(xlsx, workbook(['Data']))).toMatchObject({ sheetName: 'Data' });
    expect(settingsAfterInspection(xlsx, workbook(['Data', 'Hidden'], ['Hidden']))).toMatchObject({
      sheetName: 'Data',
    });
    const several = workbook(['Summary', 'Data']);
    expect(settingsAfterInspection(xlsx, several)).toMatchObject({ sheetName: null });
    expect(checkSourceSettings(xlsx, several)).toMatchObject([{ code: 'SHEET_REQUIRED' }]);
    expect(checkSourceSettings({ ...xlsx, sheetName: 'Missing' }, several)).toMatchObject([
      { code: 'SHEET_NOT_FOUND' },
    ]);
  });
});

describe('CSV template', () => {
  it('names every field key in schema order, with a BOM', () => {
    expect(buildCsvTemplate(vdpDocument().dataSchema)).toBe(
      '\uFEFFproduct_name,style,color,size,price,currency,gtin,country_of_origin,product_url,is_sustainable,product_image\r\n',
    );
  });
});
