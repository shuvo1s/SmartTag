import 'dotenv/config';
import { EnvironmentValidationError } from '@smarttag/config';
import { QUEUE_NAMES } from '@smarttag/shared-types';
import { UnrecoverableError, Worker } from 'bullmq';
import pino from 'pino';
import { loadWorkerConfig } from './config';
import { PermanentJobError, createJobDispatcher } from './job-registry';
import { systemPingHandler } from './processors/system-ping.processor';

function main(): void {
  let config;
  try {
    config = loadWorkerConfig(process.env);
  } catch (error) {
    if (error instanceof EnvironmentValidationError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = pino({
    level: config.logLevel,
    base: { service: 'smarttag-worker' },
    redact: { paths: ['*.password', '*.token', '*.secret'], censor: '[REDACTED]' },
  });
  const dispatch = createJobDispatcher([systemPingHandler], logger);

  const worker = new Worker(
    QUEUE_NAMES.SYSTEM,
    async (job) => {
      try {
        return await dispatch(job);
      } catch (error) {
        // Tell BullMQ not to retry failures that retrying cannot fix.
        throw error instanceof PermanentJobError ? new UnrecoverableError(error.message) : error;
      }
    },
    {
      connection: { url: config.redisUrl, maxRetriesPerRequest: null },
      concurrency: config.concurrency,
    },
  );

  worker.on('ready', () =>
    logger.info({ queue: QUEUE_NAMES.SYSTEM, concurrency: config.concurrency }, 'worker ready'),
  );
  worker.on('failed', (job, error) =>
    logger.error({ jobId: job?.id, jobName: job?.name, err: error }, 'job failed'),
  );
  worker.on('error', (error) => logger.error({ err: error }, 'worker error'));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down worker');
    await worker.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main();
