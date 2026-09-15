import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LocalFilesystemStorage,
  ObjectNotFoundError,
  assertValidObjectKey,
  assetStorageKey,
  createObjectStorage,
  dataSourceStorageKey,
} from '../src';

describe('object storage keys', () => {
  it('builds content-addressed, tenant-prefixed keys', () => {
    const checksum = 'ab'.repeat(32);
    expect(assetStorageKey('org-1', checksum)).toBe(
      `organizations/org-1/assets/sha256/ab/${checksum}`,
    );
  });

  it('keys data source uploads by source-file id, never by content', () => {
    expect(dataSourceStorageKey('org-1', 'file-9')).toBe('organizations/org-1/data-sources/file-9');
  });

  it.each(['../secret', '/absolute', 'a//b', 'trailing/', 'spaces are bad', ''])(
    'rejects unsafe key %p',
    (key) => {
      expect(() => assertValidObjectKey(key)).toThrow();
    },
  );
});

describe('LocalFilesystemStorage', () => {
  let root: string;
  let storage: LocalFilesystemStorage;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'smarttag-storage-'));
    storage = new LocalFilesystemStorage(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores, reads, checks and deletes objects', async () => {
    const key = 'organizations/o/assets/sha256/aa/abc';
    expect(await storage.objectExists(key)).toBe(false);
    await storage.putObject(key, Buffer.from('hello'), {
      contentType: 'text/plain',
      checksumSha256: 'x',
    });
    expect(await storage.objectExists(key)).toBe(true);
    const object = await storage.getObject(key);
    expect(object.contentLength).toBe(5);
    expect(await text(object.body)).toBe('hello');
    await storage.deleteObject(key);
    await expect(storage.getObject(key)).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('refuses keys that would escape the storage root', async () => {
    await expect(
      storage.putObject('../escape', Buffer.from('x'), {
        contentType: 'text/plain',
        checksumSha256: 'x',
      }),
    ).rejects.toThrow();
  });
});

describe('createObjectStorage', () => {
  it('resolves relative local roots against the given directory', () => {
    const storage = createObjectStorage({ driver: 'local', localRoot: 'data' }, tmpdir());
    expect(storage.driver).toBe('local');
  });
});
