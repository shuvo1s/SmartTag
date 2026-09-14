import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, describeError } from './api-client';

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('calls the same-origin API with JSON and query parameters', async () => {
    const fetchMock = mockFetch(200, { ok: true });
    await expect(apiRequest('/templates', { query: { page: 2, search: 'tag', status: undefined } })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/templates?page=2&search=tag', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }));

    await apiRequest('/templates', { json: { name: 'x' } });
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init).toMatchObject({ method: 'POST', body: '{"name":"x"}' });
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('returns undefined for 204 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiRequest('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('turns error envelopes into ApiError with field errors', async () => {
    mockFetch(400, {
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: { fieldErrors: [{ path: 'dimensions.width', message: 'Width is required' }] }, requestId: 'req-1' },
    });
    const error = await apiRequest('/templates', { json: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', requestId: 'req-1' });
    expect((error as ApiError).fieldErrors()).toEqual({ 'dimensions.width': 'Width is required' });
    expect(describeError(error)).toBe('Request validation failed (reference req-1)');
  });

  it('handles non-envelope failures safely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })));
    await expect(apiRequest('/templates')).rejects.toMatchObject({ status: 502, code: 'INTERNAL_ERROR' });
    expect(describeError(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });
});
