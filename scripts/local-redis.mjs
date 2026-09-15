#!/usr/bin/env node
/**
 * Project-local Redis for machines without Docker (BullMQ queues for imports and later jobs).
 *
 * Starts an ISOLATED redis-server bound to 127.0.0.1 on a non-default port with its working
 * directory under .local/redis. It never touches any Redis service already installed.
 *
 *   npm run redis:local -- start
 *   npm run redis:local -- stop
 *   npm run redis:local -- status
 *
 * Binaries: REDIS_BIN_DIR, redis-server on PATH, or an unpacked release under .local/runtime
 * (Windows: https://github.com/redis-windows/redis-windows — verify the published SHA-256).
 * Environment overrides: LOCAL_REDIS_PORT (default 56379, the docker-compose port).
 * Local development and tests only: no password, no persistence.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync, statSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_DIR = join(ROOT, '.local', 'redis');
const LOG_FILE = join(BASE_DIR, 'redis.log');
const PORT = process.env.LOCAL_REDIS_PORT ?? '56379';
const EXE = process.platform === 'win32' ? '.exe' : '';

function findBinDir() {
  if (process.env.REDIS_BIN_DIR) return process.env.REDIS_BIN_DIR;
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, `redis-server${EXE}`))) return dir;
  }
  const runtime = join(ROOT, '.local', 'runtime');
  const search = (dir, depth) => {
    if (depth > 3 || !existsSync(dir)) return null;
    if (existsSync(join(dir, `redis-server${EXE}`))) return dir;
    for (const entry of readdirSync(dir).sort().reverse()) {
      const child = join(dir, entry);
      if (entry.toLowerCase().includes('redis') && statSync(child).isDirectory()) {
        const found = search(child, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  const found = search(runtime, 0);
  if (found) return found;
  throw new Error(
    'redis-server not found. Install Redis, set REDIS_BIN_DIR, or unpack a release under .local/runtime.',
  );
}

const BIN = findBinDir();

function cli(args) {
  return spawnSync(join(BIN, `redis-cli${EXE}`), ['-h', '127.0.0.1', '-p', PORT, ...args], {
    encoding: 'utf8',
  });
}

function isRunning() {
  const result = cli(['ping']);
  return result.status === 0 && result.stdout.trim() === 'PONG';
}

async function start() {
  if (isRunning()) {
    console.log(`Local Redis already running on 127.0.0.1:${PORT}`);
    return;
  }
  mkdirSync(BASE_DIR, { recursive: true });
  const log = openSync(LOG_FILE, 'a');
  const child = spawn(
    join(BIN, `redis-server${EXE}`),
    [
      '--port',
      PORT,
      '--bind',
      '127.0.0.1',
      '--save',
      '',
      '--appendonly',
      'no',
      '--protected-mode',
      'yes',
    ],
    { cwd: BASE_DIR, detached: true, stdio: ['ignore', log, log], windowsHide: true },
  );
  child.unref();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (isRunning()) {
      console.log(`Local Redis started on 127.0.0.1:${PORT} (log: ${LOG_FILE})`);
      return;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Redis did not start; see ${LOG_FILE}`);
}

const command = process.argv[2] ?? 'status';
try {
  switch (command) {
    case 'start':
      await start();
      break;
    case 'stop':
      if (isRunning()) cli(['shutdown', 'nosave']);
      console.log('Local Redis stopped');
      break;
    case 'status':
      console.log(isRunning() ? `running on 127.0.0.1:${PORT} (binaries: ${BIN})` : 'not running');
      break;
    default:
      throw new Error(`Unknown command "${command}". Use start | stop | status.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
