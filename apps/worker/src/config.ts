import {
  envInteger,
  logLevel,
  nodeEnvironment,
  parseEnvironment,
  redisUrl,
  type EnvironmentSource,
} from '@smarttag/config';
import { z } from 'zod';

const WorkerEnvSchema = z.object({
  NODE_ENV: nodeEnvironment,
  LOG_LEVEL: logLevel,
  REDIS_URL: redisUrl,
  WORKER_CONCURRENCY: envInteger(4, { min: 1, max: 64 }),
});

export interface WorkerConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly logLevel: z.infer<typeof logLevel>;
  readonly redisUrl: string;
  readonly concurrency: number;
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
