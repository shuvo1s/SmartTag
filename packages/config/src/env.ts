import { z } from 'zod';

/**
 * Environment validation shared by every server-side process (api, worker, scripts).
 * Processes validate their complete environment at startup and refuse to start on error.
 * Error messages name the offending variables but NEVER echo their values (they may be secrets).
 */
export class EnvironmentValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid environment configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'EnvironmentValidationError';
  }
}

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export function parseEnvironment<TSchema extends z.ZodType>(
  schema: TSchema,
  source: EnvironmentSource,
): z.output<TSchema> {
  // Treat empty strings as "unset" so that `FOO=` in a .env file behaves like an absent variable.
  const normalized = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const result = schema.safeParse(normalized);
  if (!result.success) {
    throw new EnvironmentValidationError(
      result.error.issues.map((issue) => {
        const name = issue.path.map(String).join('.') || '(environment)';
        return `${name}: ${issue.message}`;
      }),
    );
  }
  return result.data;
}

/** "true"/"false"/"1"/"0" → boolean. */
export const envBoolean = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((value) => (value === undefined ? defaultValue : value === 'true' || value === '1'));

export const envInteger = (defaultValue: number, options: { min?: number; max?: number } = {}) =>
  z.coerce
    .number()
    .int()
    .min(options.min ?? Number.MIN_SAFE_INTEGER)
    .max(options.max ?? Number.MAX_SAFE_INTEGER)
    .optional()
    .transform((value) => value ?? defaultValue);

export const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\/.+/, 'must be a postgresql:// connection URL');

export const redisUrl = z.string().regex(/^rediss?:\/\/.+/, 'must be a redis:// or rediss:// URL');

export const httpUrl = z.url({ protocol: /^https?$/ });

export const nodeEnvironment = z.enum(['development', 'test', 'production']).default('development');

export const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info');
