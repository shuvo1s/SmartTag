import { createBaseConfig } from '@smarttag/config/eslint/base.mjs';

export default [
  ...createBaseConfig({ tsconfigRootDir: import.meta.dirname, node: true }),
  { ignores: ['test-results/**', 'playwright-report/**', '.auth/**'] },
  {
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
];
