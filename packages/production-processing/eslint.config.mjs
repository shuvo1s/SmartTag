import { createBaseConfig } from '@smarttag/config/eslint/base.mjs';

export default createBaseConfig({ tsconfigRootDir: import.meta.dirname, node: true });
