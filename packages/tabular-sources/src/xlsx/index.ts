import type {
  ImportLimits,
  ParserInfo,
  SourceInspection,
  SourceIssue,
  SourceRow,
  SourceSettings,
  SourceSheet,
} from '@smarttag/import-core';
import { SourceReadError } from '../errors';
import {
  SheetInspectionBuilder,
  throwIfAborted,
  type RowReadOptions,
  type SourceInput,
  type TabularSourceParser,
} from '../parser';
import { readSheetRows, type SheetReadSummary } from './sheet';
import { readCellStyles, readSharedStrings, readWorkbookStructure } from './workbook';
import { WorkbookZip } from './zip';

export const XLSX_PARSER_INFO: ParserInfo = {
  id: 'smarttag-xlsx',
  version: '1',
  libraries: { yauzl: '3.4.0', sax: '1.6.1' },
};

async function openWorkbook(input: SourceInput, limits: ImportLimits) {
  if (input.sizeBytes > limits.maxFileBytes) {
    throw new SourceReadError(
      'FILE_LIMIT_EXCEEDED',
      'The workbook is larger than the upload limit.',
    );
  }
  const zip = await WorkbookZip.open(await input.readAll(), limits);
  try {
    const structure = await readWorkbookStructure(zip, limits);
    const [sharedStrings, styles] = await Promise.all([
      readSharedStrings(zip, structure.sharedStringsPart, limits),
      readCellStyles(zip, structure.stylesPart),
    ]);
    return { zip, structure, sharedStrings, styles };
  } catch (error) {
    zip.close();
    throw error;
  }
}

export class XlsxSourceParser implements TabularSourceParser {
  readonly format = 'XLSX' as const;
  readonly info = XLSX_PARSER_INFO;

  async inspect(
    input: SourceInput,
    _settings: SourceSettings,
    limits: ImportLimits,
  ): Promise<SourceInspection> {
    const workbook = await openWorkbook(input, limits);
    const { zip, structure } = workbook;
    try {
      const sheets: SourceSheet[] = [];
      const issues: SourceIssue[] = [];
      for (const info of structure.sheets) {
        const builder = new SheetInspectionBuilder(info.name, info.index, info.visible, limits);
        const summary: SheetReadSummary = { mergedCells: false };
        const stream = await zip.openPart(info.part, limits.xlsxMaxUncompressedBytes);
        if (!stream) continue;
        try {
          for await (const row of readSheetRows(
            stream,
            {
              sheetName: info.name,
              part: info.part,
              date1904: structure.date1904,
              sharedStrings: workbook.sharedStrings,
              styles: workbook.styles,
              limits,
            },
            summary,
          )) {
            builder.add(row);
          }
        } catch (error) {
          // One oversized sheet does not make the other sheets unusable.
          if (!(error instanceof SourceReadError) || error.code !== 'FILE_LIMIT_EXCEEDED')
            throw error;
          builder.addIssue({
            code: 'FILE_LIMIT_EXCEEDED',
            severity: 'ERROR',
            message: error.message,
          });
        }
        if (summary.mergedCells) {
          builder.addIssue({
            code: 'MERGED_CELLS_PRESENT',
            severity: 'WARNING',
            message: `"${info.name}" contains merged cells; a merged value belongs to its top-left cell only.`,
          });
        }
        sheets.push(builder.build());
      }
      if (structure.externalLinks) {
        issues.push({
          code: 'EXTERNAL_LINKS_IGNORED',
          severity: 'WARNING',
          message:
            'The workbook links to other workbooks. Links are never followed; only values saved in this file are read.',
        });
      }
      return {
        format: 'XLSX',
        parser: XLSX_PARSER_INFO,
        csv: null,
        workbook: { date1904: structure.date1904, externalLinks: structure.externalLinks },
        sheets,
        issues,
      };
    } finally {
      zip.close();
    }
  }

  async *rows(
    input: SourceInput,
    settings: SourceSettings,
    limits: ImportLimits,
    options: RowReadOptions = {},
  ): AsyncIterable<SourceRow> {
    if (settings.format !== 'XLSX' || settings.sheetName === null) {
      throw new Error('A worksheet must be chosen before reading rows');
    }
    const workbook = await openWorkbook(input, limits);
    try {
      const info = workbook.structure.sheets.find((sheet) => sheet.name === settings.sheetName);
      if (!info)
        throw new SourceReadError(
          'NO_SHEETS',
          `The workbook has no worksheet named "${settings.sheetName}".`,
        );
      const stream = await workbook.zip.openPart(info.part, limits.xlsxMaxUncompressedBytes);
      if (!stream)
        throw new SourceReadError(
          'NO_SHEETS',
          `The worksheet "${info.name}" is missing from the workbook.`,
        );
      for await (const row of readSheetRows(stream, {
        sheetName: info.name,
        part: info.part,
        date1904: workbook.structure.date1904,
        sharedStrings: workbook.sharedStrings,
        styles: workbook.styles,
        limits,
      })) {
        throwIfAborted(options.signal);
        yield row;
      }
    } finally {
      workbook.zip.close();
    }
  }
}
