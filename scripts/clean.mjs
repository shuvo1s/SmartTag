// Cross-platform removal of build output directories: `node ../../scripts/clean.mjs dist`
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const targets = process.argv.slice(2);
for (const target of targets) {
  rmSync(resolve(process.cwd(), target), { recursive: true, force: true });
}
