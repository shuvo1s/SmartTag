import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CSV_PARSER_INFO,
  SourceReadError,
  XLSX_PARSER_INFO,
  detectDelimiters,
  parserFor,
  sourceFromBuffer,
} from '../src';
import { buildCsv } from '../src/testing';
import { csvSettings, limits, readAllRows, texts } from './helpers';

const csv = parserFor('CSV');
const utf8 = (text: string) => Buffer.from(text, 'utf8');
const BOM = String.fromCharCode(0xfeff);

describe('CSV reading (RFC 4180)', () => {
  it('reads a normal comma CSV with one row per record', async () => {
    const rows = await readAllRows(
      utf8('STYLE,SIZE,PRICE\r\nYT2045,XL,39.95\r\nYT2046,M,19.99\r\n'),
      csvSettings({ delimiter: ',' }),
    );
    expect(rows.map(texts)).toEqual([
      ['STYLE', 'SIZE', 'PRICE'],
      ['YT2045', 'XL', '39.95'],
      ['YT2046', 'M', '19.99'],
    ]);
    expect(rows.map((row) => row.rowNumber)).toEqual([1, 2, 3]);
  });

  it('keeps quoted commas, escaped quotes and embedded line breaks inside one value', async () => {
    const text = 'NAME,NOTE\n"Shirt, blue","He said ""hi"""\n"Line 1\nLine 2",x\n';
    const rows = await readAllRows(utf8(text), csvSettings({ delimiter: ',' }));
    expect(rows.map(texts)).toEqual([
      ['NAME', 'NOTE'],
      ['Shirt, blue', 'He said "hi"'],
      ['Line 1\nLine 2', 'x'],
    ]);
    // A multi-line value is still one row: the row number is the record index, as in a spreadsheet.
    expect(rows[2]!.rowNumber).toBe(3);
  });

  it('strips a UTF-8 byte order mark and detects the encoding from it', async () => {
    const buffer = utf8(`${BOM}STYLE;PREIS\nYT2045;39,95\n`);
    const inspection = await csv.inspect(sourceFromBuffer(buffer), csvSettings(), limits());
    expect(inspection.csv).toMatchObject({
      encoding: 'UTF-8',
      encodingSource: 'BOM',
      bom: true,
      delimiter: ';',
    });
    expect(inspection.sheets[0]!.previewRows[0]!.cells.map((cell) => cell.text)).toEqual([
      'STYLE',
      'PREIS',
    ]);
  });

  it('reads UTF-16LE files with a BOM and Windows-1252 files when that encoding is chosen', async () => {
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('NAME\nCafé\n', 'utf16le'),
    ]);
    expect((await readAllRows(utf16, csvSettings({ delimiter: ',' }))).map(texts)).toEqual([
      ['NAME'],
      ['Café'],
    ]);

    const latin = Buffer.from([0x4e, 0x41, 0x4d, 0x45, 0x0a, 0x43, 0x61, 0x66, 0xe9, 0x0a]);
    await expect(
      csv.inspect(sourceFromBuffer(latin), csvSettings(), limits()),
    ).rejects.toMatchObject({
      code: 'ENCODING_INVALID',
      message: expect.stringContaining('Windows-1252') as string,
    });
    const rows = await readAllRows(
      latin,
      csvSettings({ delimiter: ',', encoding: 'WINDOWS-1252' }),
    );
    expect(rows.map(texts)).toEqual([['NAME'], ['Café']]);
  });

  it('handles CR-only and mixed-free line endings, blank lines and trailing empty cells', async () => {
    const rows = await readAllRows(utf8('A,B,,\r\r1,2,,\r'), csvSettings({ delimiter: ',' }));
    expect(rows.map((row) => [row.rowNumber, texts(row)])).toEqual([
      [1, ['A', 'B']],
      [2, []],
      [3, ['1', '2']],
    ]);
  });

  it('keeps duplicate header names as separate columns', async () => {
    const inspection = await csv.inspect(
      sourceFromBuffer(utf8('PRICE,PRICE,\n1,2,3\n')),
      csvSettings(),
      limits(),
    );
    expect(inspection.sheets[0]!.previewRows[0]!.cells.map((cell) => cell.text)).toEqual([
      'PRICE',
      'PRICE',
    ]);
    expect(inspection.sheets[0]!.columnCount).toBe(3);
  });

  it('streams 12,000 rows and counts them without reading the file into rows first', async () => {
    const body = Array.from(
      { length: 12_000 },
      (_, index) => `YT${index},XL,${(index % 900) + 1}.95`,
    ).join('\n');
    const buffer = utf8(`STYLE,SIZE,PRICE\n${body}\n`);
    const inspection = await csv.inspect(sourceFromBuffer(buffer), csvSettings(), limits());
    expect(inspection.sheets[0]).toMatchObject({ nonBlankRows: 12_001, columnCount: 3 });
    expect(inspection.sheets[0]!.previewRows).toHaveLength(25);
    let count = 0;
    for await (const row of csv.rows(
      sourceFromBuffer(buffer),
      csvSettings({ delimiter: ',' }),
      limits(),
    )) {
      count += 1;
      if (count === 12_001) expect(texts(row)).toEqual(['YT11999', 'XL', '300.95']);
    }
    expect(count).toBe(12_001);
  });
});

describe('delimiter detection suggests, never silently guesses', () => {
  it.each([
    ['comma', 'a,b,c\n1,2,3\n4,5,6\n', ','],
    ['semicolon with decimal commas', 'STYLE;PRICE\nYT1;39,95\nYT2;1.234,50\n', ';'],
    ['tab', 'a\tb\n1\t2\n', '\t'],
    ['pipe', 'a|b|c\n1|2|3\n', '|'],
  ])('%s', (_label, text, delimiter) => {
    expect(detectDelimiters(text, true)).toEqual({
      candidates: [delimiter],
      suggested: delimiter,
      ambiguous: false,
    });
  });

  it('reports ambiguity when several delimiters split the file consistently', async () => {
    const text = 'name;code,qty\nshirt;A,1\npants;B,2\n';
    expect(detectDelimiters(text, true)).toMatchObject({ candidates: [',', ';'], ambiguous: true });
    const inspection = await csv.inspect(sourceFromBuffer(utf8(text)), csvSettings(), limits());
    expect(inspection.csv?.delimiterAmbiguous).toBe(true);
    expect(inspection.issues).toMatchObject([{ code: 'DELIMITER_AMBIGUOUS' }]);
    // Once the user has chosen, the file is no longer ambiguous.
    const chosen = await csv.inspect(
      sourceFromBuffer(utf8(text)),
      csvSettings({ delimiter: ';' }),
      limits(),
    );
    expect(chosen.csv).toMatchObject({ delimiter: ';', delimiterAmbiguous: false });
    expect(chosen.issues).toEqual([]);
  });

  it('a single-column file has no candidates and is not ambiguous', () => {
    expect(detectDelimiters('GTIN\n9501234567891\n', true)).toEqual({
      candidates: [],
      suggested: ',',
      ambiguous: false,
    });
  });
});

describe('malformed and oversized CSV is refused with a clear message', () => {
  it.each([
    ['an unclosed quote', 'a,b\n"never closed,1\n', /never closed \(line 2\)/],
    ['a stray quote in an unquoted value', 'a,b\n12" ruler,1\n', /not correctly quoted/],
    ['text after a closing quote', 'a,b\n"abc"def,1\n', /not correctly quoted/],
  ])('%s', async (_label, text, message) => {
    const error = await readAllRows(utf8(text), csvSettings({ delimiter: ',' })).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SourceReadError);
    expect(error).toMatchObject({
      code: 'MALFORMED_FILE',
      message: expect.stringMatching(message) as string,
    });
  });

  it('a NUL character anywhere in the text (binary data or the wrong encoding)', async () => {
    const text = `NAME,PRICE\n${'ok,1\n'.repeat(2000)}bad${String.fromCharCode(0)}value,2\n`;
    await expect(readAllRows(utf8(text), csvSettings({ delimiter: ',' }))).rejects.toMatchObject({
      code: 'MALFORMED_FILE',
      message: expect.stringMatching(/row 2002, column A contains a NUL character/) as string,
    });
  });

  it('an oversized field', async () => {
    const text = `NAME\n${'x'.repeat(120)}\n`;
    await expect(
      readAllRows(utf8(text), csvSettings({ delimiter: ',' }), limits({ maxCellChars: 100 })),
    ).rejects.toMatchObject({
      code: 'FILE_LIMIT_EXCEEDED',
      message: 'The cell in row 2, column A is longer than 100 characters.',
    });
  });

  it('too many columns', async () => {
    const text = `${Array.from({ length: 12 }, (_, index) => `C${index}`).join(',')}\n`;
    await expect(
      readAllRows(utf8(text), csvSettings({ delimiter: ',' }), limits({ maxColumns: 10 })),
    ).rejects.toMatchObject({
      code: 'FILE_LIMIT_EXCEEDED',
      message: 'Row 1 has 12 columns; at most 10 are supported.',
    });
  });

  it('more data rows than allowed makes the file unusable', async () => {
    const buffer = utf8(buildCsv([['A'], ['1'], ['2'], ['3'], ['4']]));
    const inspection = await csv.inspect(
      sourceFromBuffer(buffer),
      csvSettings(),
      limits({ maxRows: 3 }),
    );
    expect(inspection.sheets[0]!.issues).toMatchObject([
      { code: 'FILE_LIMIT_EXCEEDED', severity: 'ERROR' },
    ]);
  });

  it('an empty file', async () => {
    await expect(
      csv.inspect(sourceFromBuffer(utf8('')), csvSettings(), limits()),
    ).rejects.toMatchObject({ code: 'NO_SHEETS' });
  });
});

describe('parser traceability', () => {
  it('records the exact library versions that are installed', () => {
    const version = (name: string) =>
      (
        JSON.parse(
          readFileSync(resolve(__dirname, '../../../node_modules', name, 'package.json'), 'utf8'),
        ) as { version: string }
      ).version;
    expect(CSV_PARSER_INFO.libraries['csv-parse']).toBe(version('csv-parse'));
    expect(XLSX_PARSER_INFO.libraries.yauzl).toBe(version('yauzl'));
    expect(XLSX_PARSER_INFO.libraries.sax).toBe(version('sax'));
  });
});
