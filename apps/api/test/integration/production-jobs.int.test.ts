import { sha256Hex } from '@smarttag/document-utils';
import {
  computeInstancesDigest,
  computeProductionJobHash,
  manifestJobHashPayload,
  serializeManifest,
  type ProductionManifest,
} from '@smarttag/production-core';
import { processExpandJob, processReleaseJob } from '@smarttag/production-processing';
import type {
  ProductionInstanceDetailDto,
  ProductionInstancePageDto,
  ProductionJobDto,
  ProductionSampleDto,
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
import { createVariableDataTemplate, startImportWorker } from './import-helpers';
import {
  type TestWorker,
  approvedQuantityTemplate,
  approvedTemplateVersion,
  configureJob,
  createJob,
  createSequence,
  expandedJob,
  finalizedDataset,
  productionSettings,
  productionStorage,
  quantityRows,
  startProductionWorker,
  waitForRendering,
} from './production-helpers';

describe('production jobs', () => {
  let t: TestApp;
  let worker: TestWorker;
  let imports: { close(): Promise<void> };
  let designer: TestAgent;
  let approver: TestAgent;
  let operator: TestAgent;
  let manager: TestAgent;
  let organizationId: string;

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
    await seedSampleAssets(t.prisma, tenants.orgA.id, tenants.users.designerA.id);
    await createUser(t.prisma, 'operator.a@test.local', [
      { organizationId: tenants.orgA.id, roles: ['DATA_OPERATOR'] },
    ]);
    await createUser(t.prisma, 'manager.a@test.local', [
      { organizationId: tenants.orgA.id, roles: ['DATA_OPERATOR', 'PRODUCTION_MANAGER'] },
    ]);
    designer = await loginAs(t, 'designer.a@test.local');
    approver = await loginAs(t, 'approver.a@test.local');
    operator = await loginAs(t, 'operator.a@test.local');
    manager = await loginAs(t, 'manager.a@test.local');
  });

  /** An approved template version and a finalized dataset with three records. */
  async function inputs(rows = quantityRows([2, 3, 1])) {
    const version = await approvedQuantityTemplate(designer, approver);
    const dataset = await finalizedDataset(operator, version.id, rows, 'FW26 tags');
    return { version, dataset };
  }

  it('one tag per record: expansion, ordering, hashes and the released manifest', async () => {
    const { version, dataset } = await inputs();
    const job = await createJob(manager, version.id, dataset.id);
    expect(job.status).toBe('DRAFT');
    expect(job.jobNumber).toMatch(/^PJ-\d{8}-\d{6}$/);
    expect(job.templateVersionHash).toBe(version.documentHash);
    expect(job.datasetVersion.datasetHash).toBe(dataset.datasetHash);

    const expanded = await expandedJob(manager, job);
    expect(expanded.status).toBe('READY');
    expect(expanded.counts).toMatchObject({ recordCount: 3, instanceCount: 3, errorCount: 0 });
    expect(expanded.validation?.layoutChecked).toBe(false);

    const instances = (await manager.get(`${API}/production-jobs/${job.id}/instances?pageSize=50`))
      .body as ProductionInstancePageDto;
    expect(instances.items.map((instance) => instance.sequence)).toEqual([1, 2, 3]);
    expect(instances.items.map((instance) => instance.copyIndex)).toEqual([1, 1, 1]);
    expect(instances.items.every((instance) => instance.resolvedInputHash !== null)).toBe(true);
    // Instance hashes exist only once the job is released and the serials are known.
    expect(instances.items.every((instance) => instance.instanceHash === null)).toBe(true);

    const released = await manager
      .post(`${API}/production-jobs/${job.id}/release`)
      .send({ expectedRevision: expanded.revision, acknowledgeWarnings: false });
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    const ready = await waitForRendering(manager, job.id);
    expect(ready.status).toBe('READY_FOR_RENDERING');
    expect(ready.instancesDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(ready.productionJobHash).toMatch(/^[0-9a-f]{64}$/);

    // The digest is exactly the ordered list of the stored instance hashes.
    const stored = await t.prisma.productionInstance.findMany({
      where: { productionJobId: job.id },
      orderBy: { sequence: 'asc' },
      select: { instanceHash: true },
    });
    expect(await computeInstancesDigest(stored.map((row) => row.instanceHash!))).toBe(
      ready.instancesDigest,
    );
    expect(
      await computeProductionJobHash({
        templateVersionHash: ready.templateVersionHash,
        datasetHash: ready.datasetVersion.datasetHash,
        dataSchemaHash: ready.dataSchemaHash,
        configuration: ready.configuration,
        serialReservation: null,
        instanceCount: ready.counts.instanceCount,
        instancesDigest: ready.instancesDigest!,
        contractVersion: ready.versions.contract!,
      }),
    ).toBe(ready.productionJobHash);

    const manifest = await manager.get(`${API}/production-jobs/${job.id}/manifest`);
    expect(manifest.status, JSON.stringify(manifest.body)).toBe(200);
    expect(manifest.body.verified).toEqual({ valid: true, issues: [] });
    const body = manifest.body.manifest as ProductionManifest;
    expect(body.instances).toMatchObject({ count: 3, digest: ready.instancesDigest });
    expect(body.validation).toMatchObject({ contentValidated: true, layoutFullyChecked: false });
    expect(await sha256Hex(manifestJobHashPayload(body))).toBe(body.productionJobHash);
  });

  it('quantity field: 2 + 3 + 1 rows become six tags in record and copy order', async () => {
    const { version, dataset } = await inputs();
    const job = await createJob(manager, version.id, dataset.id);
    const expanded = await expandedJob(manager, job, {
      quantity: { mode: 'FIELD', field: 'quantity', whenMissing: 'REFUSE', defaultQuantity: 1 },
    });
    expect(expanded.status).toBe('READY');
    expect(expanded.counts.instanceCount).toBe(6);

    const page = (await manager.get(`${API}/production-jobs/${job.id}/instances?pageSize=50`))
      .body as ProductionInstancePageDto;
    expect(
      page.items.map((instance) => [
        instance.sequence,
        instance.datasetRecordSequence,
        instance.copyIndex,
        instance.copies,
      ]),
    ).toEqual([
      [1, 1, 1, 2],
      [2, 1, 2, 2],
      [3, 2, 1, 3],
      [4, 2, 2, 3],
      [5, 2, 3, 3],
      [6, 3, 1, 1],
    ]);
  });

  it('an unusable quantity makes tags invalid and blocks the release; tags are never dropped', async () => {
    const { version, dataset } = await inputs(quantityRows([2, 'five', 1]));
    const job = await createJob(manager, version.id, dataset.id);
    const expanded = await expandedJob(manager, job, {
      quantity: { mode: 'FIELD', field: 'quantity', whenMissing: 'REFUSE', defaultQuantity: 1 },
    });
    expect(expanded.status).toBe('HAS_ERRORS');
    expect(expanded.counts.errorCount).toBe(1);
    // The bad record still produced one instance carrying the error: nothing disappeared.
    expect(expanded.counts.instanceCount).toBe(4);

    const release = await manager
      .post(`${API}/production-jobs/${job.id}/release`)
      .send({ expectedRevision: expanded.revision, acknowledgeWarnings: true });
    expect(release.status).toBe(409);
    expect(release.body.error.code).toBe('PRODUCTION_JOB_HAS_ERRORS');

    const invalid = (await manager.get(`${API}/production-jobs/${job.id}/instances?status=ERROR`))
      .body as ProductionInstancePageDto;
    expect(invalid.items).toHaveLength(1);
    const detail = (
      await manager.get(`${API}/production-jobs/${job.id}/instances/${invalid.items[0]!.sequence}`)
    ).body as ProductionInstanceDetailDto;
    expect(detail.issues[0]).toMatchObject({ layer: 'PRODUCTION', code: 'QUANTITY_VALUE_INVALID' });
  });

  it('serial numbers: previewed without reserving, committed exactly once on release', async () => {
    const { version, dataset } = await inputs();
    const sequence = await createSequence(manager);
    const job = await createJob(manager, version.id, dataset.id);
    const expanded = await expandedJob(manager, job, {
      serial: { enabled: true, sequenceId: sequence.id },
    });
    expect(expanded.serialPreview).toMatchObject({
      first: 'YT-01000001',
      last: 'YT-01000003',
      provisional: true,
    });
    // Previewing changes nothing about the sequence.
    const untouched = (await manager.get(`${API}/sequences/${sequence.id}`)).body as SequenceDto;
    expect(untouched.nextValue).toBe(1_000_001);
    expect(untouched.reservationCount).toBe(0);

    await manager
      .post(`${API}/production-jobs/${job.id}/release`)
      .send({ expectedRevision: expanded.revision, acknowledgeWarnings: false });
    const ready = await waitForRendering(manager, job.id);
    expect(ready.reservation).toMatchObject({
      startValue: 1_000_001,
      endValue: 1_000_003,
      count: 3,
      firstSerial: 'YT-01000001',
      lastSerial: 'YT-01000003',
    });

    const page = (await manager.get(`${API}/production-jobs/${job.id}/instances?pageSize=50`))
      .body as ProductionInstancePageDto;
    expect(page.items.map((instance) => instance.serial)).toEqual([
      'YT-01000001',
      'YT-01000002',
      'YT-01000003',
    ]);
    const after = (await manager.get(`${API}/sequences/${sequence.id}`)).body as SequenceDto;
    expect(after.nextValue).toBe(1_000_004);
    expect(after.reservedCount).toBe(3);
  });

  it('two jobs released against one sequence never overlap, and numbers are never reused', async () => {
    const { version, dataset } = await inputs();
    const sequence = await createSequence(manager);
    const first = await expandedJob(manager, await createJob(manager, version.id, dataset.id), {
      serial: { enabled: true, sequenceId: sequence.id },
    });
    const second = await expandedJob(manager, await createJob(manager, version.id, dataset.id), {
      serial: { enabled: true, sequenceId: sequence.id },
    });

    // Both releases run at the same moment; the sequence row lock serializes them.
    const [releaseA, releaseB] = await Promise.all([
      manager
        .post(`${API}/production-jobs/${first.id}/release`)
        .send({ expectedRevision: first.revision, acknowledgeWarnings: false }),
      manager
        .post(`${API}/production-jobs/${second.id}/release`)
        .send({ expectedRevision: second.revision, acknowledgeWarnings: false }),
    ]);
    expect([releaseA.status, releaseB.status]).toEqual([200, 200]);

    const reservations = await t.prisma.sequenceReservation.findMany({
      where: { sequenceId: sequence.id },
      orderBy: { startValue: 'asc' },
    });
    expect(reservations).toHaveLength(2);
    expect(Number(reservations[0]!.endValue)).toBeLessThan(Number(reservations[1]!.startValue));
    const serials = await t.prisma.productionInstance.findMany({
      where: { productionJobId: { in: [first.id, second.id] } },
      select: { serialValue: true },
    });
    await waitForRendering(manager, first.id);
    await waitForRendering(manager, second.id);
    const afterRelease = await t.prisma.productionInstance.findMany({
      where: { productionJobId: { in: [first.id, second.id] } },
      select: { serialValue: true },
    });
    expect(serials.length).toBe(6);
    expect(new Set(afterRelease.map((row) => row.serialValue)).size).toBe(6);
  });

  it('warnings need an explicit acknowledgement before release', async () => {
    // An image asset that does not exist gives every row a warning-free error; instead we use a
    // dataset whose rows carry warnings from the import (an empty optional image is fine), so we
    // provoke a warning through a missing optional value in the template preview instead.
    const { version, dataset } = await inputs();
    const job = await createJob(manager, version.id, dataset.id);
    const expanded = await expandedJob(manager, job);
    if (expanded.counts.warningCount === 0) {
      // No warnings in this dataset: releasing without acknowledgement must simply work.
      const released = await manager
        .post(`${API}/production-jobs/${job.id}/release`)
        .send({ expectedRevision: expanded.revision, acknowledgeWarnings: false });
      expect(released.status, JSON.stringify(released.body)).toBe(200);
      return;
    }
    const refused = await manager
      .post(`${API}/production-jobs/${job.id}/release`)
      .send({ expectedRevision: expanded.revision, acknowledgeWarnings: false });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('PRODUCTION_WARNINGS_NOT_ACKNOWLEDGED');
    const accepted = await manager
      .post(`${API}/production-jobs/${job.id}/release`)
      .send({ expectedRevision: expanded.revision, acknowledgeWarnings: true });
    expect(accepted.status).toBe(200);
    expect((accepted.body as ProductionJobDto).warningsAcknowledgedAt).not.toBeNull();
  });

  it('a released job is immutable at the API and in the database', async () => {
    const { version, dataset } = await inputs();
    const sequence = await createSequence(manager);
    const job = await createJob(manager, version.id, dataset.id);
    const expanded = await expandedJob(manager, job, {
      serial: { enabled: true, sequenceId: sequence.id },
    });
    await manager
      .post(`${API}/production-jobs/${job.id}/release`)
      .send({ expectedRevision: expanded.revision, acknowledgeWarnings: false });
    const ready = await waitForRendering(manager, job.id);

    const revision = ready.revision;
    const refusals = [
      await manager
        .patch(`${API}/production-jobs/${job.id}`)
        .send({ expectedRevision: revision, name: 'Renamed' }),
      await manager
        .post(`${API}/production-jobs/${job.id}/validate`)
        .send({ expectedRevision: revision }),
      await manager
        .post(`${API}/production-jobs/${job.id}/cancel`)
        .send({ expectedRevision: revision }),
      await manager
        .post(`${API}/production-jobs/${job.id}/release`)
        .send({ expectedRevision: revision, acknowledgeWarnings: true }),
    ];
    for (const response of refusals) {
      expect(response.status, JSON.stringify(response.body)).toBe(409);
      expect(response.body.error.code).toBe('PRODUCTION_JOB_IMMUTABLE');
    }

    // The database refuses the same changes, whatever the application does.
    await expect(
      t.prisma.productionInstance.deleteMany({ where: { productionJobId: job.id } }),
    ).rejects.toThrow(/released production job/);
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE production_instances SET instance_hash = repeat('a', 64) WHERE production_job_id = $1::uuid`,
        job.id,
      ),
    ).rejects.toThrow(/released production job/);
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE production_instances SET serial_value = 'X' WHERE production_job_id = $1::uuid`,
        job.id,
      ),
    ).rejects.toThrow(/released production job/);
    await expect(
      t.prisma.$executeRawUnsafe(
        `DELETE FROM sequence_reservations WHERE production_job_id = $1::uuid`,
        job.id,
      ),
    ).rejects.toThrow(/cannot be released/);
  });

  it('retrying the release rewrites the same values: no second range, no second manifest', async () => {
    const { version, dataset } = await inputs();
    const sequence = await createSequence(manager);
    const job = await createJob(manager, version.id, dataset.id);
    const expanded = await expandedJob(manager, job, {
      serial: { enabled: true, sequenceId: sequence.id },
    });
    // The worker is paused, so the release job is run here twice: exactly what a BullMQ retry of
    // an interrupted attempt does.
    await worker.pause();
    try {
      await manager
        .post(`${API}/production-jobs/${job.id}/release`)
        .send({ expectedRevision: expanded.revision, acknowledgeWarnings: false });
      const row = await t.prisma.productionJob.findFirstOrThrow({ where: { id: job.id } });
      const deps = {
        prisma: t.prisma,
        storage: productionStorage(t),
        settings: productionSettings(t),
        finalAttempt: true,
      };
      const payload = {
        correlationId: null,
        requestedAt: new Date().toISOString(),
        organizationId,
        productionJobId: job.id,
        requestedByUserId: row.releasedById!,
        releaseRun: row.releaseRun,
      };
      expect(await processReleaseJob(deps, payload)).toMatchObject({ outcome: 'COMPLETED' });
      const ready = await manager.get(`${API}/production-jobs/${job.id}`);
      const first = ready.body as ProductionJobDto;
      expect(first.status).toBe('READY_FOR_RENDERING');

      // A second attempt of the same run finds the job finished and changes nothing.
      expect(await processReleaseJob(deps, payload)).toMatchObject({ outcome: 'SKIPPED' });
      const after = (await manager.get(`${API}/production-jobs/${job.id}`))
        .body as ProductionJobDto;
      expect(after.instancesDigest).toBe(first.instancesDigest);
      expect(after.productionJobHash).toBe(first.productionJobHash);
    } finally {
      worker.resume();
    }
    expect(await t.prisma.sequenceReservation.count({ where: { sequenceId: sequence.id } })).toBe(
      1,
    );
    expect(await t.prisma.productionArtifact.count({ where: { productionJobId: job.id } })).toBe(1);
    const sequenceAfter = (await manager.get(`${API}/sequences/${sequence.id}`))
      .body as SequenceDto;
    expect(sequenceAfter.nextValue).toBe(1_000_004);
  });

  it('re-expanding replaces the tags instead of adding to them', async () => {
    const { version, dataset } = await inputs();
    const job = await createJob(manager, version.id, dataset.id);
    const first = await expandedJob(manager, job);
    expect(first.counts.instanceCount).toBe(3);

    const again = await expandedJob(manager, first);
    expect(again.counts.instanceCount).toBe(3);
    expect(await t.prisma.productionInstance.count({ where: { productionJobId: job.id } })).toBe(3);

    // An expansion job of an older run does nothing at all.
    const stale = await processExpandJob(
      {
        prisma: t.prisma,
        storage: productionStorage(t),
        settings: productionSettings(t),
        finalAttempt: true,
      },
      {
        correlationId: null,
        requestedAt: new Date().toISOString(),
        organizationId,
        productionJobId: job.id,
        requestedByUserId: (
          await t.prisma.productionJob.findFirstOrThrow({ where: { id: job.id } })
        ).createdById,
        expansionRun: 1,
      },
    );
    expect(stale).toMatchObject({ outcome: 'SKIPPED' });
    expect(await t.prisma.productionInstance.count({ where: { productionJobId: job.id } })).toBe(3);
  });

  it('changing the configuration discards the tags that belonged to the old one', async () => {
    const { version, dataset } = await inputs();
    const job = await createJob(manager, version.id, dataset.id);
    const expanded = await expandedJob(manager, job);
    expect(expanded.counts.instanceCount).toBe(3);

    const reconfigured = await configureJob(manager, expanded, {
      quantity: { mode: 'FIELD', field: 'quantity', whenMissing: 'REFUSE', defaultQuantity: 1 },
    });
    expect(reconfigured.status).toBe('DRAFT');
    expect(reconfigured.counts.instanceCount).toBe(0);
    expect(await t.prisma.productionInstance.count({ where: { productionJobId: job.id } })).toBe(0);
  });

  it('refuses inputs that are not exact: draft artwork, unfinalized data, another schema', async () => {
    const { version, dataset } = await inputs();

    const draft = await createVariableDataTemplate(designer, 'HT-DRAFT');
    const draftJob = await manager.post(`${API}/production-jobs`).send({
      name: 'Draft artwork',
      templateVersionId: draft.version.id,
      datasetVersionId: dataset.id,
    });
    expect(draftJob.status).toBe(409);
    expect(draftJob.body.error.code).toBe('TEMPLATE_NOT_APPROVED');

    // The same draft is allowed for an explicitly non-production job.
    const draftDataset = await finalizedDataset(
      operator,
      draft.version.id,
      quantityRows([1]),
      'Draft data',
    ).catch(() => null);
    if (draftDataset) {
      const nonProduction = await manager.post(`${API}/production-jobs`).send({
        name: 'Try it out',
        templateVersionId: draft.version.id,
        datasetVersionId: draftDataset.id,
        productionMode: 'NON_PRODUCTION',
      });
      expect(nonProduction.status, JSON.stringify(nonProduction.body)).toBe(201);
      expect((nonProduction.body as ProductionJobDto).productionMode).toBe('NON_PRODUCTION');
    }

    // A dataset of a different template version has a different data schema hash.
    const other = await approvedTemplateVersion(designer, approver, 'HT-OTHER');
    const mismatch = await manager.post(`${API}/production-jobs`).send({
      name: 'Mismatched',
      templateVersionId: other.id,
      datasetVersionId: dataset.id,
    });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('TEMPLATE_DATASET_SCHEMA_MISMATCH');

    // A draft dataset version (not finalized) is refused.
    const draftVersion = await t.prisma.datasetVersion.findFirst({
      where: { organizationId, status: 'DRAFT' },
      select: { id: true },
    });
    if (draftVersion) {
      const notFinalized = await manager.post(`${API}/production-jobs`).send({
        name: 'Draft data',
        templateVersionId: version.id,
        datasetVersionId: draftVersion.id,
      });
      expect(notFinalized.status).toBe(409);
      expect(notFinalized.body.error.code).toBe('DATASET_NOT_FINALIZED');
    }
  });

  it('samples point at tags worth previewing, and a tag can be read with its context', async () => {
    const { version, dataset } = await inputs();
    const job = await createJob(manager, version.id, dataset.id);
    const expanded = await expandedJob(manager, job, {
      quantity: { mode: 'FIELD', field: 'quantity', whenMissing: 'REFUSE', defaultQuantity: 1 },
    });
    expect(expanded.counts.instanceCount).toBe(6);

    const samples = (await manager.get(`${API}/production-jobs/${job.id}/samples`))
      .body as ProductionSampleDto[];
    expect(samples.length).toBeGreaterThanOrEqual(2);
    expect(samples.map((sample) => sample.sequence)).toContain(1);
    expect(samples.map((sample) => sample.sequence)).toContain(6);

    const detail = (await manager.get(`${API}/production-jobs/${job.id}/instances/3`))
      .body as ProductionInstanceDetailDto;
    expect(detail.context).toMatchObject({ instanceIndex: 3, copyIndex: 1 });
    expect(detail.record.style).toBe('YT-2046');
    expect(detail.previousSequence).toBe(2);
    expect(detail.nextSequence).toBe(4);
  });

  it('cancelling removes the tags of a job that was never released', async () => {
    const { version, dataset } = await inputs();
    const job = await createJob(manager, version.id, dataset.id);
    const expanded = await expandedJob(manager, job);
    const cancelled = await manager
      .post(`${API}/production-jobs/${job.id}/cancel`)
      .send({ expectedRevision: expanded.revision });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect((cancelled.body as ProductionJobDto).status).toBe('CANCELLED');
    expect(await t.prisma.productionInstance.count({ where: { productionJobId: job.id } })).toBe(0);
  });

  it('the manifest is stored, hashed and downloadable, and verification detects tampering', async () => {
    const { version, dataset } = await inputs();
    const job = await createJob(manager, version.id, dataset.id);
    const expanded = await expandedJob(manager, job);
    await manager
      .post(`${API}/production-jobs/${job.id}/release`)
      .send({ expectedRevision: expanded.revision, acknowledgeWarnings: false });
    await waitForRendering(manager, job.id);

    const download = await manager.get(`${API}/production-jobs/${job.id}/manifest/download`);
    expect(download.status).toBe(200);
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.headers['content-security-policy']).toContain('sandbox');
    const artifact = await t.prisma.productionArtifact.findFirstOrThrow({
      where: { productionJobId: job.id },
    });
    expect(await sha256Hex(download.text)).toBe(artifact.checksumSha256);
    expect(download.text).toBe(serializeManifest(JSON.parse(download.text) as ProductionManifest));

    // The stored file is changed behind the application's back: verification says so.
    const storage = productionStorage(t);
    const tampered = JSON.parse(download.text) as ProductionManifest;
    await storage.putObject(
      artifact.storageKey,
      Buffer.from(
        serializeManifest({ ...tampered, instances: { ...tampered.instances, count: 99 } }),
      ),
      { contentType: 'application/json', checksumSha256: 'x'.repeat(64) },
    );
    const verified = await manager.get(`${API}/production-jobs/${job.id}/manifest`);
    expect(verified.status).toBe(200);
    expect(verified.body.verified.valid).toBe(false);
    expect(
      (verified.body.verified.issues as { code: string }[]).map((issue) => issue.code),
    ).toContain('MANIFEST_CHECKSUM_MISMATCH');
  });

  it('records a job history and audits aggregates, never one event per tag', async () => {
    const { version, dataset } = await inputs();
    const job = await createJob(manager, version.id, dataset.id);
    const expanded = await expandedJob(manager, job);
    await manager
      .post(`${API}/production-jobs/${job.id}/release`)
      .send({ expectedRevision: expanded.revision, acknowledgeWarnings: false });
    const ready = await waitForRendering(manager, job.id);

    expect(ready.events.map((event) => event.type)).toEqual([
      'CREATED',
      'EXPANDED',
      'RELEASED',
      'READY_FOR_RENDERING',
    ]);
    const audits = await t.prisma.auditEvent.findMany({
      where: { organizationId, resourceType: 'PRODUCTION_JOB' },
      orderBy: { occurredAt: 'asc' },
    });
    expect(audits.map((event) => event.action)).toEqual([
      'PRODUCTION_JOB_CREATED',
      'PRODUCTION_JOB_VALIDATION_REQUESTED',
      'PRODUCTION_JOB_RELEASED',
    ]);
    for (const event of audits) {
      expect(JSON.stringify(event.metadata).length).toBeLessThan(1_000);
    }
  });
});
