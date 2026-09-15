import { envInteger, parseEnvironment, type EnvironmentSource } from '@smarttag/config';
import {
  DEFAULT_IMPORT_LIMITS,
  IMPORT_LIMIT_BOUNDS,
  type ImportLimits,
} from '@smarttag/import-core';
import { z } from 'zod';

/** Environment variable for each limit (docs/data-imports.md#limits). */
export const IMPORT_LIMIT_VARIABLES: Readonly<Record<keyof ImportLimits, string>> = {
  maxFileBytes: 'IMPORT_MAX_FILE_BYTES',
  maxRows: 'IMPORT_MAX_ROWS',
  maxColumns: 'IMPORT_MAX_COLUMNS',
  maxSheets: 'IMPORT_MAX_SHEETS',
  maxCellChars: 'IMPORT_MAX_CELL_CHARS',
  maxHeaderChars: 'IMPORT_MAX_HEADER_CHARS',
  previewRows: 'IMPORT_PREVIEW_ROWS',
  xlsxMaxEntries: 'IMPORT_XLSX_MAX_ENTRIES',
  xlsxMaxUncompressedBytes: 'IMPORT_XLSX_MAX_UNCOMPRESSED_BYTES',
  xlsxMaxCompressionRatio: 'IMPORT_XLSX_MAX_COMPRESSION_RATIO',
  xlsxMaxSharedStringsBytes: 'IMPORT_XLSX_MAX_SHARED_STRINGS_BYTES',
};

export interface ImportProcessingSettings {
  readonly limits: ImportLimits;
  /** Rows validated and written per database batch. */
  readonly validationBatchSize: number;
  /** Imports without activity for this long are cancelled and their uploads removed. */
  readonly abandonedAfterHours: number;
  /** Uploads that never reached storage completely are removed after this long. */
  readonly pendingUploadAfterMinutes: number;
  /** INSPECTING/VALIDATING imports without progress for this long are marked failed (retryable). */
  readonly stalledAfterMinutes: number;
}

const shape = Object.fromEntries(
  (Object.keys(IMPORT_LIMIT_VARIABLES) as (keyof ImportLimits)[]).map((key) => [
    IMPORT_LIMIT_VARIABLES[key],
    envInteger(DEFAULT_IMPORT_LIMITS[key], IMPORT_LIMIT_BOUNDS[key]),
  ]),
) as Record<string, ReturnType<typeof envInteger>>;

const ImportEnvSchema = z.object({
  ...shape,
  IMPORT_VALIDATION_BATCH_SIZE: envInteger(500, { min: 10, max: 5_000 }),
  IMPORT_ABANDONED_AFTER_HOURS: envInteger(24 * 14, { min: 1, max: 24 * 365 }),
  IMPORT_PENDING_UPLOAD_AFTER_MINUTES: envInteger(60, { min: 5, max: 24 * 60 }),
  IMPORT_STALLED_AFTER_MINUTES: envInteger(30, { min: 5, max: 24 * 60 }),
});

/** Validated import settings from the environment; defaults apply to unset variables. */
export function loadImportSettings(source: EnvironmentSource): ImportProcessingSettings {
  const env = parseEnvironment(ImportEnvSchema, source) as Record<string, number>;
  const limits = Object.fromEntries(
    (Object.keys(IMPORT_LIMIT_VARIABLES) as (keyof ImportLimits)[]).map((key) => [
      key,
      env[IMPORT_LIMIT_VARIABLES[key]]!,
    ]),
  ) as unknown as ImportLimits;
  return {
    limits,
    validationBatchSize: env.IMPORT_VALIDATION_BATCH_SIZE!,
    abandonedAfterHours: env.IMPORT_ABANDONED_AFTER_HOURS!,
    pendingUploadAfterMinutes: env.IMPORT_PENDING_UPLOAD_AFTER_MINUTES!,
    stalledAfterMinutes: env.IMPORT_STALLED_AFTER_MINUTES!,
  };
}
