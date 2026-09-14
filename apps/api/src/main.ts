import 'reflect-metadata';
import 'dotenv/config';
import { EnvironmentValidationError } from '@smarttag/config';
import { createApp } from './bootstrap';
import { loadAppConfig } from './config/env.schema';

async function main(): Promise<void> {
  let config;
  try {
    config = loadAppConfig(process.env);
  } catch (error) {
    if (error instanceof EnvironmentValidationError) {
      // The logger is not available yet; the message lists variable names only, never values.
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const app = await createApp(config);
  await app.listen(config.http.port, config.http.host);
}

void main();
