import type { ImportLimits } from '@smarttag/import-core';
import { SourceReadError } from '../errors';
import { attribute, parseXmlPart } from './xml';
import { normalizePartName, type WorkbookZip } from './zip';

/** Small package parts (content types, relationships, workbook, styles). */
const SMALL_PART_BYTES = 16 * 1024 * 1024;

export interface WorkbookSheetInfo {
  readonly name: string;
  readonly index: number;
  readonly visible: boolean;
  /** Normalized part name of the worksheet XML. */
  readonly part: string;
}

export interface WorkbookStructure {
  readonly date1904: boolean;
  readonly externalLinks: boolean;
  readonly sheets: readonly WorkbookSheetInfo[];
  readonly sharedStringsPart: string | null;
  readonly stylesPart: string | null;
}

export interface CellStyles {
  /** Style index (the cell's `s` attribute) → the value is a date/time. */
  readonly date: readonly boolean[];
  /** Style index → digits of an all-zero number format ("00000"), or 0. */
  readonly zeroPad: readonly number[];
}

const MACRO_CONTENT_TYPE = /macroEnabled/i;
const BINARY_WORKBOOK_CONTENT_TYPE = /sheet\.binary/i;

function resolveTarget(base: string, target: string): string {
  if (target.startsWith('/')) return normalizePartName(target);
  const parts = base.split('/').slice(0, -1);
  for (const segment of target.replace(/\\/g, '/').split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment !== '') parts.push(segment);
  }
  return normalizePartName(parts.join('/'));
}

async function readRelationships(zip: WorkbookZip, relsPart: string, sourcePart: string) {
  const stream = await zip.openPart(relsPart, SMALL_PART_BYTES);
  const relationships = new Map<string, { type: string; target: string; external: boolean }>();
  if (!stream) return relationships;
  await parseXmlPart(stream, relsPart, {
    open(name, attributes) {
      if (name !== 'Relationship') return;
      const id = attribute(attributes, 'Id');
      const target = attribute(attributes, 'Target');
      if (!id || !target) return;
      const external = attribute(attributes, 'TargetMode') === 'External';
      relationships.set(id, {
        type: attribute(attributes, 'Type') ?? '',
        target: external ? target : resolveTarget(sourcePart, target),
        external,
      });
    },
  });
  return relationships;
}

/**
 * Reads the package structure. Refuses macro-enabled and binary workbooks even when they were
 * renamed to .xlsx. External links are noted but never followed: only cached values stored in
 * this file are read.
 */
export async function readWorkbookStructure(
  zip: WorkbookZip,
  limits: ImportLimits,
): Promise<WorkbookStructure> {
  if (zip.has('xl/vbaProject.bin') || zip.names().some((name) => name.endsWith('vbaproject.bin'))) {
    throw new SourceReadError(
      'MACROS_NOT_SUPPORTED',
      'The workbook contains macros. Save it as XLSX without macros or as CSV.',
    );
  }
  if (zip.has('xl/workbook.bin')) {
    throw new SourceReadError(
      'UNSUPPORTED_IMPORT_FORMAT',
      'Binary workbooks (.xlsb) are not supported. Save the workbook as XLSX or CSV.',
    );
  }
  const contentTypes = await zip.openPart('[Content_Types].xml', SMALL_PART_BYTES);
  if (!contentTypes)
    throw new SourceReadError(
      'MALFORMED_FILE',
      'The XLSX file is not a valid workbook (no content types).',
    );
  let macro = false;
  let binary = false;
  await parseXmlPart(contentTypes, '[Content_Types].xml', {
    open(_name, attributes) {
      const type = attribute(attributes, 'ContentType') ?? '';
      if (MACRO_CONTENT_TYPE.test(type)) macro = true;
      if (BINARY_WORKBOOK_CONTENT_TYPE.test(type)) binary = true;
    },
  });
  if (macro)
    throw new SourceReadError(
      'MACROS_NOT_SUPPORTED',
      'Macro-enabled workbooks are not supported. Save the workbook as XLSX without macros or as CSV.',
    );
  if (binary)
    throw new SourceReadError(
      'UNSUPPORTED_IMPORT_FORMAT',
      'Binary workbooks (.xlsb) are not supported. Save the workbook as XLSX or CSV.',
    );

  const rootRelationships = await readRelationships(zip, '_rels/.rels', '');
  const officeDocument = [...rootRelationships.values()].find((relationship) =>
    relationship.type.endsWith('/officeDocument'),
  );
  const workbookPart =
    officeDocument && !officeDocument.external ? officeDocument.target : 'xl/workbook.xml';
  const workbookStream = await zip.openPart(workbookPart, SMALL_PART_BYTES);
  if (!workbookStream)
    throw new SourceReadError(
      'MALFORMED_FILE',
      'The XLSX file is not a valid workbook (no workbook part).',
    );

  const declaredSheets: { name: string; relationshipId: string; visible: boolean }[] = [];
  let date1904 = false;
  let externalLinks = false;
  await parseXmlPart(workbookStream, workbookPart, {
    open(name, attributes) {
      if (name === 'workbookPr') {
        const value = attribute(attributes, 'date1904');
        date1904 = value === '1' || value === 'true';
      } else if (name === 'sheet') {
        declaredSheets.push({
          name: attribute(attributes, 'name') ?? `Sheet${declaredSheets.length + 1}`,
          relationshipId: attribute(attributes, 'id') ?? '',
          visible: (attribute(attributes, 'state') ?? 'visible') === 'visible',
        });
      } else if (name === 'externalReference') {
        externalLinks = true;
      }
    },
  });

  const relsPart = `${workbookPart.split('/').slice(0, -1).join('/')}/_rels/${workbookPart.split('/').pop()}.rels`;
  const relationships = await readRelationships(zip, relsPart, workbookPart);
  const byType = (suffix: string) =>
    [...relationships.values()].find(
      (relationship) => relationship.type.endsWith(suffix) && !relationship.external,
    );

  const sheets: WorkbookSheetInfo[] = [];
  for (const declared of declaredSheets) {
    const relationship = relationships.get(declared.relationshipId);
    // Chart sheets, dialog sheets and macro sheets are not tabular data.
    if (!relationship || relationship.external || !relationship.type.endsWith('/worksheet'))
      continue;
    if (!zip.has(relationship.target)) continue;
    sheets.push({
      name: declared.name,
      index: sheets.length,
      visible: declared.visible,
      part: relationship.target,
    });
  }
  if (sheets.length === 0) {
    throw new SourceReadError('NO_SHEETS', 'The workbook contains no worksheets.');
  }
  if (sheets.length > limits.maxSheets) {
    throw new SourceReadError(
      'WORKBOOK_LIMIT_EXCEEDED',
      `The workbook has ${sheets.length} worksheets; at most ${limits.maxSheets} are supported.`,
    );
  }
  return {
    date1904,
    externalLinks:
      externalLinks ||
      [...relationships.values()].some((relationship) =>
        relationship.type.endsWith('/externalLink'),
      ),
    sheets,
    sharedStringsPart: byType('/sharedStrings')?.target ?? null,
    stylesPart: byType('/styles')?.target ?? null,
  };
}

/** Built-in number formats that display dates and times (including East Asian locale variants). */
function isBuiltInDateFormat(id: number): boolean {
  return (
    (id >= 14 && id <= 22) ||
    (id >= 27 && id <= 36) ||
    (id >= 45 && id <= 47) ||
    (id >= 50 && id <= 58)
  );
}

/** A custom format code shows a date or time when, outside quoted text, escapes and brackets, it uses d, m, y, h or s. */
export function isDateFormatCode(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/_./g, '')
    .replace(/\*./g, '')
    .replace(/\[(h+|m+|s+)\]/gi, 'h')
    .replace(/\[[^\]]*\]/g, '');
  // Only the first section (positive numbers) decides.
  const section = stripped.split(';')[0] ?? '';
  return /[dmyhs]/i.test(section) && !/^general$/i.test(section.trim());
}

export async function readCellStyles(zip: WorkbookZip, part: string | null): Promise<CellStyles> {
  if (!part) return { date: [], zeroPad: [] };
  const stream = await zip.openPart(part, SMALL_PART_BYTES);
  if (!stream) return { date: [], zeroPad: [] };
  const customFormats = new Map<number, string>();
  const xfFormats: number[] = [];
  let inCellXfs = false;
  await parseXmlPart(stream, part, {
    open(name, attributes) {
      if (name === 'numFmt') {
        const id = Number(attribute(attributes, 'numFmtId'));
        if (Number.isInteger(id)) customFormats.set(id, attribute(attributes, 'formatCode') ?? '');
      } else if (name === 'cellXfs') {
        inCellXfs = true;
      } else if (name === 'xf' && inCellXfs) {
        xfFormats.push(Number(attribute(attributes, 'numFmtId') ?? '0'));
      }
    },
    close(name) {
      if (name === 'cellXfs') inCellXfs = false;
    },
  });
  return {
    date: xfFormats.map((id) => {
      const custom = customFormats.get(id);
      return custom === undefined ? isBuiltInDateFormat(id) : isDateFormatCode(custom);
    }),
    zeroPad: xfFormats.map((id) => {
      const custom = customFormats.get(id);
      return custom !== undefined && /^0+$/.test(custom) ? custom.length : 0;
    }),
  };
}

/** Decodes OOXML "_xHHHH_" escapes used for characters XML cannot hold (e.g. "_x000D_"). */
export function decodeXmlStringEscapes(text: string): string {
  if (!text.includes('_x')) return text;
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

export async function readSharedStrings(
  zip: WorkbookZip,
  part: string | null,
  limits: ImportLimits,
): Promise<string[]> {
  if (!part) return [];
  const stream = await zip.openPart(part, limits.xlsxMaxSharedStringsBytes);
  if (!stream) return [];
  const strings: string[] = [];
  let current: string[] | null = null;
  let length = 0;
  let inText = false;
  let phonetic = 0;
  await parseXmlPart(stream, part, {
    open(name) {
      if (name === 'si') {
        current = [];
        length = 0;
      } else if (name === 'rPh') {
        phonetic += 1;
      } else if (name === 't' && current && phonetic === 0) {
        inText = true;
      }
    },
    text(value) {
      if (!inText || !current) return;
      // Longer strings are kept only up to one character past the cell limit, so every cell
      // that uses one fails the cell length check instead of being silently shortened.
      const room = limits.maxCellChars + 1 - length;
      if (room > 0) current.push(value.length > room ? value.slice(0, room) : value);
      length += value.length;
    },
    close(name) {
      if (name === 't') inText = false;
      else if (name === 'rPh') phonetic -= 1;
      else if (name === 'si' && current) {
        strings.push(decodeXmlStringEscapes(current.join('')));
        current = null;
      }
    },
  });
  // The part stream itself is limited to xlsxMaxSharedStringsBytes (WorkbookZip.openPart).
  return strings;
}
