import { computeDataSchemaHash, type AssetAvailability } from '@smarttag/data-core';
import type { Prisma } from '@smarttag/database';
import { parseDesignDocument } from '@smarttag/document-schema';
import {
  IMPORT_NORMALIZATION_VERSION,
  MAPPING_DEFINITION_VERSION,
  MappingDefinitionSchema,
  SourceSettingsSchema,
  canonicalMapping,
  countDataRows,
  createRowProcessor,
  isBlankRow,
  recordsDigestLine,
  validateMapping,
  validatedStatus,
  type ProcessedRow,
  type SourceColumn,
  type SourceInspection,
  type SourceRow,
} from '@smarttag/import-core';
import type { ImportValidateJob } from '@smarttag/shared-types';
import { SourceReadError, parserFor } from '@smarttag/tabular-sources';
import { createHash } from 'node:crypto';
import { asObject, markFailed, type ImportProcessingDeps, type JobOutcome } from './inspect';
import { ValidationSummaryBuilder } from './summary';
import {
  MemorySampler,
  SILENT_LOGGER,
  failureOf,
  lookupImageAvailability,
  sourceFromStorage,
} from './support';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** A dataset record as sent to PostgreSQL's jsonb_to_recordset (snake_case columns). */
interface RecordRow {
  readonly sequence: number;
  readonly row_number: number;
  readonly status: string;
  readonly normalized_record: unknown;
  readonly record_hash: string;
  readonly resolved_input_hash: string | null;
  readonly error_count: number;
  readonly warning_count: number;
  readonly issues: unknown;
  readonly duplicate_of_sequence: number | null;
  readonly search_text: string;
}

class StaleRunError extends Error {
  constructor() {
    super('The import changed while it was being validated');
    this.name = 'StaleRunError';
  }
}

class ValidationPreconditionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ValidationPreconditionError';
  }
}

/**
 * Validates every data row of an import with the shared row pipeline and writes the results into a
 * DRAFT dataset version, in batches, with progress. Idempotent and retry-safe:
 *
 * - the job belongs to one validation run; if the import moved on it does nothing (or stops);
 * - draft versions of earlier runs (and a partial draft of an interrupted attempt of this run) are
 *   deleted before rows are written, so a retry can never duplicate records;
 * - results become visible atomically: the version is marked complete and the import changes
 *   status in one transaction guarded by the run number.
 */
export async function processValidateJob(
  deps: ImportProcessingDeps,
  job: ImportValidateJob,
): Promise<JobOutcome> {
  const { prisma, storage, settings } = deps;
  const logger = deps.logger ?? SILENT_LOGGER;
  const started = Date.now();
  const memory = new MemorySampler();

  const current = await prisma.dataImport.findFirst({
    where: { id: job.importId, organizationId: job.organizationId },
    include: {
      sourceFile: true,
      templateVersion: { select: { id: true, documentJson: true, documentHash: true } },
    },
  });
  if (!current) return { outcome: 'SKIPPED', reason: 'import not found' };
  if (current.validationRun !== job.validationRun)
    return { outcome: 'SKIPPED', reason: 'stale run' };
  if (current.status !== 'VALIDATING')
    return { outcome: 'SKIPPED', reason: `import is ${current.status}` };

  const stillCurrent = async () => {
    const found = await prisma.dataImport.count({
      where: { id: current.id, status: 'VALIDATING', validationRun: job.validationRun },
    });
    if (found === 0) throw new StaleRunError();
  };

  try {
    if (current.templateVersion.documentHash !== current.templateVersionHash) {
      throw new ValidationPreconditionError(
        'TEMPLATE_VERSION_CHANGED',
        'The template version was edited after this import was started. Start a new import for the current design.',
      );
    }
    const parsed = parseDesignDocument(current.templateVersion.documentJson);
    if (!parsed.valid) {
      throw new ValidationPreconditionError(
        'INVALID_DOCUMENT',
        'The template version is not a valid design document.',
      );
    }
    const document = parsed.document;
    if ((await computeDataSchemaHash(document.dataSchema)) !== current.dataSchemaHash) {
      throw new ValidationPreconditionError(
        'TEMPLATE_VERSION_CHANGED',
        "The template version's data schema changed after this import was started.",
      );
    }
    if (current.sourceFile.status !== 'STORED') {
      throw new SourceReadError(
        'MALFORMED_FILE',
        'The uploaded file is no longer available. Upload it again.',
      );
    }
    const sourceSettings = SourceSettingsSchema.parse(current.sourceSettings);
    const inspection = current.inspection as unknown as SourceInspection | null;
    const columns = current.columns as unknown as SourceColumn[];
    const mapping =
      current.mapping === null ? null : MappingDefinitionSchema.parse(current.mapping);
    if (!inspection || !mapping) {
      throw new ValidationPreconditionError(
        'MAPPING_INCOMPLETE',
        'The import has no inspected source or no mapping.',
      );
    }
    const mappingValidation = validateMapping(document.dataSchema, columns, mapping);
    if (!mappingValidation.complete) {
      throw new ValidationPreconditionError('MAPPING_INCOMPLETE', 'The mapping is incomplete.');
    }
    const processing = asObject(current.processing);

    // Remove earlier drafts (including a partial draft of an interrupted attempt of this run).
    await prisma.datasetVersion.deleteMany({ where: { importId: current.id, status: 'DRAFT' } });
    const draft = await prisma.datasetVersion.create({
      data: {
        organizationId: current.organizationId,
        importId: current.id,
        validationRun: job.validationRun,
        templateVersionId: current.templateVersionId,
        templateVersionHash: current.templateVersionHash,
        dataSchemaHash: current.dataSchemaHash,
        sourceFileId: current.sourceFileId,
        sourceChecksumSha256: current.sourceFile.checksumSha256,
        mappingSnapshot: canonicalMapping(mapping),
        importConfiguration: {
          sourceSettings,
          columns,
          parser: inspection.parser,
          normalizationVersion: IMPORT_NORMALIZATION_VERSION,
          mappingDefinitionVersion: MAPPING_DEFINITION_VERSION,
          limits: settings.limits,
        } as unknown as Prisma.InputJsonValue,
        mappingProfileId: current.mappingProfileId,
        mappingProfileRevision: current.mappingProfileRevision,
        createdById: current.createdById,
      },
      select: { id: true },
    });

    const totalRows = countDataRows(sourceSettings, inspection);
    await prisma.dataImport.updateMany({
      where: { id: current.id, status: 'VALIDATING', validationRun: job.validationRun },
      data: {
        progressProcessedRows: 0,
        progressTotalRows: totalRows,
        progressUpdatedAt: new Date(),
      },
    });

    const processor = createRowProcessor({
      document,
      templateVersionHash: current.templateVersionHash,
      columns,
      mapping,
      maxCellChars: settings.limits.maxCellChars,
    });
    const parser = parserFor(current.sourceFile.format);
    const input = sourceFromStorage(
      storage,
      current.sourceFile.storageKey,
      current.sourceFile.sizeBytes,
      settings.limits,
    );
    const summary = new ValidationSummaryBuilder();
    const digest = createHash('sha256');
    const firstSequenceByHash = new Map<string, number>();
    let sequence = 0;
    let valid = 0;
    let warnings = 0;
    let errors = 0;
    let blank = 0;
    let duplicates = 0;
    let batches = 0;
    let pipelineMs = 0;
    let databaseMs = 0;
    let batch: SourceRow[] = [];

    const flush = async () => {
      if (batch.length === 0) return;
      const pipelineStarted = performance.now();
      const prepared = batch.map((row) => processor.prepare(row));
      const ids = prepared.flatMap((row) => processor.imageCandidates(row));
      const lookupStarted = performance.now();
      const availability = await lookupImageAvailability(prisma, current.organizationId, ids);
      const lookupMs = performance.now() - lookupStarted;
      databaseMs += lookupMs;
      const lookup = (id: string): AssetAvailability => availability.get(id) ?? 'UNAVAILABLE';
      const records: RecordRow[] = [];
      for (const item of prepared) {
        const row: ProcessedRow = processor.finish(item, lookup);
        sequence += 1;
        const recordHash = sha256(row.recordHashPayload);
        digest.update(recordsDigestLine(recordHash));
        const firstSequence = firstSequenceByHash.get(recordHash);
        if (firstSequence === undefined) firstSequenceByHash.set(recordHash, sequence);
        else duplicates += 1;
        if (row.status === 'VALID') valid += 1;
        else if (row.status === 'WARNING') warnings += 1;
        else errors += 1;
        summary.add(row);
        records.push({
          sequence,
          row_number: row.rowNumber,
          status: row.status,
          normalized_record: row.normalizedRecord,
          record_hash: recordHash,
          resolved_input_hash:
            row.resolvedInputHashPayload === null ? null : sha256(row.resolvedInputHashPayload),
          error_count: row.errorCount,
          warning_count: row.warningCount,
          issues: row.issues,
          duplicate_of_sequence: firstSequence ?? null,
          search_text: row.searchText,
        });
      }
      pipelineMs += performance.now() - pipelineStarted - lookupMs;
      const writeStarted = performance.now();
      await stillCurrent();
      // One statement per batch: the rows travel as a single JSON parameter.
      await prisma.$executeRaw`
        INSERT INTO dataset_records (
          dataset_version_id, sequence, organization_id, row_number, status, normalized_record,
          record_hash, resolved_input_hash, error_count, warning_count, issues,
          duplicate_of_sequence, search_text
        )
        SELECT ${draft.id}::uuid, r.sequence, ${current.organizationId}::uuid, r.row_number,
          r.status::dataset_record_status, r.normalized_record, r.record_hash, r.resolved_input_hash,
          r.error_count, r.warning_count, r.issues, r.duplicate_of_sequence, r.search_text
        FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS r(
          sequence integer, row_number integer, status text, normalized_record jsonb,
          record_hash text, resolved_input_hash text, error_count integer, warning_count integer,
          issues jsonb, duplicate_of_sequence integer, search_text text
        )`;
      await prisma.dataImport.updateMany({
        where: { id: current.id, status: 'VALIDATING', validationRun: job.validationRun },
        data: { progressProcessedRows: sequence, progressUpdatedAt: new Date() },
      });
      databaseMs += performance.now() - writeStarted;
      batches += 1;
      batch = [];
      memory.sample();
    };

    for await (const row of parser.rows(input, sourceSettings, settings.limits)) {
      if (row.rowNumber <= sourceSettings.headerRow) continue;
      if (isBlankRow(row)) {
        blank += 1;
        continue;
      }
      if (sequence + batch.length >= settings.limits.maxRows) {
        throw new SourceReadError(
          'FILE_LIMIT_EXCEEDED',
          `The source has more than ${settings.limits.maxRows.toLocaleString('en-US')} data rows.`,
        );
      }
      batch.push(row);
      if (batch.length >= settings.validationBatchSize) await flush();
    }
    await flush();

    const recordsDigest = digest.digest('hex');
    const status = validatedStatus({ errorRows: errors, warningRows: warnings });
    const validationSummary = summary.build(mappingValidation, columns);
    const durationMs = Date.now() - started;
    const completed = await prisma.$transaction(async (tx) => {
      const updated = await tx.dataImport.updateMany({
        where: { id: current.id, status: 'VALIDATING', validationRun: job.validationRun },
        data: {
          status,
          validatedAt: new Date(),
          progressProcessedRows: sequence,
          progressTotalRows: sequence,
          progressUpdatedAt: new Date(),
          processing: {
            ...processing,
            normalizationVersion: IMPORT_NORMALIZATION_VERSION,
            validation: {
              run: job.validationRun,
              rows: sequence,
              batches,
              durationMs,
              rowsPerSecond: durationMs > 0 ? Math.round((sequence * 1000) / durationMs) : sequence,
              peakRssBytes: memory.peakRssBytes,
              peakHeapUsedBytes: memory.peakHeapUsedBytes,
              pipelineMs: Math.round(pipelineMs),
              databaseMs: Math.round(databaseMs),
              completedAt: new Date().toISOString(),
            },
          },
        },
      });
      if (updated.count === 0) return false;
      await tx.datasetVersion.update({
        where: { id: draft.id },
        data: {
          rowCount: sequence,
          validCount: valid,
          warningCount: warnings,
          errorCount: errors,
          blankRowCount: blank,
          duplicateRowCount: duplicates,
          recordsDigest,
          validationSummary: validationSummary as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: current.organizationId,
          actorUserId: job.requestedByUserId,
          action: 'DATA_IMPORT_VALIDATED',
          resourceType: 'DATA_IMPORT',
          resourceId: current.id,
          metadata: {
            validationRun: job.validationRun,
            templateVersionId: current.templateVersionId,
            sourceChecksumSha256: current.sourceFile.checksumSha256,
            rowCount: sequence,
            validCount: valid,
            warningCount: warnings,
            errorCount: errors,
            blankRowCount: blank,
            duplicateRowCount: duplicates,
            status,
          },
        },
      });
      return true;
    });
    if (!completed) throw new StaleRunError();
    logger.info({ importId: current.id, status, rows: sequence, durationMs }, 'import validated');
    return { outcome: 'COMPLETED', status };
  } catch (error) {
    if (error instanceof StaleRunError) {
      // The user changed the import (new run, cancelled): drop this run's partial draft.
      await prisma.datasetVersion.deleteMany({
        where: { importId: current.id, validationRun: job.validationRun, status: 'DRAFT' },
      });
      return { outcome: 'SKIPPED', reason: 'stale run' };
    }
    const failure =
      error instanceof ValidationPreconditionError
        ? { code: error.code, message: error.message, retryable: false }
        : failureOf(error);
    if (failure.retryable && deps.finalAttempt === false) throw error;
    logger.warn(
      { importId: current.id, code: failure.code, err: error },
      'import validation failed',
    );
    await markFailed(
      deps,
      current.id,
      job.organizationId,
      job.requestedByUserId,
      'VALIDATION',
      failure,
      {
        validationRun: job.validationRun,
      },
    );
    return { outcome: 'FAILED', code: failure.code };
  }
}
