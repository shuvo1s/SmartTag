import { parseDesignDocument, type DesignDocument } from '@smarttag/document-schema';
import { hashCanonicalJson, mmToPt } from '@smarttag/document-utils';
import type { TemplateDto, TemplateVersionDetailDto } from '@smarttag/shared-types';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  createTestApp,
  hangTagRequest,
  loginAs,
  resetDatabase,
  seedTenants,
  type TestApp,
} from './helpers';

describe('templates & customers API', () => {
  let t: TestApp;
  let tenants: Awaited<ReturnType<typeof seedTenants>>;
  let designer: TestAgent;
  let admin: TestAgent;
  let viewer: TestAgent;

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
    admin = await loginAs(t, 'admin.a@test.local');
    viewer = await loginAs(t, 'viewer.a@test.local');
  });

  async function createCustomerWithBrand(agent: TestAgent, code = 'APPAREL', brandCode = 'ACTIVE') {
    const customer = await agent.post(`${API}/customers`).send({ code, name: `${code} Co.` });
    expect(customer.status).toBe(201);
    const brand = await agent
      .post(`${API}/customers/${customer.body.id}/brands`)
      .send({ code: brandCode, name: brandCode });
    expect(brand.status).toBe(201);
    return { customerId: customer.body.id as string, brandId: brand.body.id as string };
  }

  describe('POST /templates', () => {
    it('creates a template with an initial DRAFT version holding a valid canonical document', async () => {
      const { customerId, brandId } = await createCustomerWithBrand(admin);
      const response = await designer
        .post(`${API}/templates`)
        .send(hangTagRequest({ code: 'ht-demo-50x90', customerId, brandId, description: 'Demo' }));

      expect(response.status).toBe(201);
      const template = response.body as TemplateDto;
      expect(template).toMatchObject({
        code: 'HT-DEMO-50X90',
        status: 'ACTIVE',
        documentType: 'HANG_TAG',
        latestVersionNumber: 1,
        customer: { id: customerId, code: 'APPAREL' },
        brand: { id: brandId, code: 'ACTIVE' },
        currentVersion: { versionNumber: 1, status: 'DRAFT' },
      });
      expect(template.currentVersion!.summary).toMatchObject({
        pageCount: 2,
        pageSides: ['FRONT', 'BACK'],
        displayUnit: 'mm',
      });
      expect(template.currentVersion!.summary.widthPt).toBeCloseTo(mmToPt(50), 10);
      expect(template.currentVersion!.summary.bleedPt.top).toBeCloseTo(mmToPt(3), 10);

      const version = (
        await designer.get(`${API}/template-versions/${template.currentVersion!.id}`)
      ).body as TemplateVersionDetailDto;
      const parsed = parseDesignDocument(version.document);
      expect(parsed.valid).toBe(true);
      const document = parsed.document as DesignDocument;
      expect(document.documentId).toBe(template.id);
      expect(document.dimensions.height).toBeCloseTo(mmToPt(90), 10);
      // The hash stored in the database matches the document as read back from PostgreSQL (jsonb round trip).
      expect(await hashCanonicalJson(version.document)).toBe(version.documentHash);

      const actions = await t.prisma.auditEvent.findMany({
        where: { organizationId: tenants.orgA.id },
        orderBy: { occurredAt: 'asc' },
      });
      expect(actions.map((event) => event.action)).toEqual(
        expect.arrayContaining(['TEMPLATE_CREATED', 'TEMPLATE_VERSION_CREATED']),
      );
    });

    it('returns field errors for invalid input', async () => {
      const response = await designer.post(`${API}/templates`).send(
        hangTagRequest({
          name: '',
          code: 'x',
          dimensions: { unit: 'mm', width: 0, height: 90, bleed: -2, safeMargin: 3 },
        }),
      );
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.fieldErrors.map((e: { path: string }) => e.path)).toEqual(
        expect.arrayContaining(['name', 'code', 'dimensions.width', 'dimensions.bleed']),
      );
    });

    it('rejects document types that are not available yet', async () => {
      const response = await designer
        .post(`${API}/templates`)
        .send(hangTagRequest({ documentType: 'RFID_LABEL' }));
      expect(response.status).toBe(400);
      expect(response.body.error.details.fieldErrors[0]).toMatchObject({ path: 'documentType' });
    });

    it('rejects duplicate codes within the organization', async () => {
      expect((await designer.post(`${API}/templates`).send(hangTagRequest())).status).toBe(201);
      const duplicate = await designer
        .post(`${API}/templates`)
        .send(hangTagRequest({ code: 'ht-basic' }));
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('CONFLICT');
    });

    it('rejects a brand that does not belong to the selected customer', async () => {
      const first = await createCustomerWithBrand(admin, 'FIRST', 'B1');
      const second = await createCustomerWithBrand(admin, 'SECOND', 'B2');
      const response = await designer
        .post(`${API}/templates`)
        .send(hangTagRequest({ customerId: first.customerId, brandId: second.brandId }));
      expect(response.status).toBe(400);
      expect(response.body.error.details.fieldErrors).toEqual([
        { path: 'brandId', message: 'Brand not found for the selected customer' },
      ]);
    });

    it('is forbidden for roles without template:create', async () => {
      const response = await viewer.post(`${API}/templates`).send(hangTagRequest());
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(await t.prisma.template.count()).toBe(0);
    });
  });

  describe('GET /templates', () => {
    it('lists with pagination, search and filters', async () => {
      for (const code of ['HT-ALPHA', 'HT-BETA', 'HT-GAMMA']) {
        expect(
          (
            await designer
              .post(`${API}/templates`)
              .send(hangTagRequest({ code, name: `Tag ${code}` }))
          ).status,
        ).toBe(201);
      }
      const page = await viewer.get(`${API}/templates`).query({ page: 1, pageSize: 2 });
      expect(page.status).toBe(200);
      expect(page.body).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
      expect(page.body.items).toHaveLength(2);

      const search = await viewer.get(`${API}/templates`).query({ search: 'beta' });
      expect(search.body.items.map((item: TemplateDto) => item.code)).toEqual(['HT-BETA']);

      const archived = await viewer.get(`${API}/templates`).query({ status: 'ARCHIVED' });
      expect(archived.body.total).toBe(0);

      const invalid = await viewer.get(`${API}/templates`).query({ pageSize: 1000 });
      expect(invalid.status).toBe(400);
    });

    it('returns 404 for unknown or malformed template ids', async () => {
      expect(
        (await viewer.get(`${API}/templates/0192f0a0-5b1e-7c3d-8e4f-000000000000`)).status,
      ).toBe(404);
      expect((await viewer.get(`${API}/templates/not-a-uuid`)).status).toBe(404);
    });
  });

  describe('PATCH /templates/:id', () => {
    it('updates metadata and audits the change', async () => {
      const created = (await designer.post(`${API}/templates`).send(hangTagRequest()))
        .body as TemplateDto;
      const response = await designer
        .patch(`${API}/templates/${created.id}`)
        .send({ name: 'Renamed tag', description: 'Updated' });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        name: 'Renamed tag',
        description: 'Updated',
        code: 'HT-BASIC',
      });
      const audit = await t.prisma.auditEvent.findFirstOrThrow({
        where: { action: 'TEMPLATE_UPDATED' },
      });
      expect(audit.metadata).toEqual({ changedFields: ['name', 'description'] });
    });

    it('requires template:archive to change status and records the status change', async () => {
      const created = (await designer.post(`${API}/templates`).send(hangTagRequest()))
        .body as TemplateDto;
      expect(
        (await designer.patch(`${API}/templates/${created.id}`).send({ status: 'ARCHIVED' }))
          .status,
      ).toBe(403);

      const archived = await admin
        .patch(`${API}/templates/${created.id}`)
        .send({ status: 'ARCHIVED' });
      expect(archived.status).toBe(200);
      expect(archived.body.status).toBe('ARCHIVED');
      expect(
        await t.prisma.auditEvent.count({ where: { action: 'TEMPLATE_STATUS_CHANGED' } }),
      ).toBe(1);
    });

    it('rejects immutable or unknown fields', async () => {
      const created = (await designer.post(`${API}/templates`).send(hangTagRequest()))
        .body as TemplateDto;
      const response = await designer
        .patch(`${API}/templates/${created.id}`)
        .send({ code: 'NEW-CODE' });
      expect(response.status).toBe(400);
    });
  });

  describe('customers & brands', () => {
    it('creates and lists customers with brands; codes are unique', async () => {
      await createCustomerWithBrand(admin, 'APPAREL', 'ACTIVE');
      const list = await viewer.get(`${API}/customers`);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({ code: 'APPAREL', brands: [{ code: 'ACTIVE' }] });

      const duplicate = await admin
        .post(`${API}/customers`)
        .send({ code: 'apparel', name: 'Again' });
      expect(duplicate.status).toBe(409);
      expect(
        await t.prisma.auditEvent.count({
          where: { action: { in: ['CUSTOMER_CREATED', 'BRAND_CREATED'] } },
        }),
      ).toBe(2);
    });

    it('requires customer:manage to create customers', async () => {
      expect(
        (await designer.post(`${API}/customers`).send({ code: 'NOPE', name: 'Nope' })).status,
      ).toBe(403);
      expect(
        (await viewer.post(`${API}/customers`).send({ code: 'NOPE', name: 'Nope' })).status,
      ).toBe(403);
    });
  });
});
