import type { DocumentValidationIssue } from '@smarttag/document-schema';
import type { ApiErrorDetails, ApiFieldError, ErrorCode } from '@smarttag/shared-types';

export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  VERSION_IMMUTABLE: 409,
  INVALID_STATUS_TRANSITION: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INVALID_DOCUMENT: 422,
  UNSUPPORTED_SCHEMA_VERSION: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/**
 * The only exception type business code throws for expected failures. Messages are safe to show
 * to end users; anything sensitive belongs in logs, not in `message` or `details`.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: ApiErrorDetails | null = null,
  ) {
    super(message);
    this.name = 'AppError';
  }

  get httpStatus(): number {
    return ERROR_HTTP_STATUS[this.code];
  }

  static validation(message: string, fieldErrors: readonly ApiFieldError[] = []): AppError {
    return new AppError('VALIDATION_ERROR', message, fieldErrors.length > 0 ? { fieldErrors } : null);
  }

  static unauthenticated(message = 'Authentication is required'): AppError {
    return new AppError('UNAUTHENTICATED', message);
  }

  static forbidden(message = 'You do not have permission to perform this action'): AppError {
    return new AppError('FORBIDDEN', message);
  }

  /**
   * Also used for resources owned by another organization, so that responses never reveal
   * whether an id exists in a different tenant.
   */
  static notFound(resource: string): AppError {
    return new AppError('NOT_FOUND', `${resource} not found`);
  }

  static conflict(message: string): AppError {
    return new AppError('CONFLICT', message);
  }

  static invalidDocument(issues: readonly DocumentValidationIssue[], message = 'The design document is invalid'): AppError {
    const unsupported = issues.some((issue) => issue.code === 'UNSUPPORTED_SCHEMA_VERSION');
    return new AppError(unsupported ? 'UNSUPPORTED_SCHEMA_VERSION' : 'INVALID_DOCUMENT', unsupported ? 'The design document schema version is not supported' : message, {
      documentIssues: issues,
    });
  }
}
