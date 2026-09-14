// Single source of truth for the isolated E2E stack. Imported by the prepare script, the
// Playwright config and the tests. Ports and database are deliberately different from the
// development defaults so an E2E run never touches a developer's running stack or data.
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

export const E2E_API_PORT = Number(process.env.E2E_API_PORT ?? 4310);
export const E2E_WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3310);
export const E2E_WEB_URL = `http://localhost:${E2E_WEB_PORT}`;
export const E2E_API_URL = `http://127.0.0.1:${E2E_API_PORT}`;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://smarttag:smarttag@127.0.0.1:55432/smarttag_e2e';
export const E2E_STORAGE_ROOT = resolve(ROOT, '.local', 'e2e-storage');
export const E2E_PASSWORD = 'E2E-SmartTag-Password-1';
export const REPO_ROOT = ROOT;

/** Environment for the API process and the seed. */
export function apiEnvironment() {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    API_HOST: '127.0.0.1',
    API_PORT: String(E2E_API_PORT),
    API_ALLOWED_ORIGINS: E2E_WEB_URL,
    API_TRUST_PROXY: 'true',
    DATABASE_URL: E2E_DATABASE_URL,
    OBJECT_STORAGE_DRIVER: 'local',
    OBJECT_STORAGE_LOCAL_ROOT: E2E_STORAGE_ROOT,
    ASSET_MAX_UPLOAD_BYTES: String(25 * 1024 * 1024),
    AUTH_SESSION_TTL_HOURS: '12',
    AUTH_SESSION_IDLE_TIMEOUT_MINUTES: '120',
    AUTH_COOKIE_SECURE: 'false',
    // Many logins per minute from one address during a run.
    AUTH_LOGIN_RATE_LIMIT_PER_MINUTE: '10000',
    SEED_USER_PASSWORD: E2E_PASSWORD,
  };
}
