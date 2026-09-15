import type { DesignDocument } from '@smarttag/document-schema';
import {
  computeDocumentHash,
  createImageObject,
  expressionBinding,
  fieldBinding,
} from '@smarttag/document-utils';
import {
  VARIABLE_DATA_RECORD,
  createVariableDataHangTagDocument,
} from '@smarttag/document-utils/fixtures';
import type {
  TemplateDataValidationDto,
  TemplateDto,
  TemplateVersionDetailDto,
} from '@smarttag/shared-types';
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

/** The variable-data fixture plus a product image frame that prints (static visibility). */
function variableDataDocument(templateId: string): DesignDocument {
  const document = createVariableDataHangTagDocument({ documentId: templateId });
  document.pages[1]!.objects.push(
    createImageObject({
      id: 'vd-back-image',
      name: 'Back image',
      x: 40,
      y: 160,
      width: 60,
      height: 40,
      zIndex: 5,
      assetId: null,
      bindings: { assetId: fieldBinding('product_image') },
    }),
  );
  document.settings = { missingDataPolicy: 'EMPTY' };
  return document;
}

describe('template data: record validation API, data schema persistence and permissions', () => {
  let t: TestApp;
  let tenants: Awaited<ReturnType<typeof seedTenants>>;
  let designer: TestAgent;
  let viewer: TestAgent;
  let approver: TestAgent;
  let adminB: TestAgent;
  let template: TemplateDto;
  let draft: TemplateVersionDetailDto;

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
    viewer = await loginAs(t, 'viewer.a@test.local');
    approver = await loginAs(t, 'approver.a@test.local');
    adminB = await loginAs(t, 'admin.b@test.local');
    await seedSampleAssets(t.prisma, tenants.orgA.id, tenants.users.adminA.id);
    template = (await designer.post(`${API}/templates`).send(hangTagRequest())).body as TemplateDto;
    const saved = await designer
      .patch(`${API}/template-versions/${template.currentVersion!.id}`)
      .send({ document: variableDataDocument(template.id), expectedRevision: 1 });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    draft = saved.body as TemplateVersionDetailDto;
  });

  const validate = (agent: TestAgent, record: unknown, versionId = draft.id) =>
    agent.post(`${API}/template-versions/${versionId}/data/validate`).send({ record });

  it('persists the data schema, bindings and expressions and audits counts only', async () => {
    const stored = (await designer.get(`${API}/template-versions/${draft.id}`))
      .body as TemplateVersionDetailDto & { document: DesignDocument };
    expect(stored.schemaVersion).toBe(3);
    expect(stored.document.dataSchema.fields.map((field) => field.key)).toContain('is_sustainable');
    const recycled = stored.document.pages[0]!.objects.find((o) => o.id === 'vd-recycled')!;
    expect(recycled.bindings.visible).toEqual(expressionBinding('is_sustainable == true'));
    expect(stored.summary).toMatchObject({
      dataFieldCount: 11,
      boundPropertyCount: 11,
      expressionCount: 7,
    });
    expect(stored.documentHash).toBe(await computeDocumentHash(variableDataDocument(template.id)));

    const audit = await t.prisma.auditEvent.findFirstOrThrow({
      where: { action: 'TEMPLATE_VERSION_UPDATED', resourceId: draft.id },
    });
    expect(audit.metadata).toMatchObject({
      revision: 2,
      documentHash: draft.documentHash,
      schemaVersion: 3,
      fieldCount: 11,
      bindingCount: 11,
      expressionCount: 7,
    });
    // Metadata carries counts and hashes, never field values or expressions.
    expect(JSON.stringify(audit.metadata)).not.toContain('is_sustainable');
  });

  it('validates a record with shared validation and never modifies the version', async () => {
    const before = await t.prisma.templateVersion.findUniqueOrThrow({ where: { id: draft.id } });
    const response = await validate(designer, VARIABLE_DATA_RECORD);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const body = response.body as TemplateDataValidationDto;
    expect(body).toMatchObject({
      templateVersionId: draft.id,
      documentHash: draft.documentHash,
      schemaVersion: 3,
      valid: true,
      productionValid: true,
      summary: { fieldsChecked: 11, valid: 11, warnings: 0, errors: 0 },
    });
    // The back image frame prints without an image for this record: a display warning only.
    expect(body.issues).toEqual([
      expect.objectContaining({
        layer: 'OBJECT',
        code: 'IMAGE_SOURCE_MISSING',
        severity: 'WARNING',
      }),
    ]);
    expect(body.normalizedRecord).toMatchObject({
      price: '39.95',
      is_sustainable: true,
      product_image: null,
    });
    expect(body.resolvedInputHash).toMatch(/^[0-9a-f]{64}$/);

    // Same logical record in another form → same identity; the template is untouched.
    const again = (
      await validate(designer, { ...VARIABLE_DATA_RECORD, price: '39.95', currency: '' })
    ).body as TemplateDataValidationDto;
    expect(again.resolvedInputHash).toBe(body.resolvedInputHash);
    const after = await t.prisma.templateVersion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after).toEqual(before);
  });

  it.each([
    [
      'missing required value',
      { ...VARIABLE_DATA_RECORD, size: null },
      ['DATA', 'REQUIRED_VALUE_NULL'],
    ],
    ['wrong type', { ...VARIABLE_DATA_RECORD, price: true }, ['DATA', 'INVALID_TYPE']],
    ['rule violation', { ...VARIABLE_DATA_RECORD, price: '0.00' }, ['DATA', 'VALUE_BELOW_MINIMUM']],
    [
      'invalid barcode after resolution',
      { ...VARIABLE_DATA_RECORD, gtin: '9501234567893' },
      ['OBJECT', 'BARCODE_VALUE_INVALID'],
    ],
  ])('reports %s as a structured issue', async (_label, record, [layer, code]) => {
    const body = (await validate(designer, record)).body as TemplateDataValidationDto;
    expect(body.productionValid).toBe(false);
    expect(body.issues[0]).toMatchObject({ layer, code, severity: 'ERROR' });
    expect(typeof body.issues[0]!.message).toBe('string');
  });

  it('reports expression evaluation errors with object and property context', async () => {
    const document = variableDataDocument(template.id);
    const size = document.pages[0]!.objects.find((o) => o.id === 'vd-size')!;
    size.bindings = {
      ...size.bindings,
      content: expressionBinding('formatNumber(price, 2, "12")'),
    };
    const saved = await designer
      .patch(`${API}/template-versions/${draft.id}`)
      .send({ document, expectedRevision: draft.revision });
    expect(saved.status).toBe(200);
    const body = (await validate(designer, VARIABLE_DATA_RECORD)).body as TemplateDataValidationDto;
    expect(body.issues.filter((issue) => issue.severity === 'ERROR')).toEqual([
      expect.objectContaining({
        layer: 'BINDING',
        code: 'EXPRESSION_EVALUATION_ERROR',
        target: expect.objectContaining({ objectId: 'vd-size', property: 'content' }) as unknown,
      }),
    ]);
  });

  it('refuses prototype-polluting keys and warns about unknown keys', async () => {
    const response = await designer
      .post(`${API}/template-versions/${draft.id}/data/validate`)
      .set('Content-Type', 'application/json')
      .send(
        `{"record":{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"colour":"Navy","product_name":"Shirt"}}`,
      );
    expect(response.status).toBe(200);
    const body = response.body as TemplateDataValidationDto;
    expect(body.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['FORBIDDEN_FIELD_KEY', 'UNKNOWN_FIELD']),
    );
    expect(Object.keys(body.normalizedRecord)).not.toContain('__proto__');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('accepts own image assets and rejects assets of another organization server-side', async () => {
    const own = (
      await designer
        .post(`${API}/assets`)
        .field('assetType', 'IMAGE')
        .attach('file', TINY_PNG, 'a.png')
    ).body.id as string;
    const foreign = (
      await adminB
        .post(`${API}/assets`)
        .field('assetType', 'IMAGE')
        .attach('file', TINY_PNG, 'b.png')
    ).body.id as string;

    const ok = (await validate(designer, { ...VARIABLE_DATA_RECORD, product_image: own }))
      .body as TemplateDataValidationDto;
    expect(ok).toMatchObject({ valid: true, productionValid: true, issues: [] });

    const crossTenant = (
      await validate(designer, { ...VARIABLE_DATA_RECORD, product_image: foreign })
    ).body as TemplateDataValidationDto;
    expect(crossTenant.valid).toBe(false);
    expect(crossTenant.resolvedInputHash).toBeNull();
    expect(crossTenant.issues.map((issue) => [issue.layer, issue.code])).toEqual([
      ['DATA', 'UNKNOWN_ASSET_REFERENCE'],
      ['OBJECT', 'IMAGE_ASSET_UNAVAILABLE'],
      ['OBJECT', 'IMAGE_ASSET_UNAVAILABLE'],
    ]);
    expect(crossTenant.fields.find((field) => field.key === 'product_image')).toMatchObject({
      state: 'ERROR',
    });

    // A font is an asset of the organization, but not an image.
    const font = (
      await validate(designer, {
        ...VARIABLE_DATA_RECORD,
        product_image: '0192f0a0-5b1e-7c3d-9b01-00000000f400',
      })
    ).body as TemplateDataValidationDto;
    expect(font.issues[0]?.code).toBe('UNKNOWN_ASSET_REFERENCE');
  });

  it('enforces the record size limit', async () => {
    const response = await validate(designer, { product_name: 'x'.repeat(300 * 1024) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('allows read-only roles to validate, isolates tenants and requires authentication', async () => {
    expect((await validate(viewer, VARIABLE_DATA_RECORD)).status).toBe(200);
    expect((await validate(approver, VARIABLE_DATA_RECORD)).status).toBe(200);
    const other = await validate(adminB, VARIABLE_DATA_RECORD);
    expect(other.status).toBe(404);
    const anonymous = await t.http
      .post(`${API}/template-versions/${draft.id}/data/validate`)
      .send({ record: {} });
    expect(anonymous.status).toBe(401);
    expect(
      (await designer.post(`${API}/template-versions/${draft.id}/data/validate`).send({})).status,
    ).toBe(400);
  });

  it('rejects documents with invalid expressions or bindings to missing fields', async () => {
    const document = variableDataDocument(template.id);
    const sku = document.pages[0]!.objects.find((o) => o.id === 'vd-sku')!;
    sku.bindings = {
      ...sku.bindings,
      content: expressionBinding('upper(concat(style, colour))'),
    };
    const response = await designer
      .patch(`${API}/template-versions/${draft.id}`)
      .send({ document, expectedRevision: draft.revision });
    expect(response.status).toBe(422);
    expect(response.body.error.details.documentIssues).toEqual([
      expect.objectContaining({
        code: 'UNKNOWN_FIELD',
        path: ['pages', 0, 'objects', 4, 'bindings', 'content', 'expression'],
      }),
    ]);

    const unsafe = variableDataDocument(template.id);
    unsafe.dataSchema.fields.push({
      ...unsafe.dataSchema.fields[0]!,
      key: 'constructor',
    });
    const refused = await designer
      .patch(`${API}/template-versions/${draft.id}`)
      .send({ document: unsafe, expectedRevision: draft.revision });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.documentIssues[0].code).toBe('INVALID_FIELD_KEY');
  });

  it('refuses data schema changes from viewers and approvers, on stale revisions and on approved versions', async () => {
    const changed = variableDataDocument(template.id);
    changed.dataSchema.fields.push({
      ...changed.dataSchema.fields[2]!,
      key: 'care_note',
      displayName: 'Care note',
      required: false,
    });
    const patch = (agent: TestAgent, expectedRevision: number) =>
      agent
        .patch(`${API}/template-versions/${draft.id}`)
        .send({ document: changed, expectedRevision });

    expect((await patch(viewer, draft.revision)).status).toBe(403);
    expect((await patch(approver, draft.revision)).status).toBe(403);
    const stale = await patch(designer, draft.revision - 1);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    await designer
      .post(`${API}/template-versions/${draft.id}/transitions`)
      .send({ targetStatus: 'IN_REVIEW' });
    await approver
      .post(`${API}/template-versions/${draft.id}/transitions`)
      .send({ targetStatus: 'APPROVED' });
    const immutable = await patch(designer, draft.revision);
    expect(immutable.status).toBe(409);
    expect(immutable.body.error.code).toBe('VERSION_IMMUTABLE');
    const stored = await t.prisma.templateVersion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(stored.documentHash).toBe(draft.documentHash);

    // Approved versions can still be inspected and validated against.
    expect((await validate(viewer, VARIABLE_DATA_RECORD)).body).toMatchObject({
      productionValid: true,
    });
  });
});
