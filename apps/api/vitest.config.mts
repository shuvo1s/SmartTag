import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Unit tests: no database, no network. SWC preserves decorator metadata for NestJS DI.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
