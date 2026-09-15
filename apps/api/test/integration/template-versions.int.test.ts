import type { DesignDocument } from '@smarttag/document-schema';
import { computeDocumentHash, createTextObject } from '@smarttag/document-utils';
import { createSampleHangTagDocument } from '@smarttag/document-utils/fixtures';
import type { TemplateDto, TemplateVersionDetailDto } from '@smarttag/shared-types';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

describe('template versions: creation, drafts, lifecycle and immutability', () => {
  let t: TestApp;
  let tenants: Awaited<ReturnType<typeof seedTenants>>;
  let designer: TestAgent;
  let approver: TestAgent;
  let admin: TestAgent;
  let template: TemplateDto;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    tenants = await seedTenants(t.prisma);
    designer = await loginAs(t, 'designer.a@test.local');
    approver = await loginAs(t, 'approver.a@test.local');
    admin = await loginAs(t, 'admin.a@test.local');
    template = (await designer.post(`${API}/templates`).send(hangTagRequest())).body as TemplateDto;
    await seedSampleAssets(t.prisma, tenants.orgA.id, tenants.users.adminA.id);
  });

  const sampleFor = (templateId: string): DesignDocument =>
    createSampleHangTagDocument({ documentId: templateId });

  async function createVersion(document: unknown = sampleFor(template.id), agent = designer) {
    return agent
      .post(`${API}/templates/${template.id}/versions`)
      .send({ document, changeSummary: 'Artwork' });
  }

  async function transition(agent: TestAgent, versionId: string, targetStatus: string) {
    return agent.post(`${API}/template-versions/${versionId}/transitions`).send({ targetStatus });
  }

  it('creates the next version from a full document and moves the head pointer', async () => {
    const document = sampleFor(template.id);
    const response = await createVersion(document);
    expect(response.status).toBe(201);
    const version = response.body as TemplateVersionDetailDto;
    expect(version).toMatchObject({
      versionNumber: 2,
      status: 'DRAFT',
      revision: 1,
      schemaVersion: 3,
      basedOnVersionId: template.currentVersion!.id,
      changeSummary: 'Artwork',
      documentHash: await computeDocumentHash(document),
    });
    expect(version.summary.boundFieldKeys).toEqual(
      expect.arrayContaining(['product_name', 'size', 'price', 'gtin']),
    );

    const refreshed = (await designer.get(`${API}/templates/${template.id}`)).body as TemplateDto;
    expect(refreshed).toMatchObject({
      latestVersionNumber: 2,
      currentVersion: { id: version.id, versionNumber: 2 },
    });

    const list = await designer.get(`${API}/templates/${template.id}/versions`);
    expect(list.body.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);
  });

  it('copies content from a base version when no document is supplied', async () => {
    const v2 = (await createVersion()).body as TemplateVersionDetailDto;
    const v3 = await designer
      .post(`${API}/templates/${template.id}/versions`)
      .send({ basedOnVersionId: v2.id });
    expect(v3.status).toBe(201);
    expect(v3.body).toMatchObject({
      versionNumber: 3,
      basedOnVersionId: v2.id,
      documentHash: v2.documentHash,
    });
  });

  it('allocates unique, gap-free version numbers under concurrency', async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => createVersion()));
    expect(responses.map((r) => r.status)).toEqual(Array(6).fill(201));
    const numbers = responses
      .map((r) => (r.body as TemplateVersionDetailDto).versionNumber)
      .sort((a, b) => a - b);
    expect(numbers).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it.each([
    ['structurally invalid', { schemaVersion: 1, pages: [] }, 'INVALID_DOCUMENT', 422],
    [
      'future schema version',
      { ...createSampleHangTagDocument(), schemaVersion: 99 },
      'UNSUPPORTED_SCHEMA_VERSION',
      422,
    ],
    ['not a JSON object', 'just a string', 'INVALID_DOCUMENT', 422],
  ])('rejects a %s document', async (_label, document, code, status) => {
    const response = await createVersion(document);
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect(response.body.error.details.documentIssues.length).toBeGreaterThan(0);
    expect(await t.prisma.templateVersion.count()).toBe(1);
  });

  it('rejects documents that belong to another template or reference missing assets', async () => {
    const foreign = await createVersion(createSampleHangTagDocument());
    expect(foreign.status).toBe(422);
    expect(
      foreign.body.error.details.documentIssues.map((i: { code: string }) => i.code),
    ).toContain('DOCUMENT_ID_MISMATCH');

    await t.prisma.fontFace.deleteMany();
    await t.prisma.asset.deleteMany();
    const missingAsset = await createVersion();
    expect(missingAsset.status).toBe(422);
    expect(missingAsset.body.error.details.documentIssues[0]).toMatchObject({
      code: 'UNKNOWN_ASSET_REFERENCE',
      path: ['pages', 0, 'objects', 1, 'assetId'],
    });
  });

  describe('draft editing', () => {
    it('updates a draft with optimistic concurrency and a new hash', async () => {
      const v2 = (await createVersion()).body as TemplateVersionDetailDto;
      const edited = sampleFor(template.id);
      edited.pages[1]!.objects.push(
        createTextObject({
          id: 'care',
          x: 20,
          y: 20,
          width: 80,
          height: 10,
          zIndex: 50,
          content: 'Wash cold',
        }),
      );

      const response = await designer
        .patch(`${API}/template-versions/${v2.id}`)
        .send({ document: edited, expectedRevision: 1 });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        revision: 2,
        documentHash: await computeDocumentHash(edited),
      });
      expect(response.body.documentHash).not.toBe(v2.documentHash);

      const stale = await designer
        .patch(`${API}/template-versions/${v2.id}`)
        .send({ document: edited, expectedRevision: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.error).toMatchObject({
        code: 'VERSION_CONFLICT',
        details: { currentRevision: 2 },
      });
      expect(
        await t.prisma.auditEvent.count({ where: { action: 'TEMPLATE_VERSION_UPDATED' } }),
      ).toBe(1);
    });

    it('requires template-version:edit-draft', async () => {
      const viewer = await loginAs(t, 'viewer.a@test.local');
      const v2 = (await createVersion()).body as TemplateVersionDetailDto;
      const response = await viewer
        .patch(`${API}/template-versions/${v2.id}`)
        .send({ document: sampleFor(template.id), expectedRevision: 1 });
      expect(response.status).toBe(403);
    });
  });

  describe('status lifecycle', () => {
    it('runs DRAFT → IN_REVIEW → APPROVED → RETIRED with the right roles', async () => {
      const v2 = (await createVersion()).body as TemplateVersionDetailDto;

      expect((await transition(approver, v2.id, 'IN_REVIEW')).status).toBe(403); // approvers do not submit
      const submitted = await transition(designer, v2.id, 'IN_REVIEW');
      expect(submitted.status).toBe(200);
      expect(submitted.body.status).toBe('IN_REVIEW');
      expect(submitted.body.submittedAt).not.toBeNull();

      expect((await transition(designer, v2.id, 'APPROVED')).status).toBe(403); // designers cannot approve
      const approved = await transition(approver, v2.id, 'APPROVED');
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({
        status: 'APPROVED',
        approvedBy: { id: tenants.users.approverA.id },
      });

      const retired = await transition(admin, v2.id, 'RETIRED');
      expect(retired.status).toBe(200);
      expect(retired.body.status).toBe('RETIRED');
      expect(retired.body.approvedAt).toBe(approved.body.approvedAt);

      const audit = await t.prisma.auditEvent.findMany({
        where: { action: 'TEMPLATE_VERSION_STATUS_CHANGED' },
        orderBy: { occurredAt: 'asc' },
      });
      expect(audit.map((event) => event.metadata)).toEqual([
        { from: 'DRAFT', to: 'IN_REVIEW', action: 'SUBMIT_FOR_REVIEW' },
        { from: 'IN_REVIEW', to: 'APPROVED', action: 'APPROVE' },
        { from: 'APPROVED', to: 'RETIRED', action: 'RETIRE' },
      ]);
    });

    it('never modifies an approved version: edits are refused and approval cannot be undone', async () => {
      const v2 = (await createVersion()).body as TemplateVersionDetailDto;
      await transition(designer, v2.id, 'IN_REVIEW');

      const inReviewEdit = await designer
        .patch(`${API}/template-versions/${v2.id}`)
        .send({ document: sampleFor(template.id), expectedRevision: 1 });
      expect(inReviewEdit.status).toBe(409);
      expect(inReviewEdit.body.error.code).toBe('VERSION_IMMUTABLE');

      await transition(approver, v2.id, 'APPROVED');
      const approvedEdit = await admin
        .patch(`${API}/template-versions/${v2.id}`)
        .send({ document: sampleFor(template.id), expectedRevision: 1 });
      expect(approvedEdit.status).toBe(409);
      expect(approvedEdit.body.error.code).toBe('VERSION_IMMUTABLE');

      const backToDraft = await transition(admin, v2.id, 'DRAFT');
      expect(backToDraft.status).toBe(409);
      expect(backToDraft.body.error.code).toBe('INVALID_STATUS_TRANSITION');

      const stored = await t.prisma.templateVersion.findUniqueOrThrow({ where: { id: v2.id } });
      expect(stored).toMatchObject({
        status: 'APPROVED',
        revision: 1,
        documentHash: v2.documentHash,
      });

      // Editing means creating a new version based on the approved one.
      const v3 = await designer
        .post(`${API}/templates/${template.id}/versions`)
        .send({ basedOnVersionId: v2.id, changeSummary: 'Next revision' });
      expect(v3.status).toBe(201);
      expect(v3.body).toMatchObject({ versionNumber: 3, status: 'DRAFT', basedOnVersionId: v2.id });
    });

    it('refuses approval when the stored document no longer matches its hash', async () => {
      const v2 = (await createVersion()).body as TemplateVersionDetailDto;
      await t.prisma.templateVersion.update({
        where: { id: v2.id },
        data: { documentHash: 'f'.repeat(64) },
      });
      const response = await transition(designer, v2.id, 'IN_REVIEW');
      expect(response.status).toBe(500);
      expect(response.body.error).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'Document integrity check failed',
      });
    });

    it('does not accept new versions on archived templates', async () => {
      await admin.patch(`${API}/templates/${template.id}`).send({ status: 'ARCHIVED' });
      const response = await createVersion();
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });
  });
});
