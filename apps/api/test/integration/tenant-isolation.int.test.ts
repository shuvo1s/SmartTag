import {
  SAMPLE_BRAND_LOGO_ASSET_ID,
  createSampleHangTagDocument,
} from '@smarttag/document-utils/fixtures';
import type { TemplateDto } from '@smarttag/shared-types';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ActorContext } from '../../src/common/http/request-context';
import { TemplatesService } from '../../src/modules/templates/templates.service';
import { permissionsForRoles } from '@smarttag/shared-types';
import {
  API,
  createTestApp,
  hangTagRequest,
  loginAs,
  resetDatabase,
  seedTenants,
  type TestApp,
} from './helpers';
import { TINY_PNG } from '../fixtures/images';

/**
 * Organization B must not be able to read, change or reference anything owned by organization A —
 * regardless of permissions inside its own tenant, and regardless of knowing A's ids.
 */
describe('tenant isolation', () => {
  let t: TestApp;
  let tenants: Awaited<ReturnType<typeof seedTenants>>;
  let adminA: TestAgent;
  let adminB: TestAgent;
  let templateA: TemplateDto;
  let customerA: { id: string; brandId: string };
  let assetA: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    tenants = await seedTenants(t.prisma);
    adminA = await loginAs(t, 'admin.a@test.local');
    adminB = await loginAs(t, 'admin.b@test.local');

    const customer = await adminA
      .post(`${API}/customers`)
      .send({ code: 'A-CUST', name: 'A customer' });
    const brand = await adminA
      .post(`${API}/customers/${customer.body.id}/brands`)
      .send({ code: 'A-BRAND', name: 'A brand' });
    customerA = { id: customer.body.id, brandId: brand.body.id };
    templateA = (
      await adminA
        .post(`${API}/templates`)
        .send(hangTagRequest({ code: 'A-SECRET', customerId: customerA.id }))
    ).body;
    assetA = (
      await adminA
        .post(`${API}/assets`)
        .field('assetType', 'IMAGE')
        .attach('file', TINY_PNG, 'a.png')
    ).body.id;
  });

  it("lists only the active organization's templates and customers", async () => {
    await adminB.post(`${API}/templates`).send(hangTagRequest({ code: 'B-OWN' }));
    const templates = await adminB.get(`${API}/templates`);
    expect(templates.body.items.map((item: TemplateDto) => item.code)).toEqual(['B-OWN']);
    expect((await adminB.get(`${API}/templates`).query({ search: 'A-SECRET' })).body.total).toBe(0);
    expect((await adminB.get(`${API}/customers`)).body).toEqual([]);
    expect((await adminB.get(`${API}/assets`)).body.total).toBe(0);
  });

  it.each([
    ['GET template', (agent: TestAgent) => agent.get(`${API}/templates/${templateA.id}`)],
    [
      'PATCH template',
      (agent: TestAgent) => agent.patch(`${API}/templates/${templateA.id}`).send({ name: 'pwned' }),
    ],
    ['GET versions', (agent: TestAgent) => agent.get(`${API}/templates/${templateA.id}/versions`)],
    [
      'POST version',
      (agent: TestAgent) => agent.post(`${API}/templates/${templateA.id}/versions`).send({}),
    ],
    [
      'GET version',
      (agent: TestAgent) => agent.get(`${API}/template-versions/${templateA.currentVersion!.id}`),
    ],
    [
      'PATCH version',
      (agent: TestAgent) =>
        agent
          .patch(`${API}/template-versions/${templateA.currentVersion!.id}`)
          .send({ document: {}, expectedRevision: 1 }),
    ],
    [
      'transition version',
      (agent: TestAgent) =>
        agent
          .post(`${API}/template-versions/${templateA.currentVersion!.id}/transitions`)
          .send({ targetStatus: 'IN_REVIEW' }),
    ],
    ['GET customer', (agent: TestAgent) => agent.get(`${API}/customers/${customerA.id}`)],
    [
      'POST brand on customer',
      (agent: TestAgent) =>
        agent.post(`${API}/customers/${customerA.id}/brands`).send({ code: 'X', name: 'X' }),
    ],
    ['GET asset', (agent: TestAgent) => agent.get(`${API}/assets/${assetA}`)],
    ['GET asset content', (agent: TestAgent) => agent.get(`${API}/assets/${assetA}/content`)],
  ])('refuses cross-tenant %s with 404 (existence is not revealed)', async (_label, call) => {
    const response = await call(adminB);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it("leaves the other tenant's data untouched", async () => {
    await adminB.patch(`${API}/templates/${templateA.id}`).send({ name: 'pwned' });
    await adminB
      .post(`${API}/template-versions/${templateA.currentVersion!.id}/transitions`)
      .send({ targetStatus: 'IN_REVIEW' });
    const stored = await t.prisma.template.findUniqueOrThrow({
      where: { id: templateA.id },
      include: { currentVersion: true },
    });
    expect(stored.name).toBe('Basic hang tag');
    expect(stored.currentVersion?.status).toBe('DRAFT');
    expect(await t.prisma.templateVersion.count({ where: { templateId: templateA.id } })).toBe(1);
  });

  it("refuses to link another tenant's customer or brand", async () => {
    const response = await adminB
      .post(`${API}/templates`)
      .send(
        hangTagRequest({ code: 'B-STEAL', customerId: customerA.id, brandId: customerA.brandId }),
      );
    expect(response.status).toBe(400);
    expect(response.body.error.details.fieldErrors).toEqual([
      { path: 'customerId', message: 'Customer not found' },
    ]);
  });

  it("refuses documents that reference another tenant's assets", async () => {
    const templateB = (
      await adminB.post(`${API}/templates`).send(hangTagRequest({ code: 'B-TAG' }))
    ).body as TemplateDto;
    const document = createSampleHangTagDocument({ documentId: templateB.id, logoAssetId: assetA });
    const response = await adminB
      .post(`${API}/templates/${templateB.id}/versions`)
      .send({ document });
    expect(response.status).toBe(422);
    expect(response.body.error.details.documentIssues[0].code).toBe('UNKNOWN_ASSET_REFERENCE');
    expect(SAMPLE_BRAND_LOGO_ASSET_ID).not.toBe(assetA);
  });

  it('a user in both tenants sees only the active organization', async () => {
    const multi = await loginAs(t, 'multi@test.local');
    const active = (await multi.get(`${API}/auth/session`)).body.activeOrganization.id as string;
    const expectedCodes = active === tenants.orgA.id ? ['A-SECRET'] : [];
    expect(
      (await multi.get(`${API}/templates`)).body.items.map((i: TemplateDto) => i.code),
    ).toEqual(expectedCodes);

    await multi.put(`${API}/auth/session/organization`).send({ organizationId: tenants.orgB.id });
    expect((await multi.get(`${API}/templates/${templateA.id}`)).status).toBe(404);
    await multi.put(`${API}/auth/session/organization`).send({ organizationId: tenants.orgA.id });
    expect((await multi.get(`${API}/templates/${templateA.id}`)).status).toBe(200);
  });

  it('service layer scopes by the actor organization, independent of HTTP', async () => {
    const service = t.app.get(TemplatesService);
    const actorB: ActorContext = {
      userId: tenants.users.adminB.id,
      sessionId: 'n/a',
      organizationId: tenants.orgB.id,
      roles: ['ORG_ADMIN'],
      permissions: new Set(permissionsForRoles(['ORG_ADMIN'])),
      requestId: null,
      ipAddress: null,
      userAgent: null,
    };
    await expect(service.get(actorB, templateA.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.update(actorB, templateA.id, { name: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await service.list(actorB, { page: 1, pageSize: 25 })).total).toBe(0);
  });

  it('the database rejects cross-tenant references even if application code were bypassed', async () => {
    const templateB = await adminB.post(`${API}/templates`).send(hangTagRequest({ code: 'B-RAW' }));
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE templates SET customer_id = $1::uuid WHERE id = $2::uuid`,
        customerA.id,
        templateB.body.id,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE templates SET organization_id = $1::uuid WHERE id = $2::uuid`,
        tenants.orgB.id,
        templateA.id,
      ),
    ).rejects.toThrow(/cannot be changed|violates/i);
  });
});
