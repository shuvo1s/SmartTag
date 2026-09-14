import nextVitals from 'eslint-config-next/core-web-vitals';
import { createBaseConfig } from '@smarttag/config/eslint/base.mjs';

const config = [
  ...nextVitals,
  ...createBaseConfig({ tsconfigRootDir: import.meta.dirname, node: false }),
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
];

export default config;
