import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { AppConfig } from './config/env.schema';

export const API_PREFIX = 'api/v1';
/** Canonical design documents can be large; everything else is small JSON. */
export const JSON_BODY_LIMIT = '10mb';

/** Creates and configures the HTTP application. Shared by main.ts and the integration tests. */
export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.http.trustProxy ? 'loopback, linklocal, uniquelocal' : false);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: '100kb', extended: false });
  app.enableCors({ origin: [...config.http.allowedOrigins], credentials: true });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
