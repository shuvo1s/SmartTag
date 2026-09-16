import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import {
  E2E_API_URL,
  E2E_WEB_PORT,
  E2E_WEB_URL,
  REPO_ROOT,
  apiEnvironment,
  workerEnvironment,
} from './environment.mjs';

const isCI = Boolean(process.env.CI);

/**
 * Runs against production builds (`npm run build`) of the API and web app, started on dedicated
 * ports with a disposable database prepared by scripts/prepare-e2e.mjs.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  forbidOnly: isCI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]],
  use: {
    baseURL: E2E_WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1600, height: 1000 },
    locale: 'en-GB',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
      dependencies: ['setup'],
    },
    // Smaller cross-browser smoke suite; the complete suite runs in Chromium.
    {
      name: 'firefox-smoke',
      testMatch: /(data(-import)?|production)-smoke.spec.ts/,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1600, height: 1000 } },
      dependencies: ['setup'],
    },
    {
      name: 'webkit-smoke',
      testMatch: /(data(-import)?|production)-smoke.spec.ts/,
      use: { ...devices['Desktop Safari'], viewport: { width: 1600, height: 1000 } },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      name: 'api',
      command: 'node dist/main.js',
      cwd: resolve(REPO_ROOT, 'apps', 'api'),
      url: `${E2E_API_URL}/api/v1/health`,
      env: apiEnvironment(),
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Import inspection and validation run here, never in the API process.
      name: 'worker',
      command: 'node dist/main.js',
      cwd: resolve(REPO_ROOT, 'apps', 'worker'),
      env: workerEnvironment(),
      wait: { stdout: /worker ready/ },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      name: 'web',
      command: `npx next start --port ${E2E_WEB_PORT}`,
      cwd: resolve(REPO_ROOT, 'apps', 'web'),
      url: `${E2E_WEB_URL}/login`,
      env: { API_INTERNAL_URL: E2E_API_URL, NODE_ENV: 'production' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
