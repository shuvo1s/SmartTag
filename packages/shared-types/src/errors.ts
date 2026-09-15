import type { DocumentValidationIssue } from '@smarttag/document-schema';

/**
 * Stable, machine-readable error codes. Clients branch on `code`, never on `message` or HTTP text.
 * Adding a code is backwards compatible; renaming or removing one is a breaking API change.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'VERSION_IMMUTABLE',
  'INVALID_STATUS_TRANSITION',
  'INVALID_DOCUMENT',
  'UNSUPPORTED_SCHEMA_VERSION',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNSAFE_CONTENT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  // Data imports and datasets (Phase 4)
  'UNSUPPORTED_IMPORT_FORMAT',
  'IMPORT_FILE_TOO_LARGE',
  'IMPORT_FILE_MALFORMED',
  'WORKBOOK_LIMIT_EXCEEDED',
  'INVALID_SOURCE_SETTINGS',
  'MAPPING_INCOMPLETE',
  'TARGET_FIELD_ALREADY_MAPPED',
  'IMPORT_NOT_READY',
  'TEMPLATE_VERSION_CHANGED',
  'DATASET_HAS_ERRORS',
  'WARNINGS_NOT_ACKNOWLEDGED',
  'DATASET_IMMUTABLE',
  'MAPPING_PROFILE_INCOMPATIBLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiFieldError {
  /** Dotted path into the request body or query, e.g. "dimensions.width". */
  readonly path: string;
  readonly message: string;
}

export interface ApiErrorDetails {
  readonly fieldErrors?: readonly ApiFieldError[];
  readonly documentIssues?: readonly DocumentValidationIssue[];
  readonly [key: string]: unknown;
}

/** Envelope for every non-2xx API response. */
export interface ApiErrorBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly details: ApiErrorDetails | null;
    /** Correlates the response with server logs and audit events. */
    readonly requestId: string | null;
  };
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false;
  }
  const { error } = value;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  );
}
