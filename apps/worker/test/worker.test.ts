import { JOB_NAMES } from '@smarttag/shared-types';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadWorkerConfig } from '../src/config';
import { PermanentJobError, createJobDispatcher, defineJobHandler } from '../src/job-registry';
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
    await expect(dispatch({ name: 'render.pdf', attemptsMade: 0, data: {} })).rejects.toBeInstanceOf(PermanentJobError);
    await expect(dispatch({ name: JOB_NAMES.SYSTEM_PING, attemptsMade: 0, data: { message: 42 } })).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('lets handler errors propagate for retries', async () => {
    const flaky = defineJobHandler({
      name: 'flaky',
      schema: z.object({}),
      handle: () => Promise.reject(new Error('temporary outage')),
    });
    await expect(createJobDispatcher([flaky], logger)({ name: 'flaky', attemptsMade: 0, data: {} })).rejects.toThrow('temporary outage');
  });

  it('refuses duplicate handler registrations', () => {
    expect(() => createJobDispatcher([systemPingHandler, systemPingHandler], logger)).toThrow(/Duplicate/);
  });
});

describe('worker configuration', () => {
  it('requires a Redis URL', () => {
    expect(() => loadWorkerConfig({})).toThrow(/REDIS_URL/);
    expect(loadWorkerConfig({ REDIS_URL: 'redis://127.0.0.1:56379' })).toMatchObject({ concurrency: 4, redisUrl: 'redis://127.0.0.1:56379' });
  });
});
