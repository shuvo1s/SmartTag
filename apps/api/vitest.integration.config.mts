import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests: real PostgreSQL (TEST_DATABASE_URL), full Nest application over HTTP.
// Files share one database, so they run sequentially.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    environment: 'node',
    globalSetup: ['test/integration/global-setup.ts'],
    setupFiles: ['test/integration/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
