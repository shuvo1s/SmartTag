import { isApiErrorBody, type ApiErrorDetails, type ErrorCode } from '@smarttag/shared-types';

export const API_BASE_PATH = '/api/v1';

/** A failed API call, carrying the server's structured error envelope. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: ApiErrorDetails | null,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field errors keyed by dotted path, for mapping onto form fields. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(
      (this.details?.fieldErrors ?? []).map((error) => [error.path, error.message]),
    );
  }
}

export interface ApiRequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly json?: unknown;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly signal?: AbortSignal;
}

/**
 * Same-origin fetch to the API (proxied by Next.js). The HttpOnly session cookie is sent by the
 * browser automatically; the client never sees or stores the token.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const url = new URL(`${API_BASE_PATH}${path}`, 'http://placeholder');
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(`${url.pathname}${url.search}`, {
    method: options.method ?? (options.json === undefined ? 'GET' : 'POST'),
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.json === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
    signal: options.signal,
  });

  if (response.status === 204) {
    return undefined as T;
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (isApiErrorBody(body)) {
      const { code, message, details, requestId } = body.error;
      throw new ApiError(response.status, code, message, details, requestId);
    }
    throw new ApiError(
      response.status,
      'INTERNAL_ERROR',
      'The server returned an unexpected response',
      null,
      null,
    );
  }
  return body as T;
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.requestId ? `${error.message} (reference ${error.requestId})` : error.message;
  }
  return 'Something went wrong. Please try again.';
}
