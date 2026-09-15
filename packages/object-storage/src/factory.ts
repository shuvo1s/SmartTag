import { isAbsolute, resolve } from 'node:path';
import { LocalFilesystemStorage } from './local-filesystem.storage';
import type { ObjectStorage } from './object-storage';
import { S3Storage, type S3StorageOptions } from './s3.storage';

export type ObjectStorageConfig =
  | { readonly driver: 'local'; readonly localRoot: string }
  | ({ readonly driver: 's3' } & S3StorageOptions);

/** Creates the configured storage driver. Relative local roots resolve against `cwd`. */
export function createObjectStorage(
  config: ObjectStorageConfig,
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
