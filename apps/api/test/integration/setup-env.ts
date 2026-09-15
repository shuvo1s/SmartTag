import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: resolve(__dirname, '../../.env'), quiet: true });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set');
}

// Every integration test process talks ONLY to the disposable test database and a temp storage root.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OBJECT_STORAGE_DRIVER = 'local';
process.env.OBJECT_STORAGE_LOCAL_ROOT = mkdtempSync(join(tmpdir(), 'smarttag-it-storage-'));
process.env.AUTH_COOKIE_SECURE = 'false';
process.env.AUTH_LOGIN_RATE_LIMIT_PER_MINUTE = '1000';
process.env.API_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.ASSET_MAX_UPLOAD_BYTES = String(64 * 1024);
// Background jobs use a dedicated Redis logical database; import tests start an in-process worker.
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56379/14';
