import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../errors/app-error';

/**
 * Validates and transforms request input with a shared Zod contract from @smarttag/shared-types,
 * so the web client and the API apply identical rules.
 */
@Injectable()
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw AppError.validation(
        'Request validation failed',
        result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}

/** Validates a single path parameter as a UUID. Invalid ids are reported as not found. */
@Injectable()
export class UuidParamPipe implements PipeTransform<string, string> {
  private static readonly UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  constructor(private readonly resource: string) {}

  transform(value: string): string {
    if (!UuidParamPipe.UUID.test(value)) {
      throw AppError.notFound(this.resource);
    }
    return value.toLowerCase();
  }
}
