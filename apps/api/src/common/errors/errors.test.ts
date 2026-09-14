import { HttpException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { UuidParamPipe, ZodValidationPipe } from '../validation/zod-validation.pipe';
import { AppError } from './app-error';
import { toAppError } from './global-exception.filter';

describe('toAppError', () => {
  it('passes application errors through', () => {
    const error = AppError.conflict('duplicate');
    expect(toAppError(error)).toBe(error);
    expect(error.httpStatus).toBe(409);
  });

  it.each([
    [new NotFoundException('Cannot GET /api/v1/nope'), 'NOT_FOUND', 'Route not found'],
    [new PayloadTooLargeException('File too large'), 'PAYLOAD_TOO_LARGE', 'File too large'],
    [new ThrottlerException(), 'RATE_LIMITED', 'Too many requests. Please wait and try again.'],
    [new HttpException('boom', 503), 'INTERNAL_ERROR', 'An unexpected error occurred'],
  ])('maps framework exceptions: %s', (exception, code, message) => {
    expect(toAppError(exception)).toMatchObject({ code, message });
  });

  it('maps Prisma known request errors by code', () => {
    const prismaError = (code: string) =>
      Object.assign(new Error('db'), { name: 'PrismaClientKnownRequestError', code });
    expect(toAppError(prismaError('P2002')).code).toBe('CONFLICT');
    expect(toAppError(prismaError('P2025')).code).toBe('NOT_FOUND');
    expect(toAppError(prismaError('P2003')).code).toBe('VALIDATION_ERROR');
  });

  it('maps body-parser failures', () => {
    expect(
      toAppError(
        Object.assign(new SyntaxError('Unexpected token'), {
          type: 'entity.parse.failed',
          status: 400,
        }),
      ).code,
    ).toBe('VALIDATION_ERROR');
    expect(
      toAppError(Object.assign(new Error('too large'), { type: 'entity.too.large', status: 413 }))
        .code,
    ).toBe('PAYLOAD_TOO_LARGE');
  });

  it('never leaks internal error messages', () => {
    const result = toAppError(
      new Error('connection to 10.0.0.5 failed: password authentication failed for user "prod"'),
    );
    expect(result).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      details: null,
    });
  });

  it('distinguishes invalid documents from unsupported schema versions', () => {
    const issue = {
      code: 'DUPLICATE_ID',
      severity: 'error',
      path: ['pages', 0],
      message: 'dup',
    } as const;
    expect(AppError.invalidDocument([issue])).toMatchObject({
      code: 'INVALID_DOCUMENT',
      httpStatus: 422,
    });
    expect(AppError.invalidDocument([{ ...issue, code: 'UNSUPPORTED_SCHEMA_VERSION' }]).code).toBe(
      'UNSUPPORTED_SCHEMA_VERSION',
    );
  });
});

describe('validation pipes', () => {
  const pipe = new ZodValidationPipe(
    z.object({ name: z.string().min(1), size: z.object({ width: z.number() }) }),
  );

  it('returns parsed data', () => {
    expect(pipe.transform({ name: 'x', size: { width: 1 } })).toEqual({
      name: 'x',
      size: { width: 1 },
    });
  });

  it('throws VALIDATION_ERROR with dotted field paths', () => {
    try {
      pipe.transform({ name: '', size: { width: 'wide' } });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details?.fieldErrors?.map((e) => e.path)).toEqual([
        'name',
        'size.width',
      ]);
    }
  });

  it('reports malformed ids as not found', () => {
    const uuid = new UuidParamPipe('Template');
    expect(uuid.transform('0192F0A0-5B1E-7C3D-8E4F-1A2B3C4D5E6F')).toBe(
      '0192f0a0-5b1e-7c3d-8e4f-1a2b3c4d5e6f',
    );
    expect(() => uuid.transform("1' OR '1'='1")).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });
});
