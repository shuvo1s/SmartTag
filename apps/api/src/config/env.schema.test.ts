import { EnvironmentValidationError } from '@smarttag/config';
import { describe, expect, it } from 'vitest';
import { loadAppConfig } from './env.schema';

const base = { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db' };

describe('loadAppConfig', () => {
  it('applies safe development defaults', () => {
    const config = loadAppConfig(base);
    expect(config.environment).toBe('development');
    expect(config.http).toMatchObject({ port: 4000, allowedOrigins: ['http://localhost:3000'], trustProxy: false });
    expect(config.objectStorage).toEqual({ driver: 'local', localRoot: '../../storage' });
    expect(config.redis).toBeNull();
    expect(config.auth).toMatchObject({ cookieSecure: false, cookieName: 'smarttag_session', sessionTtlMs: 12 * 3_600_000 });
  });

  it('uses Secure __Host- cookies in production by default', () => {
    const config = loadAppConfig({ ...base, NODE_ENV: 'production' });
    expect(config.auth).toMatchObject({ cookieSecure: true, cookieName: '__Host-smarttag_session' });
  });

  it('refuses insecure cookies in production', () => {
    expect(() => loadAppConfig({ ...base, NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'false' })).toThrow(EnvironmentValidationError);
  });

  it('requires a bucket for S3 storage', () => {
    expect(() => loadAppConfig({ ...base, OBJECT_STORAGE_DRIVER: 's3' })).toThrow(/OBJECT_STORAGE_BUCKET/);
    const config = loadAppConfig({
      ...base,
      OBJECT_STORAGE_DRIVER: 's3',
      OBJECT_STORAGE_BUCKET: 'assets',
      OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:59000',
      OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
    });
    expect(config.objectStorage).toMatchObject({ driver: 's3', bucket: 'assets', forcePathStyle: true });
  });

  it('requires DATABASE_URL and validates URLs without echoing values', () => {
    expect(() => loadAppConfig({})).toThrow(/DATABASE_URL/);
    try {
      loadAppConfig({ ...base, REDIS_URL: 'not-a-redis-url-secret' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('REDIS_URL');
      expect((error as Error).message).not.toContain('not-a-redis-url-secret');
    }
  });

  it('parses and normalises allowed origins', () => {
    const config = loadAppConfig({ ...base, API_ALLOWED_ORIGINS: 'https://tags.example.com/, http://localhost:3000' });
    expect(config.http.allowedOrigins).toEqual(['https://tags.example.com', 'http://localhost:3000']);
  });
});
