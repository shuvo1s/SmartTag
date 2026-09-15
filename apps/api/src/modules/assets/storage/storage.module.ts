import { Global, Module } from '@nestjs/common';
import { createObjectStorage } from '@smarttag/object-storage';
import { APP_CONFIG, type AppConfig } from '../../../config/env.schema';

/** Nest injection token for the process-wide ObjectStorage (@smarttag/object-storage). */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

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
