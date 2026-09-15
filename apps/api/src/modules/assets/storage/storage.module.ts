import { Global, Module } from '@nestjs/common';
import { isAbsolute, resolve } from 'node:path';
import { APP_CONFIG, type AppConfig } from '../../../config/env.schema';
import { LocalFilesystemStorage } from './local-filesystem.storage';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage';
import { S3Storage } from './s3.storage';

export function createObjectStorage(
  config: AppConfig['objectStorage'],
  cwd = process.cwd(),
): ObjectStorage {
  switch (config.driver) {
    case 'local':
      return new LocalFilesystemStorage(
        isAbsolute(config.localRoot) ? config.localRoot : resolve(cwd, config.localRoot),
      );
    case 's3':
      return new S3Storage(config);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createObjectStorage(config.objectStorage),
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
