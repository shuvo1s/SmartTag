import type {
  DataImportDto,
  DatasetRecordPageDto,
  DatasetVersionDetailDto,
  MappingProfileDto,
} from '@smarttag/shared-types';
import { buildXlsxWorkbook, buildZip } from '@smarttag/tabular-sources/testing';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createVariableDataHangTagDocument } from '@smarttag/document-utils/fixtures';
import { prepareDocumentForStorage } from '../../src/modules/templates/document-storage';
import {
  API,
  createTestApp,
  createUser,
  loginAs,
  resetDatabase,
  seedSampleAssets,
  seedTenants,
  type TestApp,
} from './helpers';
import {
  GOOD_ROWS,
  createVariableDataTemplate,
  hangTagCsv,
  hangTagMapping,
  mappedImport,
  startImportWorker,
  uploadCsv,
  validatedImport,
  waitForImport,
} from './import-helpers';

async function createImageAsset(
  t: TestApp,
  organizationId: string,
  createdById: string,
): Promise<string> {
  const asset = await t.prisma.asset.create({
    data: {
      organizationId,
      assetType: 'IMAGE',
      filename: 'shirt.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      storageKey: `organizations/${organizationId}/assets/sha256/cc/shirt`,
      checksumSha256: 'c'.repeat(64),
      widthPx: 10,
      heightPx: 10,
      createdById,
    },
  });
  return asset.id;
}

describe('data imports: tenant isolation, permissions, file safety and asset references', () => {
  let t: TestApp;
  let worker: { close(): Promise<void> };
  let tenants: Awaited<ReturnType<typeof seedTenants>>;
  let operator: TestAgent;
  let viewer: TestAgent;
  let approver: TestAgent;
  let designer: TestAgent;
  let adminB: TestAgent;
  let versionId: string;

  beforeAll(async () => {
    t = await createTestApp();
    worker = await startImportWorker(t);
  });
  afterAll(async () => {
    await worker.close();
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    tenants = await seedTenants(t.prisma);
    await createUser(t.prisma, 'data.a@test.local', [
      { organizationId: tenants.orgA.id, roles: ['DATA_OPERATOR'] },
    ]);
    await seedSampleAssets(t.prisma, tenants.orgA.id, tenants.users.adminA.id);
    designer = await loginAs(t, 'designer.a@test.local');
    versionId = (await createVariableDataTemplate(designer)).version.id;
    operator = await loginAs(t, 'data.a@test.local');
    viewer = await loginAs(t, 'viewer.a@test.local');
    approver = await loginAs(t, 'approver.a@test.local');
    adminB = await loginAs(t, 'admin.b@test.local');
  });

  it('other tenants get 404 for imports, rows, sources, datasets, versions and profiles, and see none of them', async () => {
    const validated = await validatedImport(operator, versionId, hangTagCsv(GOOD_ROWS));
    const profile = (
      await operator
        .post(`${API}/mapping-profiles`)
        .send({ name: 'A only', importId: validated.id })
    ).body as MappingProfileDto;
    const refreshed = (await operator.get(`${API}/data-imports/${validated.id}`))
      .body as DataImportDto;
    const version = (
      await operator.post(`${API}/data-imports/${validated.id}/finalize`).send({
        expectedRevision: refreshed.revision,
        acknowledgeWarnings: false,
        dataset: { mode: 'NEW', name: 'Tenant A data' },
      })
    ).body as DatasetVersionDetailDto;

    for (const path of [
      `/data-imports/${validated.id}`,
      `/data-imports/${validated.id}/rows`,
      `/data-imports/${validated.id}/rows/1`,
      `/data-imports/${validated.id}/source`,
      `/datasets/${version.dataset.id}`,
      `/dataset-versions/${version.id}`,
      `/dataset-versions/${version.id}/records`,
      `/dataset-versions/${version.id}/source`,
      `/mapping-profiles/${profile.id}`,
    ]) {
      const response = await adminB.get(`${API}${path}`);
      expect(response.status, path).toBe(404);
    }
    for (const path of ['/data-imports', '/datasets']) {
      expect(((await adminB.get(`${API}${path}`)).body as { total: number }).total, path).toBe(0);
    }
    expect((await adminB.get(`${API}/mapping-profiles`)).body).toEqual([]);

    // Cross-tenant writes are refused the same way.
    expect((await uploadCsv(adminB, versionId, hangTagCsv(GOOD_ROWS))).status).toBe(404);
    expect(
      (
        await adminB
          .post(`${API}/data-imports/${validated.id}/cancel`)
          .send({ expectedRevision: 1 })
      ).status,
    ).toBe(404);
    expect(
      (
        await adminB
          .patch(`${API}/mapping-profiles/${profile.id}`)
          .send({ expectedRevision: 1, name: 'stolen' })
      ).status,
    ).toBe(404);
  });

  it("an organization can never apply another organization's mapping profile, even with the same schema", async () => {
    const importA = await mappedImport(operator, versionId, hangTagCsv(GOOD_ROWS));
    const profileA = (
      await operator
        .post(`${API}/mapping-profiles`)
        .send({ name: 'Shared schema', importId: importA.id })
    ).body as MappingProfileDto;

    // Tenant B has an identical template (same data schema hash) and file.
    const userB = await createUser(t.prisma, 'data.b@test.local', [
      { organizationId: tenants.orgB.id, roles: ['DATA_OPERATOR'] },
    ]);
    const prepared = await prepareDocumentForStorage(createVariableDataHangTagDocument());
    const templateB = await t.prisma.template.create({
      data: {
        organizationId: tenants.orgB.id,
        code: 'HT-VDP-B',
        name: 'B',
        documentType: 'HANG_TAG',
        latestVersionNumber: 1,
        createdById: userB.id,
        updatedById: userB.id,
      },
    });
    const versionB = await t.prisma.templateVersion.create({
      data: {
        organizationId: tenants.orgB.id,
        templateId: templateB.id,
        versionNumber: 1,
        ...prepared,
        createdById: userB.id,
      },
    });
    const agentB = await loginAs(t, 'data.b@test.local');
    const importB = await waitForImport(
      agentB,
      ((await uploadCsv(agentB, versionB.id, hangTagCsv(GOOD_ROWS))).body as DataImportDto).id,
    );
    expect(importB.templateVersion.dataSchemaHash).toBe(importA.templateVersion.dataSchemaHash);
    expect(importB.profileEvaluations).toEqual([]);
    const applied = await agentB.patch(`${API}/data-imports/${importB.id}/mapping`).send({
      expectedRevision: importB.revision,
      mapping: hangTagMapping(importB.columns),
      profile: { id: profileA.id, revision: 1 },
    });
    expect(applied.status).toBe(404);
    expect(applied.body.error.message).toBe('Mapping profile not found');
    expect(
      (await agentB.post(`${API}/mapping-profiles`).send({ name: 'x', importId: importA.id }))
        .status,
    ).toBe(404);
  });

  it('permissions: viewers and approvers read but cannot import or finalize; designers import but cannot finalize', async () => {
    const content = hangTagCsv(GOOD_ROWS);
    for (const agent of [viewer, approver]) {
      expect((await uploadCsv(agent, versionId, content)).status).toBe(403);
    }
    const validated = await validatedImport(operator, versionId, content);
    expect((await viewer.get(`${API}/data-imports/${validated.id}`)).status).toBe(200);
    expect((await approver.get(`${API}/data-imports/${validated.id}/rows`)).status).toBe(200);
    for (const agent of [viewer, approver]) {
      expect(
        (
          await agent.patch(`${API}/data-imports/${validated.id}/mapping`).send({
            expectedRevision: validated.revision,
            mapping: hangTagMapping(validated.columns),
            profile: null,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await agent
            .post(`${API}/data-imports/${validated.id}/validate`)
            .send({ expectedRevision: validated.revision })
        ).status,
      ).toBe(403);
      expect(
        (await agent.post(`${API}/mapping-profiles`).send({ name: 'nope', importId: validated.id }))
          .status,
      ).toBe(403);
    }
    const finalizeBody = {
      expectedRevision: validated.revision,
      acknowledgeWarnings: false,
      dataset: { mode: 'NEW', name: 'Perms' },
    };
    for (const agent of [viewer, approver, designer]) {
      expect(
        (await agent.post(`${API}/data-imports/${validated.id}/finalize`).send(finalizeBody))
          .status,
      ).toBe(403);
    }
    // Designers may import and validate.
    expect((await uploadCsv(designer, versionId, content)).status).toBe(201);
    expect(
      (await operator.post(`${API}/data-imports/${validated.id}/finalize`).send(finalizeBody))
        .status,
    ).toBe(200);
  });

  it('the original source file is downloadable only with dataset:read-source, as a sandboxed attachment', async () => {
    const content = hangTagCsv(GOOD_ROWS);
    const uploaded = (await uploadCsv(operator, versionId, content, '../../evil "name".csv'))
      .body as DataImportDto;
    expect(uploaded.source.filename).toBe('evil name.csv');
    await waitForImport(operator, uploaded.id);
    expect((await viewer.get(`${API}/data-imports/${uploaded.id}/source`)).status).toBe(403);
    expect((await designer.get(`${API}/data-imports/${uploaded.id}/source`)).status).toBe(403);
    const download = await operator
      .get(`${API}/data-imports/${uploaded.id}/source`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect((download.body as Buffer).equals(content)).toBe(true);
    expect(download.headers['content-disposition']).toMatch(
      /^attachment; filename="evil name.csv"/,
    );
    expect(download.headers['content-security-policy']).toContain('sandbox');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(await t.prisma.auditEvent.count({ where: { action: 'DATA_SOURCE_DOWNLOADED' } })).toBe(
      1,
    );
  });

  it('image cells accept only placeable image assets of the same organization', async () => {
    const own = await createImageAsset(t, tenants.orgA.id, tenants.users.adminA.id);
    const foreign = await createImageAsset(t, tenants.orgB.id, tenants.users.adminB.id);
    const row = (image: string, style: string) => [
      style,
      'Shirt',
      'Navy',
      'XL',
      '39,95',
      '9501234567891',
      image,
    ];
    const validated = await validatedImport(
      operator,
      versionId,
      hangTagCsv([
        row(own, 'YT-2001'),
        row(foreign, 'YT-2002'),
        row('https://cdn.example.com/shirt.png', 'YT-2003'),
        row('0192b8a0-0000-7000-8000-00000000dead', 'YT-2004'),
      ]),
    );
    expect(validated.status).toBe('HAS_ERRORS');
    const rows = (await operator.get(`${API}/data-imports/${validated.id}/rows`))
      .body as DatasetRecordPageDto;
    const codes = (rowNumber: number) =>
      rows.items.find((item) => item.rowNumber === rowNumber)!.issues.map((issue) => issue.code);
    expect(rows.items.map((item) => [item.rowNumber, item.status])).toEqual([
      [2, 'VALID'],
      [3, 'ERROR'],
      [4, 'ERROR'],
      [5, 'ERROR'],
    ]);
    // Another tenant's asset id is indistinguishable from an unknown id.
    expect(codes(3)).toEqual(codes(5));
    expect(codes(3)).toEqual(expect.arrayContaining(['UNKNOWN_ASSET_REFERENCE']));
    // Links are never downloaded.
    expect(codes(4)[0]).toBe('IMAGE_REFERENCE_NOT_SUPPORTED');
  });

  describe('uploaded files are untrusted', () => {
    const upload = (agent: TestAgent, content: Buffer, filename: string) =>
      agent
        .post(`${API}/template-versions/${versionId}/imports`)
        .attach('file', content, { filename, contentType: 'text/csv' });

    it('refuses legacy, macro-enabled, binary and disguised files by content, not by MIME type', async () => {
      const ole = Buffer.concat([
        Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        Buffer.alloc(64),
      ]);
      const zip = buildZip({ 'readme.txt': 'x' });
      const macro = buildXlsxWorkbook({
        sheets: [{ name: 'Data', rows: [['A']] }],
        extraParts: { 'xl/vbaProject.bin': new Uint8Array([1]) },
      });
      const cases: [Buffer, string, number, string, RegExp][] = [
        [ole, 'legacy.xls', 415, 'UNSUPPORTED_IMPORT_FORMAT', /Legacy XLS/],
        [macro, 'macro.xlsm', 415, 'UNSUPPORTED_IMPORT_FORMAT', /Macro-enabled/],
        [macro, 'renamed.xlsx', 415, 'UNSUPPORTED_IMPORT_FORMAT', /macros/],
        [zip, 'renamed.csv', 415, 'UNSUPPORTED_IMPORT_FORMAT', /ZIP archive/],
        [ole, 'encrypted.xlsx', 415, 'UNSUPPORTED_IMPORT_FORMAT', /password-protected/],
        [zip, 'broken.xlsx', 422, 'IMPORT_FILE_MALFORMED', /not a valid workbook/],
        [Buffer.from('x'), 'data.json', 415, 'UNSUPPORTED_IMPORT_FORMAT', /not supported/],
      ];
      for (const [content, filename, status, code, message] of cases) {
        const response = await upload(operator, content, filename);
        expect(response.status, filename).toBe(status);
        expect(response.body.error.code, filename).toBe(code);
        expect(response.body.error.message, filename).toMatch(message);
      }
      expect(await t.prisma.dataSourceFile.count()).toBe(0);
    });

    it('refuses oversized uploads while streaming', async () => {
      const small = await createTestApp({ IMPORT_MAX_FILE_BYTES: '4096' });
      try {
        const agent = await loginAs(small, 'data.a@test.local');
        const response = await agent
          .post(`${API}/template-versions/${versionId}/imports`)
          .attach('file', Buffer.alloc(10_000, 'a'), {
            filename: 'big.csv',
            contentType: 'text/csv',
          });
        expect(response.status).toBe(413);
        expect(response.body.error.code).toBe('IMPORT_FILE_TOO_LARGE');
      } finally {
        await small.close();
      }
    });

    it('malformed CSV fails inspection with a readable reason; ZIP bombs are refused before inflating', async () => {
      const malformed = await waitForImport(
        operator,
        (
          (await upload(operator, Buffer.from('a,b\n"never closed,1\n'), 'bad.csv'))
            .body as DataImportDto
        ).id,
      );
      expect(malformed.status).toBe('FAILED');
      expect(malformed.failure).toMatchObject({
        code: 'MALFORMED_FILE',
        stage: 'INSPECTION',
        retryable: false,
      });
      expect(await t.prisma.auditEvent.count({ where: { action: 'DATA_IMPORT_FAILED' } })).toBe(1);

      const bomb = buildXlsxWorkbook({
        sheets: [{ name: 'Data', rows: [['A']] }],
        extraParts: { 'xl/media/pad.bin': new Uint8Array(20 * 1024 * 1024) },
        level: 9,
      });
      const refused = await upload(operator, bomb, 'bomb.xlsx');
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('WORKBOOK_LIMIT_EXCEEDED');
    });
  });
});
