import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EnvironmentValidationError,
  envBoolean,
  envInteger,
  parseEnvironment,
  postgresUrl,
} from '../src';

const schema = z.object({
  DATABASE_URL: postgresUrl,
  API_PORT: envInteger(4000, { min: 1, max: 65535 }),
  COOKIE_SECURE: envBoolean(true),
  SECRET_TOKEN: z.string().min(32),
});

describe('parseEnvironment', () => {
  it('parses, coerces and applies defaults', () => {
    const env = parseEnvironment(schema, {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      COOKIE_SECURE: 'false',
      SECRET_TOKEN: 'x'.repeat(32),
    });
    expect(env).toEqual({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      API_PORT: 4000,
      COOKIE_SECURE: false,
      SECRET_TOKEN: 'x'.repeat(32),
    });
  });

  it('treats empty strings as unset', () => {
    const env = parseEnvironment(schema, {
      DATABASE_URL: 'postgres://h/db',
      API_PORT: '',
      SECRET_TOKEN: 'y'.repeat(40),
    });
    expect(env.API_PORT).toBe(4000);
  });

  it('reports every problem without leaking secret values', () => {
    const secret = 'super-secret-but-too-short';
    try {
      parseEnvironment(schema, {
        DATABASE_URL: 'mysql://nope',
        API_PORT: '70000',
        SECRET_TOKEN: secret,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      const { problems, message } = error as EnvironmentValidationError;
      expect(problems.map((problem) => problem.split(':')[0])).toEqual([
        'DATABASE_URL',
        'API_PORT',
        'SECRET_TOKEN',
      ]);
      expect(message).not.toContain(secret);
      expect(message).not.toContain('mysql://nope');
    }
  });
});
