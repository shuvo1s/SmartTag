import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { ApiErrorBody, ErrorCode } from '@smarttag/shared-types';
import type { Response } from 'express';
import type { AppRequest } from '../http/request-context';
import { AppError } from './app-error';

const PRISMA_KNOWN_ERROR = 'PrismaClientKnownRequestError';

/**
 * Converts every thrown value into the structured ApiErrorBody envelope. Unexpected errors are
 * logged with their stack and returned as INTERNAL_ERROR without leaking internals.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<AppRequest>();
    const requestId = typeof request.id === 'string' ? request.id : null;

    const appError = toAppError(exception);
    if (appError.code === 'INTERNAL_ERROR') {
      this.logger.error(
        { err: exception, requestId, method: request.method, path: request.path },
        'Unhandled error while processing request',
      );
    }

    const body: ApiErrorBody = {
      error: { code: appError.code, message: appError.message, details: appError.details, requestId },
    };
    if (!response.headersSent) {
      response.status(appError.httpStatus).json(body);
    }
  }
}

export function toAppError(exception: unknown): AppError {
  if (exception instanceof AppError) {
    return exception;
  }
  if (exception instanceof ThrottlerException) {
    return new AppError('RATE_LIMITED', 'Too many requests. Please wait and try again.');
  }
  if (exception instanceof HttpException) {
    return fromHttpException(exception);
  }
  if (isPrismaKnownError(exception)) {
    switch (exception.code) {
      case 'P2002':
        return AppError.conflict('A record with the same unique value already exists');
      case 'P2025':
        return AppError.notFound('Resource');
      case 'P2003':
        return AppError.validation('A referenced record does not exist or belongs to another organization');
    }
  }
  if (isBodyParserError(exception)) {
    return exception.type === 'entity.too.large'
      ? new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large')
      : AppError.validation('Malformed request body');
  }
  return new AppError('INTERNAL_ERROR', 'An unexpected error occurred');
}

function fromHttpException(exception: HttpException): AppError {
  const status = exception.getStatus();
  const byStatus: Partial<Record<number, ErrorCode>> = {
    [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
    [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
    [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
    [HttpStatus.CONFLICT]: 'CONFLICT',
    [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
    [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
    [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  };
  const code = byStatus[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR');
  const message =
    code === 'INTERNAL_ERROR'
      ? 'An unexpected error occurred'
      : code === 'NOT_FOUND' && /^Cannot (GET|POST|PUT|PATCH|DELETE)/.test(exception.message)
        ? 'Route not found'
        : exception.message;
  return new AppError(code, message);
}

function isPrismaKnownError(value: unknown): value is { code: string; name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { name?: unknown }).name === PRISMA_KNOWN_ERROR &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

function isBodyParserError(value: unknown): value is { type: string; status: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    typeof (value as { status?: unknown }).status === 'number'
  );
}
