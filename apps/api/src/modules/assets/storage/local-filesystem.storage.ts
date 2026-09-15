import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  assertValidObjectKey,
  ObjectNotFoundError,
  type ObjectStorage,
  type PutObjectOptions,
  type StoredObject,
} from './object-storage';

/** Development/test storage on the local filesystem. Writes are atomic (temp file + rename). */
export class LocalFilesystemStorage implements ObjectStorage {
  readonly driver = 'local';
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async putObject(key: string, body: Buffer, _options: PutObjectOptions): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, body, { flag: 'wx' });
    await rename(temporary, target);
  }

  async getObject(key: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      return { body: createReadStream(path), contentLength: info.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ObjectNotFoundError(key);
      }
      throw error;
    }
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(key))).isFile();
    } catch {
      return false;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    assertValidObjectKey(key);
    const path = resolve(join(this.root, ...key.split('/')));
    if (!path.startsWith(this.root + sep)) {
      throw new Error('Object key resolves outside the storage root');
    }
    return path;
  }
}
