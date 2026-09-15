import {
  SAMPLE_FONT_ASSET_IDS,
  createSampleHangTagDocument,
} from '@smarttag/document-utils/fixtures';
import type {
  AssetDto,
  FontFaceDto,
  PaginatedResponse,
  TemplateDto,
  TemplateVersionDetailDto,
} from '@smarttag/shared-types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TINY_PNG } from '../fixtures/images';
import {
  API,
  createTestApp,
  hangTagRequest,
  loginAs,
  resetDatabase,
  seedSampleAssets,
  seedTenants,
  type TestApp,
} from './helpers';

const FONT_DIR = resolve(__dirname, '../../prisma/seed-assets/fonts');
const BENGALI_FONT = readFileSync(resolve(FONT_DIR, 'NotoSansBengali-Regular.ttf'));

describe('font registry and controlled fonts in documents', () => {
  let t: TestApp;
  let tenants: Awaited<ReturnType<typeof seedTenants>>;
  let designer: TestAgent;
  let adminB: TestAgent;

  beforeAll(async () => {
    // Real font files are larger than the default 64 KiB integration upload limit.
    t = await createTestApp({ ASSET_MAX_UPLOAD_BYTES: String(1024 * 1024) });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    tenants = await seedTenants(t.prisma);
    designer = await loginAs(t, 'designer.a@test.local');
    adminB = await loginAs(t, 'admin.b@test.local');
  });

  it('registers uploaded fonts with metadata read from the font file', async () => {
    const upload = await designer
      .post(`${API}/assets`)
      .field('assetType', 'FONT')
      .attach('file', BENGALI_FONT, 'renamed-by-user.ttf');
    expect(upload.status).toBe(201);
    const asset = upload.body as AssetDto;

    const fonts = (await designer.get(`${API}/fonts`)).body as FontFaceDto[];
    expect(fonts).toHaveLength(1);
    expect(fonts[0]).toMatchObject({
      assetId: asset.id,
      filename: 'renamed-by-user.ttf',
      familyName: 'Noto Sans Bengali',
      subfamilyName: 'Regular',
      postscriptName: 'NotoSansBengali-Regular',
      fontVersion: 'Version 3.011',
      weight: 400,
      style: 'NORMAL',
      format: 'TTF',
      embeddingPermission: 'INSTALLABLE',
      unitsPerEm: 1000,
      ascender: 917,
      descender: -408,
      lineGap: 0,
      checksumSha256: asset.checksumSha256,
    });
    // Bengali block U+0980–U+09FF is covered (e.g. ব U+09AC).
    expect(fonts[0]!.unicodeRanges.some(([first, last]) => first <= 0x09ac && last >= 0x09ac)).toBe(
      true,
    );

    const audit = await t.prisma.auditEvent.findFirstOrThrow({
      where: { action: 'ASSET_CREATED', resourceId: asset.id },
    });
    expect(audit.metadata).toMatchObject({
      font: { familyName: 'Noto Sans Bengali', weight: 400, style: 'NORMAL' },
    });

    // Another tenant sees nothing.
    expect((await adminB.get(`${API}/fonts`)).body).toEqual([]);
  });

  it('refuses corrupt files posing as fonts and never registers them', async () => {
    const truncated = await designer
      .post(`${API}/assets`)
      .field('assetType', 'FONT')
      .attach('file', BENGALI_FONT.subarray(0, 2000), 'broken.ttf');
    expect(truncated.status).toBe(415);
    const image = await designer
      .post(`${API}/assets`)
      .field('assetType', 'FONT')
      .attach('file', TINY_PNG, 'font.ttf');
    expect(image.status).toBe(415);
    expect(await t.prisma.asset.count()).toBe(0);
    expect(await t.prisma.fontFace.count()).toBe(0);
  });

  it('filters asset listings by filename and usage on the server', async () => {
    await designer
      .post(`${API}/assets`)
      .field('assetType', 'FONT')
      .attach('file', BENGALI_FONT, 'bengali.ttf');
    await designer
      .post(`${API}/assets`)
      .field('assetType', 'LOGO')
      .attach('file', TINY_PNG, 'Brand Logo.png');
    const images = (
      await designer.get(`${API}/assets`).query({ usage: 'PLACEABLE_IMAGE', search: 'logo' })
    ).body as PaginatedResponse<AssetDto>;
    expect(images.items.map((item) => item.filename)).toEqual(['Brand Logo.png']);
    const fonts = (await designer.get(`${API}/assets`).query({ usage: 'FONT' }))
      .body as PaginatedResponse<AssetDto>;
    expect(fonts.items.map((item) => item.filename)).toEqual(['bengali.ttf']);
    const none = (await designer.get(`${API}/assets`).query({ search: 'nothing-matches' }))
      .body as PaginatedResponse<AssetDto>;
    expect(none.total).toBe(0);
  });

  describe('document validation against the registry', () => {
    let template: TemplateDto;

    beforeEach(async () => {
      template = (await designer.post(`${API}/templates`).send(hangTagRequest()))
        .body as TemplateDto;
      await seedSampleAssets(t.prisma, tenants.orgA.id, tenants.users.adminA.id);
    });

    const save = (document: unknown) =>
      designer
        .patch(`${API}/template-versions/${template.currentVersion!.id}`)
        .send({ document, expectedRevision: 1 });

    it('accepts text objects whose font asset matches family, weight and style', async () => {
      const response = await save(createSampleHangTagDocument({ documentId: template.id }));
      expect(response.status).toBe(200);
      expect((response.body as TemplateVersionDetailDto).summary.fontAssetIds).toHaveLength(4);
    });

    it('rejects unknown fonts, mismatched faces and fonts used as images', async () => {
      const document = createSampleHangTagDocument({ documentId: template.id });
      const [front] = document.pages;
      front!.objects = front!.objects.map((object) => {
        if (object.id === 'front-product-name' && object.type === 'text') {
          return { ...object, fontWeight: 400 }; // font asset is the 700 face
        }
        if (object.id === 'front-size' && object.type === 'text') {
          return { ...object, fontAssetId: '0192f0a0-5b1e-7c3d-9b01-0000000000ff' };
        }
        if (object.id === 'front-logo' && object.type === 'image') {
          return { ...object, assetId: SAMPLE_FONT_ASSET_IDS.notoSansBold };
        }
        return object;
      });
      const response = await save(document);
      expect(response.status).toBe(422);
      expect(
        response.body.error.details.documentIssues.map(
          (issue: { code: string; path: unknown[] }) => [issue.code, issue.path.join('.')],
        ),
      ).toEqual([
        ['INVALID_ASSET_REFERENCE', 'pages.0.objects.1.assetId'],
        ['FONT_FACE_MISMATCH', 'pages.0.objects.2.fontAssetId'],
        ['UNKNOWN_FONT_ASSET', 'pages.0.objects.4.fontAssetId'],
      ]);
    });

    it("refuses another tenant's fonts", async () => {
      const templateB = (
        await adminB.post(`${API}/templates`).send(hangTagRequest({ code: 'B-FONTS' }))
      ).body as TemplateDto;
      const document = createSampleHangTagDocument({ documentId: templateB.id });
      const response = await adminB
        .patch(`${API}/template-versions/${templateB.currentVersion!.id}`)
        .send({ document, expectedRevision: 1 });
      expect(response.status).toBe(422);
      expect(
        response.body.error.details.documentIssues.filter(
          (issue: { code: string }) => issue.code === 'UNKNOWN_FONT_ASSET',
        ).length,
      ).toBeGreaterThan(0);
    });

    it('accepts a stored schema v1 document, stores it migrated and audits the change', async () => {
      const { SAMPLE_HANG_TAG_V1_JSON } = await import('@smarttag/document-utils/fixtures');
      const previous = await t.prisma.templateVersion.findUniqueOrThrow({
        where: { id: template.currentVersion!.id },
      });
      const response = await save({ ...SAMPLE_HANG_TAG_V1_JSON, documentId: template.id });
      expect(response.status).toBe(200);
      const version = response.body as TemplateVersionDetailDto;
      expect(version.schemaVersion).toBe(3);
      expect((version.document as { schemaVersion: number }).schemaVersion).toBe(3);

      const audit = await t.prisma.auditEvent.findFirstOrThrow({
        where: { action: 'TEMPLATE_VERSION_UPDATED', resourceId: version.id },
      });
      expect(audit.metadata).toEqual({
        revision: 2,
        previousDocumentHash: previous.documentHash,
        documentHash: version.documentHash,
        schemaVersion: 3,
        pageCount: 2,
        objectCount: 17,
      });
    });
  });
});
