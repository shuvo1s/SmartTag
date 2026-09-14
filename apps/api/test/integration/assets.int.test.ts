import { createHash } from 'node:crypto';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TINY_PNG } from '../fixtures/images';
import { API, createTestApp, loginAs, resetDatabase, seedTenants, type TestApp } from './helpers';

describe('assets API & storage abstraction', () => {
  let t: TestApp;
  let designer: TestAgent;
  let viewer: TestAgent;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedTenants(t.prisma);
    designer = await loginAs(t, 'designer.a@test.local');
    viewer = await loginAs(t, 'viewer.a@test.local');
  });

  it('stores an upload with SHA-256 checksum, detected type and pixel size, and serves it back', async () => {
    const upload = await designer.post(`${API}/assets`).field('assetType', 'LOGO').attach('file', TINY_PNG, { filename: '../../brand logo.png', contentType: 'text/plain' });
    expect(upload.status).toBe(201);
    expect(upload.body).toMatchObject({
      assetType: 'LOGO',
      filename: 'brand logo.png',
      mimeType: 'image/png', // detected from content, not from the client
      sizeBytes: TINY_PNG.length,
      checksumSha256: createHash('sha256').update(TINY_PNG).digest('hex'),
      widthPx: 2,
      heightPx: 1,
    });

    const stored = await t.prisma.asset.findUniqueOrThrow({ where: { id: upload.body.id } });
    expect(stored.storageKey).toBe(`organizations/${stored.organizationId}/assets/sha256/${stored.checksumSha256.slice(0, 2)}/${stored.checksumSha256}`);
    expect(await t.prisma.auditEvent.count({ where: { action: 'ASSET_CREATED', resourceId: upload.body.id } })).toBe(1);

    const content = await viewer.get(`${API}/assets/${upload.body.id}/content`).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(content.status).toBe(200);
    expect(Buffer.compare(content.body as Buffer, TINY_PNG)).toBe(0);
    expect(content.headers).toMatchObject({
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      etag: `"${stored.checksumSha256}"`,
    });
    expect(content.headers['content-security-policy']).toContain('sandbox');
  });

  it('deduplicates identical content in storage while keeping separate asset records', async () => {
    const first = await designer.post(`${API}/assets`).field('assetType', 'IMAGE').attach('file', TINY_PNG, 'one.png');
    const second = await designer.post(`${API}/assets`).field('assetType', 'ICON').attach('file', TINY_PNG, 'two.png');
    expect(first.body.id).not.toBe(second.body.id);
    const keys = await t.prisma.asset.findMany({ select: { storageKey: true } });
    expect(new Set(keys.map((k) => k.storageKey)).size).toBe(1);
  });

  it('rejects disguised, mismatched, empty and oversized files', async () => {
    const disguised = await designer.post(`${API}/assets`).field('assetType', 'IMAGE').attach('file', Buffer.from('<html><script>alert(1)</script>'), 'evil.png');
    expect(disguised.status).toBe(415);
    expect(disguised.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const wrongType = await designer.post(`${API}/assets`).field('assetType', 'FONT').attach('file', TINY_PNG, 'font.ttf');
    expect(wrongType.status).toBe(415);

    const missing = await designer.post(`${API}/assets`).field('assetType', 'IMAGE');
    expect(missing.status).toBe(400);

    const oversized = await designer.post(`${API}/assets`).field('assetType', 'IMAGE').attach('file', Buffer.concat([TINY_PNG, Buffer.alloc(70 * 1024)]), 'big.png');
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe('PAYLOAD_TOO_LARGE');

    const badAssetType = await designer.post(`${API}/assets`).field('assetType', 'SPACESHIP').attach('file', TINY_PNG, 'a.png');
    expect(badAssetType.status).toBe(400);

    expect(await t.prisma.asset.count()).toBe(0);
  });

  it('enforces asset permissions', async () => {
    const response = await viewer.post(`${API}/assets`).field('assetType', 'IMAGE').attach('file', TINY_PNG, 'a.png');
    expect(response.status).toBe(403);
    expect((await viewer.get(`${API}/assets`)).status).toBe(200);
  });
});
