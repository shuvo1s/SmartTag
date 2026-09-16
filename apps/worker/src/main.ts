import 'dotenv/config';
import { EnvironmentValidationError } from '@smarttag/config';
import { createDatabaseClient } from '@smarttag/database';
import { createObjectStorage } from '@smarttag/object-storage';
import { JOB_NAMES, QUEUE_NAMES } from '@smarttag/shared-types';
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import pino, { type Logger } from 'pino';
import { loadImportWorkerConfig, loadWorkerConfig } from './config';
import { PermanentJobError, createJobDispatcher } from './job-registry';
import { createImportHandlers } from './processors/import.processors';
import { createProductionHandlers } from './processors/production.processors';
import { systemPingHandler } from './processors/system-ping.processor';

function loadConfiguration() {
  try {
    return { worker: loadWorkerConfig(process.env), imports: loadImportWorkerConfig(process.env) };
  } catch (error) {
    if (error instanceof EnvironmentValidationError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

function processorFor(dispatch: ReturnType<typeof createJobDispatcher>) {
  return async (job: Job) => {
    try {
      return await dispatch(job);
    } catch (error) {
      // Tell BullMQ not to retry failures that retrying cannot fix.
      throw error instanceof PermanentJobError ? new UnrecoverableError(error.message) : error;
    }
  };
}

function observe(worker: Worker, queue: string, logger: Logger): void {
  worker.on('failed', (job, error) =>
    logger.error({ queue, jobId: job?.id, jobName: job?.name, err: error }, 'job failed'),
  );
  worker.on('error', (error) => logger.error({ queue, err: error }, 'worker error'));
}

async function main(): Promise<void> {
  const config = loadConfiguration();
  const logger = pino({
    level: config.worker.logLevel,
    base: { service: 'smarttag-worker' },
    redact: { paths: ['*.password', '*.token', '*.secret'], censor: '[REDACTED]' },
  });
  const connection = { url: config.worker.redisUrl, maxRetriesPerRequest: null };

  const systemWorker = new Worker(
    QUEUE_NAMES.SYSTEM,
    processorFor(createJobDispatcher([systemPingHandler], logger)),
    { connection, concurrency: config.worker.concurrency },
  );
  observe(systemWorker, QUEUE_NAMES.SYSTEM, logger);

  const prisma = createDatabaseClient({
    connectionString: config.imports.databaseUrl,
    maxConnections: config.imports.concurrency * 2 + 2,
  });
  const storage = createObjectStorage(config.imports.objectStorage);
  const importWorker = new Worker(
    QUEUE_NAMES.IMPORTS,
    processorFor(
      createJobDispatcher(
        createImportHandlers({ prisma, storage, settings: config.imports.imports }),
        logger,
      ),
    ),
    {
      connection,
      concurrency: config.imports.concurrency,
      // Large validations keep the lock renewed between batches; a crashed worker's job is retried.
      lockDuration: 120_000,
      maxStalledCount: 2,
    },
  );
  observe(importWorker, QUEUE_NAMES.IMPORTS, logger);

  const productionWorker = new Worker(
    QUEUE_NAMES.PRODUCTION,
    processorFor(
      createJobDispatcher(
        createProductionHandlers({ prisma, storage, settings: config.imports.production }),
        logger,
      ),
    ),
    {
      connection,
      concurrency: config.imports.productionConcurrency,
      // Expanding millions of tags keeps the lock renewed between batches; a crashed worker's job
      // is retried, and every step is idempotent.
      lockDuration: 120_000,
      maxStalledCount: 2,
    },
  );
  observe(productionWorker, QUEUE_NAMES.PRODUCTION, logger);

  const importQueue = new Queue(QUEUE_NAMES.IMPORTS, { connection });
  await importQueue.upsertJobScheduler(
    'data-import-cleanup',
    { every: config.imports.cleanupIntervalMs },
    {
      name: JOB_NAMES.DATA_CLEANUP,
      data: { correlationId: null, requestedAt: new Date().toISOString() },
      opts: { removeOnComplete: 100, removeOnFail: 100 },
    },
  );

  await Promise.all([
    systemWorker.waitUntilReady(),
    importWorker.waitUntilReady(),
    productionWorker.waitUntilReady(),
  ]);
  logger.info(
    {
      queues: [QUEUE_NAMES.SYSTEM, QUEUE_NAMES.IMPORTS, QUEUE_NAMES.PRODUCTION],
      concurrency: {
        system: config.worker.concurrency,
        imports: config.imports.concurrency,
        production: config.imports.productionConcurrency,
      },
      storage: storage.driver,
    },
    'worker ready',
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down worker');
    await Promise.all([
      systemWorker.close(),
      importWorker.close(),
      productionWorker.close(),
      importQueue.close(),
    ]);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
