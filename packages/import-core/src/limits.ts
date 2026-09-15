import { MAX_STRING_VALUE_LENGTH } from '@smarttag/document-schema';

/**
 * Limits for one uploaded data source. Uploaded files are untrusted: every dimension that could
 * consume memory, CPU or storage is bounded. Values are configuration (validated environment
 * variables, docs/data-imports.md#limits); these are the defaults.
 */
export interface ImportLimits {
  /** Size of the uploaded file (bytes). */
  readonly maxFileBytes: number;
  /** Data rows (non-blank rows below the header) in the selected sheet or CSV file. */
  readonly maxRows: number;
  /** Columns in the selected sheet or CSV file. */
  readonly maxColumns: number;
  /** Worksheets in a workbook. */
  readonly maxSheets: number;
  /** Characters in one cell. */
  readonly maxCellChars: number;
  /** Characters in one header cell. */
  readonly maxHeaderChars: number;
  /** Rows shown in the source preview; the header row must be one of them. */
  readonly previewRows: number;
  /** Entries in the ZIP container of a workbook. */
  readonly xlsxMaxEntries: number;
  /** Total uncompressed size of all ZIP entries a workbook may declare (bytes). */
  readonly xlsxMaxUncompressedBytes: number;
  /** Largest uncompressed/compressed ratio of a ZIP entry larger than 1 MB. */
  readonly xlsxMaxCompressionRatio: number;
  /** Uncompressed size of the shared strings part (bytes). */
  readonly xlsxMaxSharedStringsBytes: number;
}

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxFileBytes: 50 * 1024 * 1024,
  maxRows: 100_000,
  maxColumns: 250,
  maxSheets: 50,
  maxCellChars: MAX_STRING_VALUE_LENGTH,
  maxHeaderChars: 256,
  previewRows: 25,
  xlsxMaxEntries: 1_000,
  xlsxMaxUncompressedBytes: 512 * 1024 * 1024,
  xlsxMaxCompressionRatio: 200,
  xlsxMaxSharedStringsBytes: 128 * 1024 * 1024,
};

/** Allowed ranges when limits are configured (environment validation uses them). */
export const IMPORT_LIMIT_BOUNDS: Readonly<
  Record<keyof ImportLimits, { readonly min: number; readonly max: number }>
> = {
  maxFileBytes: { min: 1024, max: 1024 * 1024 * 1024 },
  maxRows: { min: 1, max: 1_000_000 },
  maxColumns: { min: 1, max: 16_384 },
  maxSheets: { min: 1, max: 1_000 },
  maxCellChars: { min: 16, max: MAX_STRING_VALUE_LENGTH },
  maxHeaderChars: { min: 16, max: 1_000 },
  previewRows: { min: 2, max: 100 },
  xlsxMaxEntries: { min: 16, max: 100_000 },
  xlsxMaxUncompressedBytes: { min: 1024 * 1024, max: 8 * 1024 * 1024 * 1024 },
  xlsxMaxCompressionRatio: { min: 10, max: 10_000 },
  xlsxMaxSharedStringsBytes: { min: 1024, max: 2 * 1024 * 1024 * 1024 },
};
