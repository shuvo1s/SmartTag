import {
  envBoolean,
  envInteger,
  httpUrl,
  logLevel,
  nodeEnvironment,
  parseEnvironment,
  postgresUrl,
  redisUrl,
  type EnvironmentSource,
} from '@smarttag/config';
import { loadImportSettings, type ImportProcessingSettings } from '@smarttag/import-processing';
import {
  loadProductionSettings,
  type ProductionProcessingSettings,
} from '@smarttag/production-processing';
import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: nodeEnvironment,
    LOG_LEVEL: logLevel,

    API_HOST: z.string().default('127.0.0.1'),
    API_PORT: envInteger(4000, { min: 1, max: 65_535 }),
    API_ALLOWED_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(httpUrl).min(1)),
    API_TRUST_PROXY: envBoolean(false),

    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl.optional(),

    OBJECT_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    OBJECT_STORAGE_LOCAL_ROOT: z.string().default('../../storage'),
    OBJECT_STORAGE_BUCKET: z.string().optional(),
    OBJECT_STORAGE_REGION: z.string().default('us-east-1'),
    OBJECT_STORAGE_ENDPOINT: httpUrl.optional(),
    OBJECT_STORAGE_FORCE_PATH_STYLE: envBoolean(false),
    OBJECT_STORAGE_ACCESS_KEY_ID: z.string().optional(),
    OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
    ASSET_MAX_UPLOAD_BYTES: envInteger(25 * 1024 * 1024, { min: 1024, max: 512 * 1024 * 1024 }),

    AUTH_SESSION_TTL_HOURS: envInteger(12, { min: 1, max: 24 * 30 }),
    AUTH_SESSION_IDLE_TIMEOUT_MINUTES: envInteger(120, { min: 5, max: 24 * 60 }),
    AUTH_COOKIE_SECURE: z.enum(['true', 'false', '1', '0']).optional(),
    AUTH_LOGIN_RATE_LIMIT_PER_MINUTE: envInteger(10, { min: 1, max: 10_000 }),
  })
  .superRefine((env, ctx) => {
    if (env.OBJECT_STORAGE_DRIVER === 's3' && !env.OBJECT_STORAGE_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['OBJECT_STORAGE_BUCKET'],
        message: 'is required when OBJECT_STORAGE_DRIVER=s3',
      });
    }
    if (
      env.NODE_ENV === 'production' &&
      (env.AUTH_COOKIE_SECURE === 'false' || env.AUTH_COOKIE_SECURE === '0')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SECURE'],
        message: 'must not be disabled in production',
      });
    }
  });

export interface AppConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly logLevel: z.infer<typeof logLevel>;
  readonly http: {
    readonly host: string;
    readonly port: number;
    readonly allowedOrigins: readonly string[];
    readonly trustProxy: boolean;
  };
  readonly database: { readonly url: string };
  readonly redis: { readonly url: string } | null;
  readonly objectStorage:
    | { readonly driver: 'local'; readonly localRoot: string }
    | {
        readonly driver: 's3';
        readonly bucket: string;
        readonly region: string;
        readonly endpoint: string | null;
        readonly forcePathStyle: boolean;
        readonly accessKeyId: string | null;
        readonly secretAccessKey: string | null;
      };
  readonly assets: { readonly maxUploadBytes: number };
  /** Data import limits and retention (shared variables with the worker). */
  readonly imports: ImportProcessingSettings;
  /** Production job limits (shared variables with the worker). */
  readonly production: ProductionProcessingSettings;
  readonly auth: {
    readonly sessionTtlMs: number;
    readonly idleTimeoutMs: number;
    readonly cookieSecure: boolean;
    readonly cookieName: string;
    readonly loginRateLimitPerMinute: number;
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Parses and validates the full process environment. Throws EnvironmentValidationError on failure. */
export function loadAppConfig(source: EnvironmentSource): AppConfig {
  const env = parseEnvironment(EnvSchema, source);
  const cookieSecure =
    env.AUTH_COOKIE_SECURE === undefined
      ? env.NODE_ENV === 'production'
      : env.AUTH_COOKIE_SECURE === 'true' || env.AUTH_COOKIE_SECURE === '1';

  return {
    environment: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    http: {
      host: env.API_HOST,
      port: env.API_PORT,
      allowedOrigins: env.API_ALLOWED_ORIGINS.map((origin) => new URL(origin).origin),
      trustProxy: env.API_TRUST_PROXY,
    },
    database: { url: env.DATABASE_URL },
    redis: env.REDIS_URL ? { url: env.REDIS_URL } : null,
    objectStorage:
      env.OBJECT_STORAGE_DRIVER === 's3'
        ? {
            driver: 's3',
            bucket: env.OBJECT_STORAGE_BUCKET ?? '',
            region: env.OBJECT_STORAGE_REGION,
            endpoint: env.OBJECT_STORAGE_ENDPOINT ?? null,
            forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE,
            accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID ?? null,
            secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? null,
          }
        : { driver: 'local', localRoot: env.OBJECT_STORAGE_LOCAL_ROOT },
    assets: { maxUploadBytes: env.ASSET_MAX_UPLOAD_BYTES },
    imports: loadImportSettings(source),
    production: loadProductionSettings(source),
    auth: {
      sessionTtlMs: env.AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000,
      idleTimeoutMs: env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000,
      cookieSecure,
      // The __Host- prefix binds the cookie to this exact origin (requires Secure, Path=/, no Domain).
      cookieName: cookieSecure ? '__Host-smarttag_session' : 'smarttag_session',
      loginRateLimitPerMinute: env.AUTH_LOGIN_RATE_LIMIT_PER_MINUTE,
    },
  };
}
