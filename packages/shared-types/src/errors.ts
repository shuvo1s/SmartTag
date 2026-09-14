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
  'RATE_LIMITED',
  'INTERNAL_ERROR',
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
  const error = (value as { error: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}
