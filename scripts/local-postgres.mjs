#!/usr/bin/env node
/**
 * Project-local PostgreSQL cluster for machines without Docker.
 *
 * Creates an ISOLATED cluster under .local/postgres using locally installed PostgreSQL binaries,
 * listening only on 127.0.0.1 on a non-default port. It never touches any existing PostgreSQL
 * server, service or database on the machine.
 *
 *   npm run pg:local -- init     # initdb + start + create smarttag_dev and smarttag_test
 *   npm run pg:local -- start
 *   npm run pg:local -- stop
 *   npm run pg:local -- status
 *
 * Environment overrides: PG_BIN_DIR, LOCAL_PG_PORT (default 55432).
 * Credentials match docker-compose.yml and are for local development only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_DIR = join(ROOT, '.local', 'postgres');
const DATA_DIR = join(BASE_DIR, 'data');
const LOG_FILE = join(BASE_DIR, 'postgres.log');
const PORT = process.env.LOCAL_PG_PORT ?? '55432';
const USER = 'smarttag';
const PASSWORD = 'smarttag';
const DATABASES = ['smarttag_dev', 'smarttag_test'];
const EXE = process.platform === 'win32' ? '.exe' : '';

function findBinDir() {
  if (process.env.PG_BIN_DIR) {
    return process.env.PG_BIN_DIR;
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, `initdb${EXE}`))) {
      return dir;
    }
  }
  const candidates = [];
  const scan = (base, suffix) => {
    if (!existsSync(base)) return;
    for (const version of readdirSync(base)) {
      const bin = join(base, version, suffix);
      if (existsSync(join(bin, `initdb${EXE}`))) candidates.push({ version: Number.parseFloat(version) || 0, bin });
    }
  };
  if (process.platform === 'win32') scan('C:\\Program Files\\PostgreSQL', 'bin');
  if (process.platform === 'linux') scan('/usr/lib/postgresql', 'bin');
  if (process.platform === 'darwin') {
    scan('/opt/homebrew/opt', 'bin');
    scan('/Applications/Postgres.app/Contents/Versions', 'bin');
  }
  candidates.sort((a, b) => b.version - a.version);
  if (candidates[0]) return candidates[0].bin;
  throw new Error('PostgreSQL binaries not found. Install PostgreSQL or set PG_BIN_DIR.');
}

const BIN = findBinDir();
const bin = (name) => join(BIN, `${name}${EXE}`);

function run(name, args, { allowFailure = false, quiet = false } = {}) {
  // stdio must not be piped for pg_ctl start: the postmaster would inherit the pipe and block us.
  const result = spawnSync(bin(name), args, {
    stdio: quiet ? 'ignore' : 'inherit',
    env: { ...process.env, PGPASSWORD: PASSWORD },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${name} exited with code ${result.status}`);
  }
  return result.status === 0;
}

function isRunning() {
  return existsSync(DATA_DIR) && run('pg_ctl', ['-D', DATA_DIR, 'status'], { allowFailure: true, quiet: true });
}

function start() {
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    throw new Error('Cluster not initialised. Run: npm run pg:local -- init');
  }
  if (isRunning()) {
    console.log(`Local PostgreSQL already running on 127.0.0.1:${PORT}`);
    return;
  }
  run('pg_ctl', ['-D', DATA_DIR, '-l', LOG_FILE, '-w', '-t', '60', '-o', `-p ${PORT} -c listen_addresses=127.0.0.1`, 'start'], { quiet: true });
  console.log(`Local PostgreSQL started on 127.0.0.1:${PORT} (log: ${LOG_FILE})`);
}

function init() {
  if (existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    console.log('Cluster already initialised.');
  } else {
    mkdirSync(BASE_DIR, { recursive: true });
    const pwFile = join(BASE_DIR, '.pwfile');
    writeFileSync(pwFile, PASSWORD);
    try {
      run('initdb', ['-D', DATA_DIR, '-U', USER, `--pwfile=${pwFile}`, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C']);
    } finally {
      rmSync(pwFile, { force: true });
    }
  }
  start();
  for (const database of DATABASES) {
    const exists = spawnSync(
      bin('psql'),
      ['-h', '127.0.0.1', '-p', PORT, '-U', USER, '-d', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname = '${database}'`],
      { env: { ...process.env, PGPASSWORD: PASSWORD }, encoding: 'utf8' },
    );
    if (exists.stdout.trim() === '1') {
      console.log(`Database ${database} exists`);
    } else {
      run('createdb', ['-h', '127.0.0.1', '-p', PORT, '-U', USER, database]);
      console.log(`Created database ${database}`);
    }
  }
  console.log(`\nDATABASE_URL=postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/smarttag_dev`);
  console.log(`TEST_DATABASE_URL=postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/smarttag_test`);
}

const command = process.argv[2] ?? 'status';
try {
  switch (command) {
    case 'init':
      init();
      break;
    case 'start':
      start();
      break;
    case 'stop':
      if (isRunning()) run('pg_ctl', ['-D', DATA_DIR, '-m', 'fast', '-w', 'stop'], { quiet: true });
      console.log('Local PostgreSQL stopped');
      break;
    case 'status':
      console.log(isRunning() ? `running on 127.0.0.1:${PORT} (binaries: ${BIN})` : 'not running');
      break;
    default:
      throw new Error(`Unknown command "${command}". Use init | start | stop | status.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
