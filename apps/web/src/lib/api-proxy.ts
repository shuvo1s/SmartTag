import type { ApiErrorBody } from '@smarttag/shared-types';

/**
 * Same-origin forwarding of `/api/v1/*` to the NestJS API.
 *
 * Implemented as a streaming Route Handler instead of a `next.config` rewrite because rewrites are
 * compiled into the build manifest: the API location must be configurable at runtime
 * (`API_INTERNAL_URL`) so one build can run against any environment (including the isolated E2E
 * stack). Bodies are streamed in both directions, never buffered or truncated.
 *
 * The proxy is transport only. Authentication, CSRF (Origin) checks and authorization all happen
 * in the API, which receives the browser's Origin, Sec-Fetch-* and Cookie headers unchanged.
 */

export const DEFAULT_API_INTERNAL_URL = 'http://127.0.0.1:4000';

/** Hop-by-hop and connection-specific headers that must not be forwarded (RFC 9110 §7.6.1). */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'expect',
]);

/** Response headers recomputed by this server (fetch has already decoded the body). */
const RECOMPUTED_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'set-cookie']);

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

export function resolveApiInternalUrl(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env.API_INTERNAL_URL?.trim() || DEFAULT_API_INTERNAL_URL;
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API_INTERNAL_URL must be an http(s) URL');
  }
  return url.origin + url.pathname.replace(/\/$/, '');
}

export function buildUpstreamHeaders(incoming: Headers, requestUrl: URL): Headers {
  const headers = new Headers();
  incoming.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (!HOP_BY_HOP_HEADERS.has(lower) && !lower.startsWith('x-forwarded-')) {
      headers.set(name, value);
    }
  });
  // Next.js records the client address in x-forwarded-for before invoking route handlers; the API
  // trusts it only from loopback/private proxies (API_TRUST_PROXY).
  const forwardedFor = incoming.get('x-forwarded-for');
  if (forwardedFor) {
    headers.set('x-forwarded-for', forwardedFor);
  }
  headers.set('x-forwarded-host', incoming.get('host') ?? requestUrl.host);
  headers.set('x-forwarded-proto', requestUrl.protocol.replace(':', ''));
  return headers;
}

export function buildDownstreamHeaders(upstream: Headers): Headers {
  const headers = new Headers();
  upstream.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (!HOP_BY_HOP_HEADERS.has(lower) && !RECOMPUTED_RESPONSE_HEADERS.has(lower)) {
      headers.set(name, value);
    }
  });
  // Multiple Set-Cookie headers must stay separate.
  for (const cookie of upstream.getSetCookie()) {
    headers.append('set-cookie', cookie);
  }
  return headers;
}

function unavailable(): Response {
  const body: ApiErrorBody = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'The service is temporarily unavailable. Please try again.',
      details: null,
      requestId: null,
    },
  };
  return Response.json(body, { status: 502 });
}

export async function forwardToApi(
  request: Request,
  apiInternalUrl = resolveApiInternalUrl(process.env),
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (!requestUrl.pathname.startsWith('/api/v1/') && requestUrl.pathname !== '/api/v1') {
    return new Response(null, { status: 404 });
  }
  const target = `${apiInternalUrl}${requestUrl.pathname}${requestUrl.search}`;
  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD' && request.body !== null;

  let upstream: Response;
  try {
    upstream = await fetchImpl(target, {
      method,
      headers: buildUpstreamHeaders(request.headers, requestUrl),
      body: hasBody ? request.body : undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: request.signal,
      // Required by the fetch standard for streaming request bodies.
      ...(hasBody ? { duplex: 'half' } : {}),
    });
  } catch {
    return unavailable();
  }

  const body = NULL_BODY_STATUSES.has(upstream.status) || method === 'HEAD' ? null : upstream.body;
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildDownstreamHeaders(upstream.headers),
  });
}
