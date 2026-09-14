import { createBaseConfig } from '@smarttag/config/eslint/base.mjs';

export default [
  ...createBaseConfig({ tsconfigRootDir: import.meta.dirname, node: true }),
  {
    rules: {
      // NestJS dependency injection relies on emitted decorator metadata: constructor parameter
      // types must remain value imports, so type-only import enforcement is disabled here.
      '@typescript-eslint/consistent-type-imports': 'off',
      // Nest modules/controllers are commonly declared as empty decorated classes.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    files: ['prisma/seed.ts', 'test/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // supertest types HTTP response bodies as `any`; integration tests assert on their shape explicitly.
    files: ['test/integration/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
];
