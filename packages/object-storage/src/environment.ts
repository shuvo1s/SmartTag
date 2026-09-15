import { envBoolean, httpUrl, parseEnvironment, type EnvironmentSource } from '@smarttag/config';
import { z } from 'zod';
import type { ObjectStorageConfig } from './factory';

const ObjectStorageEnvSchema = z
  .object({
    OBJECT_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    OBJECT_STORAGE_LOCAL_ROOT: z.string().default('../../storage'),
    OBJECT_STORAGE_BUCKET: z.string().optional(),
    OBJECT_STORAGE_REGION: z.string().default('us-east-1'),
    OBJECT_STORAGE_ENDPOINT: httpUrl.optional(),
    OBJECT_STORAGE_FORCE_PATH_STYLE: envBoolean(false),
    OBJECT_STORAGE_ACCESS_KEY_ID: z.string().optional(),
    OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.OBJECT_STORAGE_DRIVER === 's3' && !env.OBJECT_STORAGE_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['OBJECT_STORAGE_BUCKET'],
        message: 'is required when OBJECT_STORAGE_DRIVER=s3',
      });
    }
  });

/**
 * Object storage configuration from the same OBJECT_STORAGE_* variables the API uses, so the API
 * and background workers always read and write the same store.
 */
export function loadObjectStorageConfig(source: EnvironmentSource): ObjectStorageConfig {
  const env = parseEnvironment(ObjectStorageEnvSchema, source);
  return env.OBJECT_STORAGE_DRIVER === 's3'
    ? {
        driver: 's3',
        bucket: env.OBJECT_STORAGE_BUCKET ?? '',
        region: env.OBJECT_STORAGE_REGION,
        endpoint: env.OBJECT_STORAGE_ENDPOINT ?? null,
        forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE,
        accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID ?? null,
        secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? null,
      }
    : { driver: 'local', localRoot: env.OBJECT_STORAGE_LOCAL_ROOT };
}
