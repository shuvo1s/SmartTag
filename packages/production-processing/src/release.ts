import type { AssetAvailability, NormalizedDataRecord } from '@smarttag/data-core';
import { productionArtifactStorageKey } from '@smarttag/object-storage';
import {
  buildProductionManifest,
  PRODUCTION_INSTANCE_CONTRACT,
  computeProductionJobHash,
  createInstanceProcessor,
  instanceHashPayload,
  instancesDigestLine,
  serialAt,
  serializeManifest,
  type ProductionContext,
  type SerialRange,
} from '@smarttag/production-core';
import type { ProductionReleaseJob } from '@smarttag/shared-types';
import { createHash } from 'node:crypto';
import {
  MemorySampler,
  ProductionPreconditionError,
  SILENT_LOGGER,
  StaleRunError,
  asObject,
  configurationOf,
  documentOf,
  failureOf,
  lookupImageAvailability,
  recordJobEvent,
  sha256,
  type ProductionJobOutcome,
  type ProductionProcessingDeps,
} from './support';

/** Instance identity written back after release (snake_case for jsonb_to_recordset). */
interface ReleasedInstanceRow {
  readonly sequence: number;
  readonly serial_offset: number | null;
  readonly serial_value: string | null;
  readonly instance_hash: string;
  readonly status: string;
  readonly error_count: number;
  readonly warning_count: number;
  readonly issues: unknown;
  readonly resolved_input_hash: string | null;
}

const MANIFEST_CONTENT_TYPE = 'application/json; charset=utf-8';

/**
 * Finishes a released production job: every tag gets its serial number, its instance hash, and
 * the job gets its ordered digest, its job hash and its manifest.
 *
 * The serial range was already reserved in the release transaction, so this job never allocates
 * numbers. It is fully idempotent: the values it writes are derived from the job, the reservation
 * and the immutable dataset, so a retry recomputes exactly the same serials, hashes and manifest
 * and rewrites the same rows and the same manifest object — never a second range, never a second
 * manifest.
 */
export async function processReleaseJob(
  deps: ProductionProcessingDeps,
  job: ProductionReleaseJob,
): Promise<ProductionJobOutcome> {
  const { prisma, storage } = deps;
  const logger = deps.logger ?? SILENT_LOGGER;
  const started = Date.now();
  const memory = new MemorySampler();

  const current = await prisma.productionJob.findFirst({
    where: { id: job.productionJobId, organizationId: job.organizationId },
    include: {
      templateVersion: {
        select: {
          documentJson: true,
          documentHash: true,
          versionNumber: true,
          schemaVersion: true,
          status: true,
        },
      },
      template: { select: { id: true, code: true, name: true } },
      dataset: { select: { id: true, name: true } },
      datasetVersion: { select: { versionNumber: true, datasetHash: true, rowCount: true } },
      customer: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      reservation: { include: { sequence: true } },
      releasedBy: { select: { id: true, displayName: true } },
    },
  });
  if (!current) return { outcome: 'SKIPPED', reason: 'production job not found' };
  if (current.releaseRun !== job.releaseRun) return { outcome: 'SKIPPED', reason: 'stale run' };
  if (current.status !== 'RELEASED')
    return { outcome: 'SKIPPED', reason: `job is ${current.status}` };

  try {
    const configuration = configurationOf(current.configuration);
    const document = documentOf(
      current.templateVersion.documentJson,
      current.templateVersionHash,
      current.templateVersion.documentHash,
    );
    const reservation = current.reservation;
    if (configuration.serial.enabled && !reservation) {
      throw new ProductionPreconditionError(
        'SEQUENCE_RESERVATION_FAILED',
        'The job uses serial numbers but no range is reserved for it.',
      );
    }
    const range: SerialRange | null = reservation
      ? {
          startValue: Number(reservation.startValue),
          endValue: Number(reservation.endValue),
          count: reservation.valueCount,
        }
      : null;
    const format = reservation
      ? {
          prefix: reservation.sequence.prefix,
          suffix: reservation.sequence.suffix,
          padding: reservation.sequence.padding,
        }
      : null;

    // Tags only have to be resolved again when their artwork uses per-instance values: only then
    // does the real serial number change what is printed (and what must be checked).
    const processor = createInstanceProcessor({
      document,
      templateVersionHash: current.templateVersionHash,
    });
    const revalidate = processor.perInstance && range !== null;

    const digest = createHash('sha256');
    let processed = 0;
    let valid = 0;
    let warnings = 0;
    let errors = 0;
    let batches = 0;
    let databaseMs = 0;
    let rows: ReleasedInstanceRow[] = [];
    const batchSize = deps.settings.limits.expansionBatchSize;

    const flush = async () => {
      if (rows.length === 0) return;
      const writeStarted = performance.now();
      await prisma.$executeRaw`
        UPDATE production_instances AS i
        SET serial_offset = r.serial_offset,
            serial_value = r.serial_value,
            instance_hash = r.instance_hash,
            status = r.status::production_instance_status,
            error_count = r.error_count,
            warning_count = r.warning_count,
            issues = r.issues,
            resolved_input_hash = r.resolved_input_hash
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(
          sequence integer, serial_offset integer, serial_value text, instance_hash text,
          status text, error_count integer, warning_count integer, issues jsonb,
          resolved_input_hash text
        )
        WHERE i.production_job_id = ${current.id}::uuid AND i.sequence = r.sequence`;
      databaseMs += performance.now() - writeStarted;
      batches += 1;
      rows = [];
      memory.sample();
    };

    let cursor = 0;
    for (;;) {
      const instances = await prisma.$queryRaw<
        {
          sequence: number;
          dataset_record_sequence: number;
          source_row_number: number;
          copy_index: number;
          status: string;
          error_count: number;
          warning_count: number;
          issues: unknown;
          resolved_input_hash: string | null;
          record_hash: string;
          normalized_record: NormalizedDataRecord;
        }[]
      >`
        SELECT i.sequence, i.dataset_record_sequence, i.source_row_number, i.copy_index,
               i.status::text, i.error_count, i.warning_count, i.issues, i.resolved_input_hash,
               d.record_hash, d.normalized_record
        FROM production_instances i
        JOIN dataset_records d
          ON d.dataset_version_id = ${current.datasetVersionId}::uuid
         AND d.sequence = i.dataset_record_sequence
        WHERE i.production_job_id = ${current.id}::uuid AND i.sequence > ${cursor}
        ORDER BY i.sequence
        LIMIT ${batchSize}`;
      if (instances.length === 0) break;
      cursor = instances[instances.length - 1]!.sequence;

      let assetAvailability: ((assetId: string) => AssetAvailability) | undefined;
      if (revalidate) {
        const assetIds = new Set<string>();
        for (const instance of instances) {
          for (const value of Object.values(instance.normalized_record)) {
            if (typeof value === 'string' && UUID.test(value.trim())) {
              assetIds.add(value.trim().toLowerCase());
            }
          }
        }
        const lookupStarted = performance.now();
        const availabilityMap = await lookupImageAvailability(
          prisma,
          current.organizationId,
          assetIds,
        );
        databaseMs += performance.now() - lookupStarted;
        assetAvailability = (id: string) =>
          availabilityMap.get(id.trim().toLowerCase()) ?? 'UNAVAILABLE';
      }

      for (const instance of instances) {
        const serialOffset = range ? instance.sequence - 1 : null;
        const serial =
          range && format && serialOffset !== null ? serialAt(range, serialOffset, format) : null;
        const context: ProductionContext = {
          serial,
          instanceIndex: instance.sequence,
          copyIndex: instance.copy_index,
          sourceRow: instance.source_row_number,
          jobNumber: current.jobNumber,
        };

        let status = instance.status;
        let errorCount = instance.error_count;
        let warningCount = instance.warning_count;
        let issues = instance.issues;
        let resolvedInputHash = instance.resolved_input_hash;
        if (revalidate) {
          // The real serial number is now known: whatever it feeds (a barcode, a text) is checked
          // for real instead of being skipped as "supplied at production time".
          const resolved = processor.resolve({
            record: instance.normalized_record,
            recordHash: instance.record_hash,
            context,
            assetAvailability,
          });
          status = resolved.status;
          errorCount = resolved.errorCount;
          warningCount = resolved.warningCount;
          issues = resolved.issues;
          resolvedInputHash =
            resolved.status === 'ERROR' ? null : sha256(resolved.resolvedInputHashPayload);
        }
        if (status === 'VALID') valid += 1;
        else if (status === 'WARNING') warnings += 1;
        else errors += 1;

        const hash = sha256(
          instanceHashPayload({
            templateVersionHash: current.templateVersionHash,
            recordHash: instance.record_hash,
            context,
          }),
        );
        digest.update(instancesDigestLine(hash));
        rows.push({
          sequence: instance.sequence,
          serial_offset: serialOffset,
          serial_value: serial,
          instance_hash: hash,
          status,
          error_count: errorCount,
          warning_count: warningCount,
          issues,
          resolved_input_hash: resolvedInputHash,
        });
        processed += 1;
        if (rows.length >= batchSize) await flush();
      }
      await flush();
      await prisma.productionJob.updateMany({
        where: { id: current.id, releaseRun: job.releaseRun, status: 'RELEASED' },
        data: {
          progressPhase: 'RELEASING',
          progressProcessed: processed,
          progressTotal: current.instanceCount,
          progressUpdatedAt: new Date(),
        },
      });
      if (instances.length < batchSize) break;
    }
    await flush();

    if (processed !== current.instanceCount) {
      throw new ProductionPreconditionError(
        'PRODUCTION_JOB_NOT_READY',
        `The job records ${current.instanceCount} tags but ${processed} instances were found.`,
      );
    }

    // A serial number can only be checked once it exists. If printing it makes a tag invalid, the
    // job stops here: its serial range stays reserved (numbers are never reused) and the problem
    // is reported instead of being printed.
    if (errors > 0) {
      await prisma.productionJob.updateMany({
        where: { id: current.id, releaseRun: job.releaseRun, status: 'RELEASED' },
        data: {
          status: 'FAILED',
          validCount: valid,
          warningCount: warnings,
          errorCount: errors,
          failure: {
            code: 'PRODUCTION_JOB_HAS_ERRORS',
            message: `${errors.toLocaleString('en-US')} tags became invalid once their serial numbers were known. The reserved serial range stays used; create a new job after fixing the template or the data.`,
          },
          progressPhase: null,
          progressUpdatedAt: new Date(),
        },
      });
      await recordJobEvent(
        prisma,
        current,
        'FAILED',
        'Serial numbers made some tags invalid',
        { errors },
        job.requestedByUserId,
      );
      return { outcome: 'FAILED', code: 'PRODUCTION_JOB_HAS_ERRORS' };
    }

    const instancesDigest = digest.digest('hex');
    const serialReservation = reservation
      ? {
          sequenceCode: reservation.sequence.code,
          startValue: Number(reservation.startValue),
          endValue: Number(reservation.endValue),
        }
      : null;
    const productionJobHash = await computeProductionJobHash({
      templateVersionHash: current.templateVersionHash,
      datasetHash: current.datasetHash,
      dataSchemaHash: current.dataSchemaHash,
      configuration,
      serialReservation,
      instanceCount: current.instanceCount,
      instancesDigest,
      contractVersion:
        (asObject(current.versions).contract as string | undefined) ?? PRODUCTION_INSTANCE_CONTRACT,
    });

    const releasedAt = current.releasedAt ?? new Date();
    const manifest = buildProductionManifest({
      job: {
        id: current.id,
        jobNumber: current.jobNumber,
        name: current.name,
        productionMode: current.productionMode,
        organizationId: current.organizationId,
        customer: current.customer
          ? { id: current.customer.id, name: current.customer.name }
          : null,
        brand: current.brand ? { id: current.brand.id, name: current.brand.name } : null,
      },
      template: {
        templateId: current.template.id,
        templateCode: current.template.code,
        versionId: current.templateVersionId,
        versionNumber: current.templateVersion.versionNumber,
        documentHash: current.templateVersionHash,
        schemaVersion: current.templateVersion.schemaVersion,
        status: current.templateVersion.status,
      },
      dataset: {
        datasetId: current.datasetId,
        datasetName: current.dataset.name,
        versionId: current.datasetVersionId,
        versionNumber: current.datasetVersion.versionNumber ?? 0,
        datasetHash: current.datasetHash,
        recordCount: current.recordCount,
      },
      dataSchemaHash: current.dataSchemaHash,
      configuration,
      recordSelectionHash: current.recordSelectionHash,
      serialReservation:
        reservation && format && range
          ? {
              sequenceCode: reservation.sequence.code,
              sequenceName: reservation.sequence.name,
              startValue: range.startValue,
              endValue: range.endValue,
              firstSerial: serialAt(range, 0, format),
              lastSerial: serialAt(range, range.count - 1, format),
            }
          : null,
      instances: {
        count: current.instanceCount,
        validCount: valid,
        warningCount: warnings,
        errorCount: errors,
        digest: instancesDigest,
      },
      productionJobHash,
      versions: asObject(current.versions) as Record<string, string>,
      releasedAt: releasedAt.toISOString(),
      releasedBy: {
        id: current.releasedBy?.id ?? job.requestedByUserId,
        displayName: current.releasedBy?.displayName ?? '',
      },
      createdAt: current.createdAt.toISOString(),
    });

    const body = Buffer.from(serializeManifest(manifest), 'utf8');
    const checksum = sha256(body.toString('utf8'));
    const storageKey = productionArtifactStorageKey(current.organizationId, current.id, 'manifest');
    await storage.putObject(storageKey, body, {
      contentType: MANIFEST_CONTENT_TYPE,
      checksumSha256: checksum,
    });

    const durationMs = Date.now() - started;
    await prisma.$transaction(async (tx) => {
      const updated = await tx.productionJob.updateMany({
        where: { id: current.id, releaseRun: job.releaseRun, status: 'RELEASED' },
        data: {
          status: 'READY_FOR_RENDERING',
          validCount: valid,
          warningCount: warnings,
          errorCount: errors,
          instancesDigest,
          productionJobHash,
          readyForRenderingAt: new Date(),
          progressPhase: null,
          progressProcessed: processed,
          progressTotal: processed,
          progressUpdatedAt: new Date(),
          metrics: {
            ...asObject(current.metrics),
            release: {
              run: job.releaseRun,
              instances: processed,
              batches,
              revalidated: revalidate,
              durationMs,
              instancesPerSecond:
                durationMs > 0 ? Math.round((processed * 1000) / durationMs) : processed,
              databaseMs: Math.round(databaseMs),
              peakRssBytes: memory.peakRssBytes,
              peakHeapUsedBytes: memory.peakHeapUsedBytes,
              completedAt: new Date().toISOString(),
            },
          },
        },
      });
      if (updated.count === 0) throw new StaleRunError();
      // One manifest per job: a retry rewrites this row instead of adding a second artifact.
      await tx.productionArtifact.upsert({
        where: { productionJobId_kind: { productionJobId: current.id, kind: 'MANIFEST' } },
        create: {
          organizationId: current.organizationId,
          productionJobId: current.id,
          kind: 'MANIFEST',
          storageKey,
          contentType: MANIFEST_CONTENT_TYPE,
          sizeBytes: body.byteLength,
          checksumSha256: checksum,
          createdById: current.releasedById ?? job.requestedByUserId,
        },
        update: { storageKey, contentType: MANIFEST_CONTENT_TYPE, sizeBytes: body.byteLength },
      });
    });

    await recordJobEvent(
      prisma,
      current,
      'READY_FOR_RENDERING',
      'Serial numbers, instance hashes and the manifest are complete',
      { instances: processed, instancesDigest, productionJobHash, manifestChecksum: checksum },
      job.requestedByUserId,
    );
    logger.info(
      { productionJobId: current.id, instances: processed, durationMs },
      'production job ready for rendering',
    );
    return { outcome: 'COMPLETED', status: 'READY_FOR_RENDERING' };
  } catch (error) {
    if (error instanceof StaleRunError) return { outcome: 'SKIPPED', reason: 'stale run' };
    const failure = failureOf(error);
    if (failure.retryable && deps.finalAttempt === false) throw error;
    // The job stays RELEASED: its serial range is committed, and the release can be retried.
    await prisma.productionJob.updateMany({
      where: { id: current.id, releaseRun: job.releaseRun, status: 'RELEASED' },
      data: {
        failure: {
          code: failure.code,
          message: failure.message,
        },
        progressPhase: null,
        progressUpdatedAt: new Date(),
      },
    });
    await recordJobEvent(prisma, current, 'RELEASE_FAILED', failure.message, {
      code: failure.code,
    });
    logger.error({ productionJobId: current.id, code: failure.code }, 'production release failed');
    return { outcome: 'FAILED', code: failure.code };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
