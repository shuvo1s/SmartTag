// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildDownstreamHeaders,
  buildUpstreamHeaders,
  forwardToApi,
  resolveApiInternalUrl,
} from './api-proxy';

describe('API forwarding route handler', () => {
  it('resolves API_INTERNAL_URL at runtime and rejects non-http schemes', () => {
    expect(resolveApiInternalUrl({})).toBe('http://127.0.0.1:4000');
    expect(resolveApiInternalUrl({ API_INTERNAL_URL: 'http://127.0.0.1:4100/' })).toBe(
      'http://127.0.0.1:4100',
    );
    expect(() => resolveApiInternalUrl({ API_INTERNAL_URL: 'file:///etc' })).toThrow();
  });

  it('forwards browser security headers and strips hop-by-hop headers', () => {
    const headers = buildUpstreamHeaders(
      new Headers({
        cookie: 'smarttag_session=abc',
        origin: 'http://localhost:3000',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        connection: 'keep-alive',
        host: 'localhost:3000',
        'content-length': '12',
        'x-forwarded-for': '10.0.0.7',
        'x-forwarded-host': 'spoofed.example',
      }),
      new URL('http://localhost:3000/api/v1/templates'),
    );
    expect(Object.fromEntries(headers.entries())).toEqual({
      cookie: 'smarttag_session=abc',
      origin: 'http://localhost:3000',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'x-forwarded-for': '10.0.0.7',
      'x-forwarded-host': 'localhost:3000',
      'x-forwarded-proto': 'http',
    });
  });

  it('keeps multiple Set-Cookie headers separate and drops recomputed encodings', () => {
    const upstream = new Headers();
    upstream.append('set-cookie', 'a=1; Path=/; HttpOnly');
    upstream.append('set-cookie', 'b=2; Path=/; HttpOnly');
    upstream.set('content-encoding', 'gzip');
    upstream.set('content-length', '10');
    upstream.set('content-security-policy', "default-src 'none'; sandbox");
    const headers = buildDownstreamHeaders(upstream);
    expect(headers.getSetCookie()).toEqual(['a=1; Path=/; HttpOnly', 'b=2; Path=/; HttpOnly']);
    expect(headers.has('content-encoding')).toBe(false);
    expect(headers.has('content-length')).toBe(false);
    expect(headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  });

  it('streams the request to the API and returns status, headers and body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response('{"ok":true}', {
          status: 201,
          headers: { 'content-type': 'application/json', 'x-request-id': 'req-1' },
        }),
      ),
    );
    const response = await forwardToApi(
      new Request('http://localhost:3000/api/v1/templates?page=2', {
        method: 'POST',
        body: '{"name":"x"}',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      }),
      'http://127.0.0.1:4100',
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [target, init] = fetchImpl.mock.calls[0]!;
    expect(target).toBe('http://127.0.0.1:4100/api/v1/templates?page=2');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(await new Response(init?.body).text()).toBe('{"name":"x"}');
    expect(response.status).toBe(201);
    expect(response.headers.get('x-request-id')).toBe('req-1');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('returns the API error envelope when the API is unreachable', async () => {
    const response = await forwardToApi(
      new Request('http://localhost:3000/api/v1/auth/session'),
      'http://127.0.0.1:4100',
      () => Promise.reject(new TypeError('fetch failed')),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
  });

  it('never forwards paths outside the versioned API and handles null-body statuses', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    expect(
      (await forwardToApi(new Request('http://localhost:3000/api/internal'), 'http://x', fetchImpl))
        .status,
    ).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
    const noContent = await forwardToApi(
      new Request('http://localhost:3000/api/v1/auth/logout', { method: 'POST' }),
      'http://127.0.0.1:4100',
      fetchImpl,
    );
    expect(noContent.status).toBe(204);
  });
});
