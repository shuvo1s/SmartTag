import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TINY_PNG } from '../../../test/fixtures/images';
import {
  detectMimeType,
  inspectContent,
  isMimeAllowedForAssetType,
  sanitizeFilename,
} from './asset-content-inspector';
import { LocalFilesystemStorage } from './storage/local-filesystem.storage';
import {
  ObjectNotFoundError,
  assertValidObjectKey,
  assetStorageKey,
} from './storage/object-storage';

describe('asset content inspection', () => {
  it('detects file types from signatures, not names', () => {
    expect(detectMimeType(TINY_PNG)).toBe('image/png');
    expect(detectMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg');
    expect(detectMimeType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(detectMimeType(Buffer.from('wOF2abcd'))).toBe('font/woff2');
    expect(
      detectMimeType(
        Buffer.from(
          '<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"/>',
        ),
      ),
    ).toBe('image/svg+xml');
  });

  it('rejects unknown or disguised content', () => {
    expect(detectMimeType(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(detectMimeType(Buffer.from('MZ\x90\x00executable'))).toBeNull();
    expect(detectMimeType(Buffer.from('just text pretending to be .png'))).toBeNull();
  });

  it('reads pixel dimensions for raster images', () => {
    expect(inspectContent(TINY_PNG)).toEqual({ mimeType: 'image/png', widthPx: 2, heightPx: 1 });
    expect(
      inspectContent(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"/>'),
      ),
    ).toEqual({
      mimeType: 'image/svg+xml',
      widthPx: 600,
      heightPx: 240,
    });
  });

  it('sizes content with the parser for its detected type', () => {
    // Text that resembles another container format still goes to the SVG parser only.
    const disguised = Buffer.from(
      '<!--ftypavif-->\n<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"/>',
    );
    expect(inspectContent(disguised)).toEqual({
      mimeType: 'image/svg+xml',
      widthPx: 300,
      heightPx: 120,
    });
    // A truncated JPEG yields no dimensions instead of an error.
    expect(inspectContent(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toEqual({
      mimeType: 'image/jpeg',
      widthPx: null,
      heightPx: null,
    });
  });

  it('enforces asset type ↔ content type rules', () => {
    expect(isMimeAllowedForAssetType('FONT', 'font/otf')).toBe(true);
    expect(isMimeAllowedForAssetType('FONT', 'image/png')).toBe(false);
    expect(isMimeAllowedForAssetType('SVG', 'image/png')).toBe(false);
    expect(isMimeAllowedForAssetType('LOGO', 'application/pdf')).toBe(true);
  });

  it('sanitises filenames', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\me\\logo "final".png')).toBe('logo final.png');
    expect(sanitizeFilename('লোগো.svg')).toBe('লোগো.svg');
    expect(sanitizeFilename('\u0000\u0007')).toBe('asset');
  });
});

describe('object storage keys', () => {
  it('builds content-addressed, tenant-prefixed keys', () => {
    const checksum = 'ab'.repeat(32);
    expect(assetStorageKey('org-1', checksum)).toBe(
      `organizations/org-1/assets/sha256/ab/${checksum}`,
    );
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
