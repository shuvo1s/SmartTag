import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { APP_CONFIG, type AppConfig } from '../../config/env.schema';
import type { AppRequest } from '../http/request-context';

const REQUEST_ID_HEADER = 'x-request-id';
const INCOMING_REQUEST_ID = /^[A-Za-z0-9._:-]{8,100}$/;

/** Fields that must never appear in logs. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.secret',
  '*.secretAccessKey',
];

/**
 * Structured JSON logging (pino). Each request gets a correlation id — taken from a well-formed
 * incoming X-Request-Id or generated — echoed in the response header, attached to every log line,
 * error envelope and audit event, and (later) propagated into background jobs.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.environment === 'test' ? 'silent' : config.logLevel,
          redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
          genReqId: (request: IncomingMessage, response: ServerResponse) => {
            const incoming = request.headers[REQUEST_ID_HEADER];
            const id = typeof incoming === 'string' && INCOMING_REQUEST_ID.test(incoming) ? incoming : randomUUID();
            response.setHeader(REQUEST_ID_HEADER, id);
            return id;
          },
          customProps: (request: IncomingMessage) => {
            const actor = (request as AppRequest).actor;
            return actor ? { organizationId: actor.organizationId, userId: actor.userId } : {};
          },
          serializers: {
            req: (request: { id: string; method: string; url: string }) => ({
              id: request.id,
              method: request.method,
              // Query strings may contain search terms; keep the path only.
              path: request.url.split('?')[0],
            }),
            res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
          },
          autoLogging: {
            ignore: (request: IncomingMessage) => request.url === '/api/v1/health',
          },
        },
      }),
    }),
  ],
})
export class LoggingModule {}
