/**
 * A source file that cannot be read. `code` is stable and shown with `message`, which is written
 * for the person who uploaded the file. Reading never partially succeeds: an import either has a
 * complete, trustworthy view of the file or none.
 */
export const SOURCE_READ_ERROR_CODES = [
  'UNSUPPORTED_IMPORT_FORMAT',
  'MALFORMED_FILE',
  'FILE_LIMIT_EXCEEDED',
  'WORKBOOK_LIMIT_EXCEEDED',
  'NO_SHEETS',
  'ENCODING_INVALID',
  'MACROS_NOT_SUPPORTED',
  'ENCRYPTED_FILE',
] as const;
export type SourceReadErrorCode = (typeof SOURCE_READ_ERROR_CODES)[number];

export class SourceReadError extends Error {
  constructor(
    readonly code: SourceReadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SourceReadError';
  }
}

export function isSourceReadError(error: unknown): error is SourceReadError {
  return error instanceof SourceReadError;
}
