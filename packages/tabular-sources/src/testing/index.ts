import { columnLetter } from '@smarttag/import-core';
import { strToU8, zipSync, type Zippable } from 'fflate';

/**
 * Test-only builders for XLSX workbooks written like spreadsheet applications write them (shared
 * strings, styles with date formats, cached formula results, inline strings, hidden sheets). Used by
 * unit, integration and browser tests; never by production code.
 */
export type CellSpec =
  | string
  | number
  | boolean
  | null
  | { readonly inline: string }
  | { readonly date: number; readonly withTime?: boolean }
  | { readonly zeroPadded: number }
  | { readonly error: string }
  | {
      readonly formula: string;
      /** Cached result saved with the formula; omitted = no cached value. */
      readonly cached?: string | number | boolean;
    };

export interface SheetSpec {
  readonly name: string;
  /** Rows from row 1; use `{ rowNumber, cells }` to leave gaps. */
  readonly rows: readonly (
    readonly CellSpec[] | { readonly rowNumber: number; readonly cells: readonly CellSpec[] }
  )[];
  readonly hidden?: boolean;
  readonly mergedCells?: readonly string[];
}

export interface WorkbookSpec {
  readonly sheets: readonly SheetSpec[];
  readonly date1904?: boolean;
  /** Link to an external workbook (never followed). */
  readonly externalLink?: boolean;
  /** Extra package parts, e.g. "xl/vbaProject.bin". */
  readonly extraParts?: Readonly<Record<string, string | Uint8Array>>;
  /** Replaces the workbook content type (e.g. the macro-enabled one). */
  readonly workbookContentType?: string;
  /** DEFLATE level (0 stores parts uncompressed). */
  readonly level?: 0 | 1 | 6 | 9;
}

const STYLE_DATE = 1;
const STYLE_DATE_TIME = 2;
const STYLE_ZERO_PAD = 3;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildXlsxWorkbook(spec: WorkbookSpec): Buffer {
  const sharedStrings: string[] = [];
  const sharedIndex = new Map<string, number>();
  const shared = (text: string) => {
    let index = sharedIndex.get(text);
    if (index === undefined) {
      index = sharedStrings.length;
      sharedStrings.push(text);
      sharedIndex.set(text, index);
    }
    return index;
  };

  const cellXml = (reference: string, cell: CellSpec): string => {
    if (cell === null) return '';
    if (typeof cell === 'string') return `<c r="${reference}" t="s"><v>${shared(cell)}</v></c>`;
    if (typeof cell === 'number') return `<c r="${reference}"><v>${cell}</v></c>`;
    if (typeof cell === 'boolean') return `<c r="${reference}" t="b"><v>${cell ? 1 : 0}</v></c>`;
    if ('inline' in cell) {
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.inline)}</t></is></c>`;
    }
    if ('date' in cell) {
      return `<c r="${reference}" s="${cell.withTime ? STYLE_DATE_TIME : STYLE_DATE}"><v>${cell.date}</v></c>`;
    }
    if ('zeroPadded' in cell)
      return `<c r="${reference}" s="${STYLE_ZERO_PAD}"><v>${cell.zeroPadded}</v></c>`;
    if ('error' in cell) return `<c r="${reference}" t="e"><v>${escapeXml(cell.error)}</v></c>`;
    const formula = `<f>${escapeXml(cell.formula)}</f>`;
    if (cell.cached === undefined) return `<c r="${reference}">${formula}</c>`;
    if (typeof cell.cached === 'string') {
      return `<c r="${reference}" t="str">${formula}<v>${escapeXml(cell.cached)}</v></c>`;
    }
    if (typeof cell.cached === 'boolean') {
      return `<c r="${reference}" t="b">${formula}<v>${cell.cached ? 1 : 0}</v></c>`;
    }
    return `<c r="${reference}">${formula}<v>${cell.cached}</v></c>`;
  };

  const files: Zippable = {};
  const sheetEntries = spec.sheets.map((sheet, sheetIndex) => {
    let rowNumber = 0;
    const rows = sheet.rows
      .map((row) => {
        const cells = Array.isArray(row)
          ? (row as readonly CellSpec[])
          : (row as { cells: readonly CellSpec[] }).cells;
        rowNumber = Array.isArray(row) ? rowNumber + 1 : (row as { rowNumber: number }).rowNumber;
        const xml = cells
          .map((cell, column) => cellXml(`${columnLetter(column)}${rowNumber}`, cell))
          .join('');
        return `<row r="${rowNumber}">${xml}</row>`;
      })
      .join('');
    const merges = sheet.mergedCells?.length
      ? `<mergeCells count="${sheet.mergedCells.length}">${sheet.mergedCells.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
      : '';
    files[`xl/worksheets/sheet${sheetIndex + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${rows}</sheetData>${merges}</worksheet>`,
    );
    return sheet;
  });

  const workbookType =
    spec.workbookContentType ??
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${workbookType}"/>${sheetEntries
      .map(
        (_, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join(
        '',
      )}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
  );
  files['_rels/.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr${spec.date1904 ? ' date1904="1"' : ''}/><sheets>${sheetEntries
      .map(
        (sheet, index) =>
          `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}"${sheet.hidden ? ' state="hidden"' : ''} r:id="rId${index + 1}"/>`,
      )
      .join(
        '',
      )}</sheets>${spec.externalLink ? '<externalReferences><externalReference r:id="rIdExt"/></externalReferences>' : ''}</workbook>`,
  );
  const sheetCount = sheetEntries.length;
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetEntries
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join(
        '',
      )}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheetCount + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>${spec.externalLink ? '<Relationship Id="rIdExt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="https://attacker.example/book.xlsx" TargetMode="External"/>' : ''}</Relationships>`,
  );
  files['xl/styles.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/><numFmt numFmtId="165" formatCode="0000000000000"/></numFmts><cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" xfId="0"/><xf numFmtId="14" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>',
  );
  files['xl/sharedStrings.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sharedStrings
      .map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`)
      .join('')}</sst>`,
  );
  for (const [name, content] of Object.entries(spec.extraParts ?? {})) {
    files[name] = typeof content === 'string' ? strToU8(content) : content;
  }
  return Buffer.from(zipSync(files, { level: spec.level ?? 6 }));
}

/** A ZIP archive with the given entries (for adversarial container tests). */
export function buildZip(
  entries: Readonly<Record<string, string | Uint8Array>>,
  level: 0 | 6 | 9 = 6,
): Buffer {
  const files: Zippable = {};
  for (const [name, content] of Object.entries(entries)) {
    files[name] = typeof content === 'string' ? strToU8(content) : content;
  }
  return Buffer.from(zipSync(files, { level }));
}

/** CSV text with CRLF line endings; values are quoted when needed (RFC 4180). */
export function buildCsv(rows: readonly (readonly string[])[], delimiter = ','): string {
  return rows
    .map((row) =>
      row
        .map((value) =>
          /[",\r\n;\t|]/.test(value) || value !== value.trim()
            ? `"${value.replace(/"/g, '""')}"`
            : value,
        )
        .join(delimiter),
    )
    .join('\r\n')
    .concat('\r\n');
}
