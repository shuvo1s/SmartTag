import { JOB_NAMES } from '@smarttag/shared-types';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadImportWorkerConfig, loadWorkerConfig } from '../src/config';
import {
  PermanentJobError,
  createJobDispatcher,
  defineJobHandler,
  type JobContext,
} from '../src/job-registry';
import { createImportHandlers } from '../src/processors/import.processors';
import { systemPingHandler } from '../src/processors/system-ping.processor';

const logger = pino({ level: 'silent' });

describe('job dispatcher', () => {
  const dispatch = createJobDispatcher([systemPingHandler], logger);

  it('validates and dispatches known jobs with their correlation id', async () => {
    const result = await dispatch({
      id: '1',
      name: JOB_NAMES.SYSTEM_PING,
      attemptsMade: 0,
      data: { correlationId: 'req-123', requestedAt: '2026-09-14T10:00:00.000Z', message: 'hello' },
    });
    expect(result).toMatchObject({ echo: 'hello' });
  });

  it('fails permanently for unknown jobs and invalid payloads', async () => {
    await expect(
      dispatch({ name: 'render.pdf', attemptsMade: 0, data: {} }),
    ).rejects.toBeInstanceOf(PermanentJobError);
    await expect(
      dispatch({ name: JOB_NAMES.SYSTEM_PING, attemptsMade: 0, data: { message: 42 } }),
    ).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('lets handler errors propagate for retries', async () => {
    const flaky = defineJobHandler({
      name: 'flaky',
      schema: z.object({}),
      handle: () => Promise.reject(new Error('temporary outage')),
    });
    await expect(
      createJobDispatcher([flaky], logger)({ name: 'flaky', attemptsMade: 0, data: {} }),
    ).rejects.toThrow('temporary outage');
  });

  it('refuses duplicate handler registrations', () => {
    expect(() => createJobDispatcher([systemPingHandler, systemPingHandler], logger)).toThrow(
      /Duplicate/,
    );
  });
});

describe('worker configuration', () => {
  it('requires a Redis URL', () => {
    expect(() => loadWorkerConfig({})).toThrow(/REDIS_URL/);
    expect(loadWorkerConfig({ REDIS_URL: 'redis://127.0.0.1:56379' })).toMatchObject({
      concurrency: 4,
      redisUrl: 'redis://127.0.0.1:56379',
    });
  });
});

describe('import processing configuration', () => {
  it('requires a database and uses the same storage variables and import limits as the API', () => {
    expect(() => loadImportWorkerConfig({})).toThrow(/DATABASE_URL/);
    const config = loadImportWorkerConfig({
      DATABASE_URL: 'postgresql://smarttag:smarttag@127.0.0.1:55432/smarttag_dev',
      OBJECT_STORAGE_LOCAL_ROOT: '/data/storage',
      IMPORT_MAX_ROWS: '25000',
    });
    expect(config).toMatchObject({
      concurrency: 2,
      objectStorage: { driver: 'local', localRoot: '/data/storage' },
      imports: { limits: { maxRows: 25_000, maxFileBytes: 50 * 1024 * 1024 } },
    });
    expect(() =>
      loadImportWorkerConfig({ DATABASE_URL: 'postgresql://x/y', IMPORT_MAX_ROWS: '0' }),
    ).toThrow(/IMPORT_MAX_ROWS/);
  });
});

describe('import job handlers', () => {
  it('registers inspection, validation and cleanup and rejects malformed payloads permanently', async () => {
    const handlers = createImportHandlers({
      prisma: {} as never,
      storage: {} as never,
      settings: {} as never,
    });
    expect(handlers.map((handler) => handler.name)).toEqual([
      JOB_NAMES.IMPORT_INSPECT,
      JOB_NAMES.IMPORT_VALIDATE,
      JOB_NAMES.DATA_CLEANUP,
    ]);
    const dispatch = createJobDispatcher(handlers, logger);
    await expect(
      dispatch({ name: JOB_NAMES.IMPORT_VALIDATE, attemptsMade: 0, data: { importId: 'x' } }),
    ).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('tells handlers whether a failure would still be retried', async () => {
    const seen: boolean[] = [];
    const probe = defineJobHandler({
      name: 'probe',
      schema: z.object({}),
      handle: (_payload, context: JobContext) => {
        seen.push(context.finalAttempt);
        return Promise.resolve(null);
      },
    });
    const dispatch = createJobDispatcher([probe], logger);
    await dispatch({ name: 'probe', attemptsMade: 0, data: {}, opts: { attempts: 3 } });
    await dispatch({ name: 'probe', attemptsMade: 2, data: {}, opts: { attempts: 3 } });
    await dispatch({ name: 'probe', attemptsMade: 0, data: {} });
    expect(seen).toEqual([false, true, true]);
  });
});
