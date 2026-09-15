import http from 'node:http';
import https from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectSourceFormat, parserFor, sourceFromBuffer, WorkbookZip } from '../src';
import { buildXlsxWorkbook, buildZip } from '../src/testing';
import { limits, patchDeclaredSize, readAllRows, xlsxSettings } from './helpers';

const xlsx = parserFor('XLSX');
const simple = () => buildXlsxWorkbook({ sheets: [{ name: 'Data', rows: [['A'], ['1']] }] });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ZIP bombs and container limits', () => {
  it('refuses a highly compressed part before inflating it', async () => {
    const bomb = buildXlsxWorkbook({
      sheets: [{ name: 'Data', rows: [['A']] }],
      extraParts: { 'xl/media/padding.bin': new Uint8Array(24 * 1024 * 1024) },
      level: 9,
    });
    expect(bomb.length).toBeLessThan(200 * 1024);
    await expect(
      xlsx.inspect(sourceFromBuffer(bomb), xlsxSettings(), limits()),
    ).rejects.toMatchObject({
      code: 'WORKBOOK_LIMIT_EXCEEDED',
      message: expect.stringMatching(/compressed \d+:1/) as string,
    });
  });

  it('refuses workbooks whose parts declare more uncompressed bytes than allowed', async () => {
    const random = new Uint8Array(3 * 1024 * 1024).map((_, index) => (index * 2654435761) % 251);
    const large = buildXlsxWorkbook({
      sheets: [{ name: 'Data', rows: [['A']] }],
      extraParts: { 'xl/media/big.bin': random },
    });
    await expect(
      xlsx.inspect(
        sourceFromBuffer(large),
        xlsxSettings(),
        limits({ xlsxMaxUncompressedBytes: 2 * 1024 * 1024 }),
      ),
    ).rejects.toMatchObject({ code: 'WORKBOOK_LIMIT_EXCEEDED' });
  });

  it('never inflates more than a part declares (lying size headers)', async () => {
    const sheetXml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${'<row><c t="inlineStr"><is><t>x</t></is></c></row>'.repeat(20_000)}</sheetData></worksheet>`;
    const honest = buildXlsxWorkbook({
      sheets: [{ name: 'Data', rows: [['A']] }],
      extraParts: { 'xl/worksheets/sheet1.xml': sheetXml },
    });
    const lying = patchDeclaredSize(honest, 'xl/worksheets/sheet1.xml', 200);
    await expect(
      xlsx.inspect(sourceFromBuffer(lying), xlsxSettings(), limits()),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/MALFORMED_FILE|WORKBOOK_LIMIT_EXCEEDED/) as string,
    });
  });

  it('refuses too many ZIP entries and too many worksheets', async () => {
    const parts = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`xl/media/${index}.txt`, 'x']),
    );
    const crowded = buildXlsxWorkbook({
      sheets: [{ name: 'Data', rows: [['A']] }],
      extraParts: parts,
    });
    await expect(
      xlsx.inspect(sourceFromBuffer(crowded), xlsxSettings(), limits({ xlsxMaxEntries: 16 })),
    ).rejects.toMatchObject({
      code: 'WORKBOOK_LIMIT_EXCEEDED',
    });
    const manySheets = buildXlsxWorkbook({
      sheets: ['A', 'B', 'C'].map((name) => ({ name, rows: [['x']] })),
    });
    await expect(
      xlsx.inspect(sourceFromBuffer(manySheets), xlsxSettings(), limits({ maxSheets: 2 })),
    ).rejects.toMatchObject({
      code: 'WORKBOOK_LIMIT_EXCEEDED',
      message: 'The workbook has 3 worksheets; at most 2 are supported.',
    });
  });

  it('refuses shared strings larger than allowed', async () => {
    const book = buildXlsxWorkbook({
      sheets: [
        {
          name: 'Data',
          rows: [Array.from({ length: 50 }, (_, index) => `text ${index} ${'y'.repeat(100)}`)],
        },
      ],
    });
    await expect(
      xlsx.inspect(
        sourceFromBuffer(book),
        xlsxSettings(),
        limits({ xlsxMaxSharedStringsBytes: 2048 }),
      ),
    ).rejects.toMatchObject({
      code: 'WORKBOOK_LIMIT_EXCEEDED',
    });
  });

  it('refuses damaged and non-workbook archives', async () => {
    await expect(
      xlsx.inspect(
        sourceFromBuffer(Buffer.from('PK\u0003\u0004garbage-not-a-zip')),
        xlsxSettings(),
        limits(),
      ),
    ).rejects.toMatchObject({
      code: 'MALFORMED_FILE',
    });
    const truncated = simple().subarray(0, 300);
    await expect(
      xlsx.inspect(sourceFromBuffer(truncated), xlsxSettings(), limits()),
    ).rejects.toMatchObject({ code: 'MALFORMED_FILE' });
    const plainZip = buildZip({ 'readme.txt': 'not a workbook' });
    await expect(
      xlsx.inspect(sourceFromBuffer(plainZip), xlsxSettings(), limits()),
    ).rejects.toMatchObject({ code: 'MALFORMED_FILE' });
    const noSheets = buildXlsxWorkbook({ sheets: [] });
    await expect(
      xlsx.inspect(sourceFromBuffer(noSheets), xlsxSettings(), limits()),
    ).rejects.toMatchObject({ code: 'NO_SHEETS' });
  });
});

describe('XML attacks', () => {
  it('refuses DOCTYPE declarations (entity expansion, external entities)', async () => {
    const billionLaughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="&lol2;" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>`;
    const externalEntity = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="&xxe;" sheetId="1"/></sheets></workbook>`;
    for (const workbookXml of [billionLaughs, externalEntity]) {
      const book = buildXlsxWorkbook({
        sheets: [{ name: 'Data', rows: [['A']] }],
        extraParts: { 'xl/workbook.xml': workbookXml },
      });
      await expect(
        xlsx.inspect(sourceFromBuffer(book), xlsxSettings(), limits()),
      ).rejects.toMatchObject({
        code: 'MALFORMED_FILE',
        message: expect.stringContaining('DOCTYPE') as string,
      });
    }
  });

  it('refuses malformed worksheet XML', async () => {
    const book = buildXlsxWorkbook({
      sheets: [{ name: 'Data', rows: [['A']] }],
      extraParts: {
        'xl/worksheets/sheet1.xml':
          '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></row></sheetData>',
      },
    });
    await expect(
      xlsx.inspect(sourceFromBuffer(book), xlsxSettings(), limits()),
    ).rejects.toMatchObject({ code: 'MALFORMED_FILE' });
  });
});

describe('macros, formulas and external links', () => {
  it('refuses macro content even in a file named .xlsx', async () => {
    const withVba = buildXlsxWorkbook({
      sheets: [{ name: 'Data', rows: [['A']] }],
      extraParts: { 'xl/vbaProject.bin': new Uint8Array([1, 2, 3]) },
    });
    await expect(
      xlsx.inspect(sourceFromBuffer(withVba), xlsxSettings(), limits()),
    ).rejects.toMatchObject({ code: 'MACROS_NOT_SUPPORTED' });
    const macroType = buildXlsxWorkbook({
      sheets: [{ name: 'Data', rows: [['A']] }],
      workbookContentType: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
    });
    await expect(
      xlsx.inspect(sourceFromBuffer(macroType), xlsxSettings(), limits()),
    ).rejects.toMatchObject({ code: 'MACROS_NOT_SUPPORTED' });
  });

  it('never evaluates formulas: only cached results are read', async () => {
    const book = buildXlsxWorkbook({
      sheets: [
        {
          name: 'Data',
          rows: [
            ['A'],
            [{ formula: 'WEBSERVICE("https://attacker.example/")', cached: 'cached text' }],
            [{ formula: 'NOW()' }],
            [{ formula: '1+1', cached: 3 }],
          ],
        },
      ],
    });
    const rows = await readAllRows(book, xlsxSettings('Data'));
    expect(rows.slice(1).map((row) => row.cells[0])).toEqual([
      { kind: 'TEXT', text: 'cached text', formula: true },
      { kind: 'EMPTY', formula: true },
      // The stored result is used as is (3), never recalculated (2).
      { kind: 'NUMBER', value: 3, formula: true },
    ]);
  });

  it('notes external workbook links but never follows them', async () => {
    const request = vi.spyOn(http, 'request');
    const secure = vi.spyOn(https, 'request');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const book = buildXlsxWorkbook({
      sheets: [{ name: 'Data', rows: [['A'], [{ formula: '[1]Sheet1!A1', cached: 5 }]] }],
      externalLink: true,
    });
    const inspection = await xlsx.inspect(sourceFromBuffer(book), xlsxSettings(), limits());
    await readAllRows(book, xlsxSettings('Data'));
    expect(inspection.workbook?.externalLinks).toBe(true);
    expect(inspection.issues).toMatchObject([{ code: 'EXTERNAL_LINKS_IGNORED' }]);
    expect(request).not.toHaveBeenCalled();
    expect(secure).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('cell, row and column limits in workbooks', () => {
  it('an oversized cell makes its sheet unusable (other sheets stay usable)', async () => {
    const book = buildXlsxWorkbook({
      sheets: [
        { name: 'Big', rows: [['A'], ['x'.repeat(150)]] },
        { name: 'Small', rows: [['A'], ['ok']] },
      ],
    });
    const inspection = await xlsx.inspect(
      sourceFromBuffer(book),
      xlsxSettings(),
      limits({ maxCellChars: 100 }),
    );
    expect(inspection.sheets[0]!.issues).toMatchObject([
      { code: 'FILE_LIMIT_EXCEEDED', severity: 'ERROR' },
    ]);
    expect(inspection.sheets[1]!.issues).toEqual([]);
    await expect(
      readAllRows(book, xlsxSettings('Big'), limits({ maxCellChars: 100 })),
    ).rejects.toMatchObject({ code: 'FILE_LIMIT_EXCEEDED' });
  });

  it('values beyond the column limit are refused; formatting-only cells are ignored', async () => {
    const wide = buildXlsxWorkbook({
      sheets: [{ name: 'Wide', rows: [Array.from({ length: 12 }, (_, index) => `C${index}`)] }],
    });
    const inspection = await xlsx.inspect(
      sourceFromBuffer(wide),
      xlsxSettings(),
      limits({ maxColumns: 10 }),
    );
    expect(inspection.sheets[0]!.issues).toMatchObject([{ code: 'FILE_LIMIT_EXCEEDED' }]);
    const styled = buildXlsxWorkbook({
      sheets: [{ name: 'Styled', rows: [['A']] }],
      extraParts: {
        'xl/worksheets/sheet1.xml':
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c><c r="XFD1" s="1"/></row></sheetData></worksheet>',
      },
    });
    const rows = await readAllRows(styled, xlsxSettings('Styled'), limits({ maxColumns: 10 }));
    expect(rows[0]!.cells).toEqual([{ kind: 'TEXT', text: 'A' }]);
  });

  it('more data rows than allowed makes the sheet unusable', async () => {
    const book = buildXlsxWorkbook({
      sheets: [{ name: 'Rows', rows: [['A'], ['1'], ['2'], ['3']] }],
    });
    const inspection = await xlsx.inspect(
      sourceFromBuffer(book),
      xlsxSettings(),
      limits({ maxRows: 2 }),
    );
    expect(inspection.sheets[0]!.issues).toMatchObject([{ code: 'FILE_LIMIT_EXCEEDED' }]);
  });
});

describe('format detection trusts content, not names or MIME types', () => {
  const zipHead = simple().subarray(0, 16);
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);

  it.each([
    ['tags.csv', Buffer.from('STYLE,SIZE\n'), 'CSV'],
    ['TAGS.CSV', Buffer.from('STYLE,SIZE\n'), 'CSV'],
    ['tags.xlsx', zipHead, 'XLSX'],
  ])('accepts %s', (name, head, format) => {
    expect(detectSourceFormat(name, head)).toMatchObject({ ok: true, format });
  });

  it.each([
    ['legacy.xls', ole, /Legacy XLS .* is not supported. Save the workbook as XLSX or CSV/],
    ['macro.xlsm', zipHead, /Macro-enabled workbooks/],
    ['binary.xlsb', zipHead, /Binary workbooks/],
    ['open.ods', zipHead, /OpenDocument/],
    ['renamed.csv', zipHead, /not CSV text: it is a ZIP archive/],
    ['renamed.csv', ole, /legacy Office document/],
    ['image.csv', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), /PNG image/],
    ['binary.csv', Buffer.from([0x41, 0x00, 0x42]), /binary data/],
    ['encrypted.xlsx', ole, /legacy \(XLS\) or password-protected/],
    ['fake.xlsx', Buffer.from('STYLE,SIZE'), /not an XLSX workbook/],
    ['data.json', Buffer.from('{}'), /\.json files are not supported/],
    ['noextension', Buffer.from('a,b'), /no extension/],
  ])('refuses %s', (name, head, message) => {
    const result = detectSourceFormat(name, head);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNSUPPORTED_IMPORT_FORMAT');
      expect(result.message).toMatch(message);
    }
  });

  it('opens a valid container only once limits pass', async () => {
    const zip = await WorkbookZip.open(simple(), limits());
    expect(zip.has('XL/Workbook.xml')).toBe(true);
    zip.close();
  });
});
