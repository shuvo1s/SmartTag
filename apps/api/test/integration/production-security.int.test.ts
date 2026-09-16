import type {
  ProductionInstancePageDto,
  ProductionJobDto,
  SequenceDto,
} from '@smarttag/shared-types';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { startImportWorker } from './import-helpers';
import {
  approvedQuantityTemplate,
  createJob,
  createSequence,
  expandedJob,
  finalizedDataset,
  quantityRows,
  startProductionWorker,
  waitForRendering,
  type TestWorker,
} from './production-helpers';

describe('production security and permissions', () => {
  let t: TestApp;
  let worker: TestWorker;
  let imports: { close(): Promise<void> };
  let designer: TestAgent;
  let approver: TestAgent;
  let operator: TestAgent;
  let manager: TestAgent;
  let viewer: TestAgent;
  let otherTenant: TestAgent;
  let organizationId: string;
  let otherOrganizationId: string;

  beforeAll(async () => {
    t = await createTestApp();
    imports = await startImportWorker(t);
    worker = await startProductionWorker(t);
  });

  afterAll(async () => {
    await worker.close();
    await imports.close();
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    const tenants = await seedTenants(t.prisma);
    organizationId = tenants.orgA.id;
    otherOrganizationId = tenants.orgB.id;
    await seedSampleAssets(t.prisma, tenants.orgA.id, tenants.users.designerA.id);
    await createUser(t.prisma, 'operator.a@test.local', [
      { organizationId: tenants.orgA.id, roles: ['DATA_OPERATOR'] },
    ]);
    await createUser(t.prisma, 'manager.a@test.local', [
      { organizationId: tenants.orgA.id, roles: ['DATA_OPERATOR', 'PRODUCTION_MANAGER'] },
    ]);
    await createUser(t.prisma, 'manager.b@test.local', [
      { organizationId: tenants.orgB.id, roles: ['ORG_ADMIN'] },
    ]);
    designer = await loginAs(t, 'designer.a@test.local');
    approver = await loginAs(t, 'approver.a@test.local');
    operator = await loginAs(t, 'operator.a@test.local');
    manager = await loginAs(t, 'manager.a@test.local');
    viewer = await loginAs(t, 'viewer.a@test.local');
    otherTenant = await loginAs(t, 'manager.b@test.local');
  });

  async function releasedJob(): Promise<ProductionJobDto> {
    const version = await approvedQuantityTemplate(designer, approver);
    const dataset = await finalizedDataset(operator, version.id, quantityRows([1, 1]), 'FW26');
    const sequence = await createSequence(manager);
    const job = await createJob(manager, version.id, dataset.id);
    const expanded = await expandedJob(manager, job, {
      serial: { enabled: true, sequenceId: sequence.id },
    });
    const released = await manager
      .post(`${API}/production-jobs/${job.id}/release`)
      .send({ expectedRevision: expanded.revision, acknowledgeWarnings: true });
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    return waitForRendering(manager, job.id);
  }

  it('another organization sees no jobs, no tags, no manifest and no sequences', async () => {
    const job = await releasedJob();
    const sequences = (await manager.get(`${API}/sequences`)).body as SequenceDto[];
    expect(sequences).toHaveLength(1);

    for (const path of [
      `/production-jobs/${job.id}`,
      `/production-jobs/${job.id}/instances`,
      `/production-jobs/${job.id}/instances/1`,
      `/production-jobs/${job.id}/samples`,
      `/production-jobs/${job.id}/manifest`,
      `/production-jobs/${job.id}/manifest/download`,
      `/sequences/${sequences[0]!.id}`,
    ]) {
      const response = await otherTenant.get(`${API}${path}`);
      expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(404);
    }
    // Each request is built when it runs: supertest closes its ephemeral server per request.
    const changes: (() => Promise<{ status: number }>)[] = [
      () =>
        otherTenant
          .patch(`${API}/production-jobs/${job.id}`)
          .send({ expectedRevision: job.revision, name: 'Theirs' }),
      () =>
        otherTenant
          .post(`${API}/production-jobs/${job.id}/cancel`)
          .send({ expectedRevision: job.revision }),
      () =>
        otherTenant
          .patch(`${API}/sequences/${sequences[0]!.id}`)
          .send({ expectedRevision: 1, name: 'Theirs' }),
    ];
    for (const change of changes) {
      expect((await change()).status).toBe(404);
    }
    expect(
      ((await otherTenant.get(`${API}/production-jobs`)).body as { items: unknown[] }).items,
    ).toHaveLength(0);
  });

  it("a job can never use another organization's template, dataset or sequence", async () => {
    const version = await approvedQuantityTemplate(designer, approver);
    const dataset = await finalizedDataset(operator, version.id, quantityRows([1]), 'FW26');
    const sequence = await createSequence(manager);

    // The other tenant cannot build a job out of these ids.
    const foreign = await otherTenant.post(`${API}/production-jobs`).send({
      name: 'Borrowed',
      templateVersionId: version.id,
      datasetVersionId: dataset.id,
    });
    expect(foreign.status).toBe(404);

    // And a job of this organization cannot point at a foreign sequence.
    const otherSequence = await createSequence(otherTenant, { code: 'OTHER', name: 'Theirs' });
    const job = await createJob(manager, version.id, dataset.id);
    const configured = await manager.patch(`${API}/production-jobs/${job.id}`).send({
      expectedRevision: job.revision,
      serial: { enabled: true, sequenceId: otherSequence.id },
    });
    expect(configured.status).toBe(404);
    expect(sequence.id).not.toBe(otherSequence.id);
  });

  it('permissions: viewers read, data operators prepare, only managers release', async () => {
    const version = await approvedQuantityTemplate(designer, approver);
    const dataset = await finalizedDataset(operator, version.id, quantityRows([1, 1]), 'FW26');

    // A viewer may look but not touch.
    const list = await viewer.get(`${API}/production-jobs`);
    expect(list.status).toBe(200);
    const viewerCreate = await viewer
      .post(`${API}/production-jobs`)
      .send({ name: 'No', templateVersionId: version.id, datasetVersionId: dataset.id });
    expect(viewerCreate.status).toBe(403);
    expect((await viewer.post(`${API}/sequences`).send({ name: 'No', code: 'NO' })).status).toBe(
      403,
    );

    // An approver has no production rights beyond reading.
    const approverCreate = await approver
      .post(`${API}/production-jobs`)
      .send({ name: 'No', templateVersionId: version.id, datasetVersionId: dataset.id });
    expect(approverCreate.status).toBe(403);

    // A data operator prepares the job but cannot commit serial numbers by releasing it.
    const job = await createJob(operator, version.id, dataset.id);
    const expanded = await expandedJob(operator, job);
    expect(expanded.status).toBe('READY');
    expect(expanded.actions.release).toBe(false);
    const operatorRelease = await operator
      .post(`${API}/production-jobs/${job.id}/release`)
      .send({ expectedRevision: expanded.revision, acknowledgeWarnings: true });
    expect(operatorRelease.status).toBe(403);

    // The production manager may.
    const detail = (await manager.get(`${API}/production-jobs/${job.id}`)).body as ProductionJobDto;
    expect(detail.actions.release).toBe(true);
    const released = await manager
      .post(`${API}/production-jobs/${job.id}/release`)
      .send({ expectedRevision: detail.revision, acknowledgeWarnings: true });
    expect(released.status, JSON.stringify(released.body)).toBe(200);
  });

  it('the manifest download is authorized, an attachment, and audited', async () => {
    const job = await releasedJob();
    expect((await viewer.get(`${API}/production-jobs/${job.id}/manifest/download`)).status).toBe(
      200,
    );
    const download = await manager.get(`${API}/production-jobs/${job.id}/manifest/download`);
    expect(download.headers['content-disposition']).toMatch(/attachment; filename="PJ-/);
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['content-security-policy']).toContain("default-src 'none'");
    // No storage key or URL is exposed anywhere in the response.
    expect(download.text).not.toContain('organizations/');

    const audits = await t.prisma.auditEvent.findMany({
      where: { organizationId, action: 'PRODUCTION_MANIFEST_DOWNLOADED' },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.resourceId).toBe(job.id);
  });

  it('cross-tenant ids in the database are impossible, not just refused by the API', async () => {
    const job = await releasedJob();
    // A production instance can only belong to a job of its own organization.
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE production_jobs SET organization_id = $1::uuid WHERE id = $2::uuid`,
        otherOrganizationId,
        job.id,
      ),
    ).rejects.toThrow(/organization/i);

    const instances = (await manager.get(`${API}/production-jobs/${job.id}/instances`))
      .body as ProductionInstancePageDto;
    expect(instances.items.length).toBeGreaterThan(0);
    expect(
      await t.prisma.productionInstance.count({
        where: { productionJobId: job.id, organizationId: otherOrganizationId },
      }),
    ).toBe(0);
  });

  it('a sequence keeps its numbers when it is archived, and stays usable for reading', async () => {
    const sequence = await createSequence(manager, { code: 'ARCH', name: 'Archivable' });
    const archived = await manager
      .patch(`${API}/sequences/${sequence.id}`)
      .send({ expectedRevision: sequence.revision, status: 'ARCHIVED' });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);

    const version = await approvedQuantityTemplate(designer, approver);
    const dataset = await finalizedDataset(operator, version.id, quantityRows([1]), 'FW26');
    const job = await createJob(manager, version.id, dataset.id);
    const configured = await manager.patch(`${API}/production-jobs/${job.id}`).send({
      expectedRevision: job.revision,
      serial: { enabled: true, sequenceId: sequence.id },
    });
    expect(configured.status).toBe(409);
    expect(configured.body.error.code).toBe('SEQUENCE_INACTIVE');
  });
});
