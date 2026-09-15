/**
 * @smarttag/tabular-sources
 *
 * Readers for untrusted tabular files behind one contract (TabularSourceParser):
 *
 *   CsvSourceParser   csv-parse, streamed; explicit encoding and delimiter; RFC 4180 quoting
 *   XlsxSourceParser  yauzl (ZIP, with decompression limits) + sax (XML, no DTDs); cached formula
 *                     results only, never evaluated; external links never followed
 *
 * Output is the source model of @smarttag/import-core; everything after reading is shared.
 */
import type { SourceFormat } from '@smarttag/import-core';
import { CsvSourceParser } from './csv';
import type { TabularSourceParser } from './parser';
import { XlsxSourceParser } from './xlsx';

export * from './csv';
export * from './detect';
export * from './errors';
export * from './parser';
export { XLSX_PARSER_INFO, XlsxSourceParser } from './xlsx';
export { isDateFormatCode } from './xlsx/workbook';
export { WorkbookZip } from './xlsx/zip';

const PARSERS: Readonly<Record<SourceFormat, TabularSourceParser>> = {
  CSV: new CsvSourceParser(),
  XLSX: new XlsxSourceParser(),
};

export function parserFor(format: SourceFormat): TabularSourceParser {
  return PARSERS[format];
}
