import {
  DATA_SCHEMA_HASH_SCHEME,
  RESOLVED_INPUT_HASH_SCHEME,
  computeDataSchemaHash,
  type AssetAvailability,
  type NormalizedDataRecord,
} from '@smarttag/data-core';
import { Prisma } from '@smarttag/database';
import type { DesignDocument } from '@smarttag/document-schema';
import { IMPORT_NORMALIZATION_VERSION } from '@smarttag/import-core';
import {
  InstanceLimitExceededError,
  PRODUCTION_INSTANCE_CONTRACT,
  createInstanceProcessor,
  expandRecords,
  statusForCounts,
  type ExpandableRecord,
  type ProductionConfiguration,
  type ResolvedInstance,
} from '@smarttag/production-core';
import type { ProductionExpandJob } from '@smarttag/shared-types';
import { ProductionSummaryBuilder } from './summary';
import {
  MemorySampler,
  ProductionPreconditionError,
  SILENT_LOGGER,
  StaleRunError,
  configurationOf,
  documentOf,
  failureOf,
  lookupImageAvailability,
  recordJobEvent,
  sha256,
  type ProductionJobOutcome,
  type ProductionProcessingDeps,
} from './support';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A production instance as sent to PostgreSQL's jsonb_to_recordset (snake_case columns). */
interface InstanceRow {
  readonly sequence: number;
  readonly dataset_record_sequence: number;
  readonly source_row_number: number;
  readonly copy_index: number;
  readonly copies: number;
  readonly status: string;
  readonly error_count: number;
  readonly warning_count: number;
  readonly source_warning_count: number;
  readonly issues: unknown;
  readonly resolved_input_hash: string | null;
}

/** Which record values can name an image asset (so only those are looked up). */
function imageFieldKeys(document: DesignDocument): readonly string[] {
  return document.dataSchema.fields
    .filter((field) => field.type === 'image')
    .map((field) => field.key);
}

/**
 * Expands a production job: every selected dataset record becomes the number of tags its quantity
 * asks for, in dataset order, and every tag is resolved and checked with the Phase 3 engine.
 *
 * Idempotent and retry-safe:
 *
 * - the job belongs to one expansion run; if the job moved on, this job does nothing;
 * - instances of earlier runs (and of an interrupted attempt of this run) are deleted before any
 *   are written, so a retry can never duplicate tags or shift their order;
 * - the result becomes visible in one update guarded by the run number.
 *
 * Serial numbers are deliberately NOT allocated here: they are committed when the job is released
 * (docs/sequences.md), so previewing or re-expanding a draft never burns numbers.
 */
export async function processExpandJob(
  deps: ProductionProcessingDeps,
  job: ProductionExpandJob,
): Promise<ProductionJobOutcome> {
  const { prisma, settings } = deps;
  const logger = deps.logger ?? SILENT_LOGGER;
  const started = Date.now();
  const memory = new MemorySampler();

  const current = await prisma.productionJob.findFirst({
    where: { id: job.productionJobId, organizationId: job.organizationId },
    include: {
      templateVersion: { select: { documentJson: true, documentHash: true } },
      datasetVersion: { select: { status: true, datasetHash: true, rowCount: true } },
    },
  });
  if (!current) return { outcome: 'SKIPPED', reason: 'production job not found' };
  if (current.expansionRun !== job.expansionRun) return { outcome: 'SKIPPED', reason: 'stale run' };
  if (current.status !== 'QUEUED' && current.status !== 'EXPANDING') {
    return { outcome: 'SKIPPED', reason: `job is ${current.status}` };
  }

  const stillCurrent = async () => {
    const found = await prisma.productionJob.count({
      where: {
        id: current.id,
        expansionRun: job.expansionRun,
        status: { in: ['QUEUED', 'EXPANDING', 'VALIDATING'] },
      },
    });
    if (found === 0) throw new StaleRunError();
  };

  try {
    const configuration: ProductionConfiguration = configurationOf(current.configuration);
    const document = documentOf(
      current.templateVersion.documentJson,
      current.templateVersionHash,
      current.templateVersion.documentHash,
    );
    if ((await computeDataSchemaHash(document.dataSchema)) !== current.dataSchemaHash) {
      throw new ProductionPreconditionError(
        'TEMPLATE_DATASET_SCHEMA_MISMATCH',
        "The template version's data schema changed after this job was created.",
      );
    }
    if (current.datasetVersion.status !== 'FINALIZED') {
      throw new ProductionPreconditionError(
        'DATASET_NOT_FINALIZED',
        'The dataset version is not finalized.',
      );
    }
    if (current.datasetVersion.datasetHash !== current.datasetHash) {
      throw new ProductionPreconditionError(
        'PRODUCTION_JOB_IMMUTABLE',
        'The dataset version changed after this job was created.',
      );
    }

    const selection =
      configuration.recordSelection.mode === 'SEQUENCES'
        ? [...new Set(configuration.recordSelection.sequences)].sort((a, b) => a - b)
        : null;
    if (selection && selection.length > settings.limits.maxSelectedRecords) {
      throw new ProductionPreconditionError(
        'INVALID_PRODUCTION_CONFIGURATION',
        `At most ${settings.limits.maxSelectedRecords.toLocaleString('en-US')} records can be selected explicitly.`,
      );
    }

    // A retry starts from a clean slate; the job is not released, so its instances may go.
    await prisma.productionInstance.deleteMany({ where: { productionJobId: current.id } });
    await prisma.productionJob.updateMany({
      where: { id: current.id, expansionRun: job.expansionRun, status: 'QUEUED' },
      data: {
        status: 'EXPANDING',
        progressPhase: 'EXPANDING',
        progressProcessed: 0,
        progressTotal: null,
        progressUpdatedAt: new Date(),
      },
    });

    const processor = createInstanceProcessor({
      document,
      templateVersionHash: current.templateVersionHash,
    });
    const imageFields = imageFieldKeys(document);
    const summary = new ProductionSummaryBuilder();

    let sequence = 0;
    let recordCount = 0;
    let valid = 0;
    let warnings = 0;
    let errors = 0;
    let sourceWarnings = 0;
    let batches = 0;
    let pipelineMs = 0;
    let databaseMs = 0;
    let rows: InstanceRow[] = [];

    const flush = async () => {
      if (rows.length === 0) return;
      const writeStarted = performance.now();
      await stillCurrent();
      // One statement per batch: the instances travel as a single JSON parameter.
      await prisma.$executeRaw`
        INSERT INTO production_instances (
          production_job_id, sequence, organization_id, dataset_record_sequence, source_row_number,
          copy_index, copies, status, error_count, warning_count, source_warning_count, issues,
          resolved_input_hash
        )
        SELECT ${current.id}::uuid, r.sequence, ${current.organizationId}::uuid,
          r.dataset_record_sequence, r.source_row_number, r.copy_index, r.copies,
          r.status::production_instance_status, r.error_count, r.warning_count,
          r.source_warning_count, r.issues, r.resolved_input_hash
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(
          sequence integer, dataset_record_sequence integer, source_row_number integer,
          copy_index integer, copies integer, status text, error_count integer,
          warning_count integer, source_warning_count integer, issues jsonb,
          resolved_input_hash text
        )`;
      await prisma.productionJob.updateMany({
        where: { id: current.id, expansionRun: job.expansionRun, status: 'EXPANDING' },
        data: { progressProcessed: sequence, progressUpdatedAt: new Date() },
      });
      databaseMs += performance.now() - writeStarted;
      batches += 1;
      rows = [];
      memory.sample();
    };

    const batchSize = settings.limits.recordBatchSize;
    let cursor = 0;
    let selectionIndex = 0;
    for (;;) {
      const wanted = selection ? selection.slice(selectionIndex, selectionIndex + batchSize) : null;
      if (wanted && wanted.length === 0) break;
      const records = await prisma.datasetRecord.findMany({
        where: {
          datasetVersionId: current.datasetVersionId,
          ...(wanted ? { sequence: { in: wanted } } : { sequence: { gt: cursor } }),
        },
        orderBy: { sequence: 'asc' },
        ...(wanted ? {} : { take: batchSize }),
        select: {
          sequence: true,
          rowNumber: true,
          normalizedRecord: true,
          recordHash: true,
          warningCount: true,
        },
      });
      if (records.length === 0) break;
      cursor = records[records.length - 1]!.sequence;
      selectionIndex += wanted?.length ?? 0;
      recordCount += records.length;

      const pipelineStarted = performance.now();
      const expandable: ExpandableRecord[] = records.map((record) => ({
        sequence: record.sequence,
        rowNumber: record.rowNumber,
        record: record.normalizedRecord as NormalizedDataRecord,
        recordHash: record.recordHash,
      }));
      const planned = [
        ...expandRecords(expandable, {
          configuration,
          limits: settings.limits,
          schema: document.dataSchema,
          startSequence: sequence + 1,
        }),
      ];
      pipelineMs += performance.now() - pipelineStarted;

      // Image assets are looked up once per batch, scoped to this organization: an id belonging to
      // another tenant is simply not found.
      const assetIds = new Set<string>();
      for (const record of records) {
        const values = record.normalizedRecord as NormalizedDataRecord;
        for (const key of imageFields) {
          const value = values[key];
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
      const assetAvailability = (id: string): AssetAvailability =>
        availabilityMap.get(id.trim().toLowerCase()) ?? 'UNAVAILABLE';

      const sourceWarningsByRecord = new Map(
        records.map((record) => [record.sequence, record.warningCount]),
      );

      let resumed = performance.now();
      let cached: { recordSequence: number; resolved: ResolvedInstance } | null = null;
      for (const instance of planned) {
        // Copies of one record differ only when the artwork uses per-instance values (a serial
        // number, the position in the job). Otherwise one resolution serves every copy, which is
        // what makes million-tag jobs affordable.
        const reusable: ResolvedInstance | null =
          !processor.perInstance && cached?.recordSequence === instance.recordSequence
            ? cached.resolved
            : null;
        const resolved: ResolvedInstance =
          reusable ??
          processor.resolve({
            record: instance.record,
            recordHash: instance.recordHash,
            context: {
              serial: null,
              instanceIndex: instance.sequence,
              copyIndex: instance.copyIndex,
              sourceRow: instance.sourceRow,
              jobNumber: current.jobNumber,
            },
            issues: instance.issues,
            assetAvailability,
          });
        cached = { recordSequence: instance.recordSequence, resolved };

        if (resolved.status === 'VALID') valid += 1;
        else if (resolved.status === 'WARNING') warnings += 1;
        else errors += 1;
        summary.add(resolved.issues);
        const recordWarnings = sourceWarningsByRecord.get(instance.recordSequence) ?? 0;
        if (recordWarnings > 0) sourceWarnings += 1;
        rows.push({
          sequence: instance.sequence,
          dataset_record_sequence: instance.recordSequence,
          source_row_number: instance.sourceRow,
          copy_index: instance.copyIndex,
          copies: instance.copies,
          status: resolved.status,
          error_count: resolved.errorCount,
          warning_count: resolved.warningCount,
          source_warning_count: recordWarnings,
          issues: resolved.issues,
          resolved_input_hash:
            resolved.status === 'ERROR' ? null : sha256(resolved.resolvedInputHashPayload),
        });
        sequence = instance.sequence;
        if (rows.length >= settings.limits.expansionBatchSize) {
          pipelineMs += performance.now() - resumed;
          await flush();
          resumed = performance.now();
        }
      }
      pipelineMs += performance.now() - resumed;
      await flush();
      if (!wanted && records.length < batchSize) break;
    }

    await flush();
    await stillCurrent();

    if (sequence === 0) {
      throw new ProductionPreconditionError(
        'INVALID_PRODUCTION_CONFIGURATION',
        'This job selects no dataset records, so it would produce no tags.',
      );
    }

    const status = statusForCounts({ errorCount: errors, warningCount: warnings });
    const durationMs = Date.now() - started;
    const updated = await prisma.productionJob.updateMany({
      where: {
        id: current.id,
        expansionRun: job.expansionRun,
        status: { in: ['EXPANDING', 'VALIDATING'] },
      },
      data: {
        status,
        recordCount,
        instanceCount: sequence,
        validCount: valid,
        warningCount: warnings,
        errorCount: errors,
        sourceWarningCount: sourceWarnings,
        validationSummary: summary.build() as unknown as Prisma.InputJsonValue,
        versions: {
          contract: PRODUCTION_INSTANCE_CONTRACT,
          resolvedInput: RESOLVED_INPUT_HASH_SCHEME,
          dataSchema: DATA_SCHEMA_HASH_SCHEME,
          importNormalization: IMPORT_NORMALIZATION_VERSION,
        },
        expandedAt: new Date(),
        progressPhase: null,
        progressProcessed: sequence,
        progressTotal: sequence,
        progressUpdatedAt: new Date(),
        failure: Prisma.DbNull,
        metrics: {
          expansion: {
            run: job.expansionRun,
            records: recordCount,
            instances: sequence,
            batches,
            durationMs,
            instancesPerSecond:
              durationMs > 0 ? Math.round((sequence * 1000) / durationMs) : sequence,
            pipelineMs: Math.round(pipelineMs),
            databaseMs: Math.round(databaseMs),
            peakRssBytes: memory.peakRssBytes,
            peakHeapUsedBytes: memory.peakHeapUsedBytes,
            completedAt: new Date().toISOString(),
          },
        },
      },
    });
    if (updated.count === 0) throw new StaleRunError();

    await recordJobEvent(
      prisma,
      current,
      'EXPANDED',
      `${sequence.toLocaleString('en-US')} tags from ${recordCount.toLocaleString('en-US')} records`,
      { instances: sequence, records: recordCount, valid, warnings, errors, status },
      job.requestedByUserId,
    );
    logger.info(
      { productionJobId: current.id, instances: sequence, durationMs, status },
      'production job expanded',
    );
    return { outcome: 'COMPLETED', status };
  } catch (error) {
    if (error instanceof StaleRunError) return { outcome: 'SKIPPED', reason: 'stale run' };
    if (error instanceof InstanceLimitExceededError) {
      await markFailed(deps, current, 'INSTANCE_LIMIT_EXCEEDED', error.message, job.expansionRun);
      return { outcome: 'FAILED', code: 'INSTANCE_LIMIT_EXCEEDED' };
    }
    const failure = failureOf(error);
    if (failure.retryable && deps.finalAttempt === false) throw error;
    await markFailed(deps, current, failure.code, failure.message, job.expansionRun);
    logger.error(
      { productionJobId: current.id, code: failure.code },
      'production job expansion failed',
    );
    return { outcome: 'FAILED', code: failure.code };
  }
}

/** Records a failure on the job, leaving its configuration editable. */
export async function markFailed(
  deps: ProductionProcessingDeps,
  job: { id: string; organizationId: string },
  code: string,
  message: string,
  expansionRun?: number,
): Promise<void> {
  await deps.prisma.productionJob.updateMany({
    where: {
      id: job.id,
      ...(expansionRun === undefined ? {} : { expansionRun }),
      status: { in: ['QUEUED', 'EXPANDING', 'VALIDATING'] },
    },
    data: {
      status: 'FAILED',
      failure: { code, message },
      progressPhase: null,
      progressUpdatedAt: new Date(),
    },
  });
  await recordJobEvent(deps.prisma, job, 'FAILED', message, { code });
}
