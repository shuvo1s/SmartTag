import {
  envInteger,
  logLevel,
  nodeEnvironment,
  parseEnvironment,
  postgresUrl,
  redisUrl,
  type EnvironmentSource,
} from '@smarttag/config';
import { loadImportSettings, type ImportProcessingSettings } from '@smarttag/import-processing';
import { loadObjectStorageConfig, type ObjectStorageConfig } from '@smarttag/object-storage';
import {
  loadProductionSettings,
  type ProductionProcessingSettings,
} from '@smarttag/production-processing';
import { z } from 'zod';

const WorkerEnvSchema = z.object({
  NODE_ENV: nodeEnvironment,
  LOG_LEVEL: logLevel,
  REDIS_URL: redisUrl,
  WORKER_CONCURRENCY: envInteger(4, { min: 1, max: 64 }),
});

const ImportWorkerEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
  /** Import jobs are CPU and database heavy; keep this low. */
  IMPORT_WORKER_CONCURRENCY: envInteger(2, { min: 1, max: 16 }),
  /** How often the cleanup of abandoned imports runs. */
  IMPORT_CLEANUP_INTERVAL_MINUTES: envInteger(60, { min: 1, max: 24 * 60 }),
  /** Expanding and releasing production jobs is CPU and database heavy; keep this low. */
  PRODUCTION_WORKER_CONCURRENCY: envInteger(2, { min: 1, max: 16 }),
});

export interface WorkerConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly logLevel: z.infer<typeof logLevel>;
  readonly redisUrl: string;
  readonly concurrency: number;
}

export interface ImportWorkerConfig {
  readonly databaseUrl: string;
  readonly objectStorage: ObjectStorageConfig;
  readonly imports: ImportProcessingSettings;
  readonly production: ProductionProcessingSettings;
  readonly concurrency: number;
  readonly productionConcurrency: number;
  readonly cleanupIntervalMs: number;
}

export function loadWorkerConfig(source: EnvironmentSource): WorkerConfig {
  const env = parseEnvironment(WorkerEnvSchema, source);
  return {
    environment: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    redisUrl: env.REDIS_URL,
    concurrency: env.WORKER_CONCURRENCY,
  };
}

/** Database, storage and the import and production limits (same variables as the API). */
export function loadImportWorkerConfig(source: EnvironmentSource): ImportWorkerConfig {
  const env = parseEnvironment(ImportWorkerEnvSchema, source);
  return {
    databaseUrl: env.DATABASE_URL,
    objectStorage: loadObjectStorageConfig(source),
    imports: loadImportSettings(source),
    production: loadProductionSettings(source),
    concurrency: env.IMPORT_WORKER_CONCURRENCY,
    productionConcurrency: env.PRODUCTION_WORKER_CONCURRENCY,
    cleanupIntervalMs: env.IMPORT_CLEANUP_INTERVAL_MINUTES * 60_000,
  };
}
