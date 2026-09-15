import type { PrismaClient, Prisma } from '@smarttag/database';
import { parseDesignDocument } from '@smarttag/document-schema';
import {
  IMPORT_NORMALIZATION_VERSION,
  MappingDefinitionSchema,
  SourceSettingsSchema,
  buildSourceColumns,
  checkSourceSettings,
  retainMappableEntries,
  settingsAfterInspection,
  validateMapping,
  type DataImportStatus,
} from '@smarttag/import-core';
import type { ObjectStorage } from '@smarttag/object-storage';
import type { ImportInspectJob } from '@smarttag/shared-types';
import { SourceReadError, parserFor } from '@smarttag/tabular-sources';
import type { ImportProcessingSettings } from './config';
import {
  MemorySampler,
  SILENT_LOGGER,
  failureOf,
  sourceFromStorage,
  type ImportLogger,
} from './support';

export interface ImportProcessingDeps {
  readonly prisma: PrismaClient;
  readonly storage: ObjectStorage;
  readonly settings: ImportProcessingSettings;
  readonly logger?: ImportLogger;
  /** False while BullMQ will still retry a failing job; unexpected errors are then rethrown. */
  readonly finalAttempt?: boolean;
}

export type JobOutcome =
  | { readonly outcome: 'COMPLETED'; readonly status: DataImportStatus }
  | { readonly outcome: 'SKIPPED'; readonly reason: string }
  | { readonly outcome: 'FAILED'; readonly code: string };

/**
 * Inspects an uploaded source: sheets, preview rows, counts and detected settings. Idempotent: the
 * job belongs to one inspection run, and an import that moved on (new run, cancelled) is left alone.
 */
export async function processInspectJob(
  deps: ImportProcessingDeps,
  job: ImportInspectJob,
): Promise<JobOutcome> {
  const { prisma, storage, settings } = deps;
  const logger = deps.logger ?? SILENT_LOGGER;
  const started = Date.now();
  const memory = new MemorySampler();

  const current = await prisma.dataImport.findFirst({
    where: { id: job.importId, organizationId: job.organizationId },
    include: {
      sourceFile: true,
      templateVersion: { select: { documentJson: true } },
    },
  });
  if (!current) return { outcome: 'SKIPPED', reason: 'import not found' };
  if (current.inspectionRun !== job.inspectionRun)
    return { outcome: 'SKIPPED', reason: 'stale run' };
  if (current.status === 'UPLOADED') {
    const claimed = await prisma.dataImport.updateMany({
      where: { id: current.id, status: 'UPLOADED', inspectionRun: job.inspectionRun },
      data: { status: 'INSPECTING', progressUpdatedAt: new Date() },
    });
    if (claimed.count === 0) return { outcome: 'SKIPPED', reason: 'import changed' };
  } else if (current.status !== 'INSPECTING') {
    return { outcome: 'SKIPPED', reason: `import is ${current.status}` };
  }

  const sourceSettings = SourceSettingsSchema.parse(current.sourceSettings);
  try {
    if (current.sourceFile.status !== 'STORED') {
      throw new SourceReadError(
        'MALFORMED_FILE',
        'The uploaded file is no longer available. Upload it again.',
      );
    }
    const parser = parserFor(current.sourceFile.format);
    const input = sourceFromStorage(
      storage,
      current.sourceFile.storageKey,
      current.sourceFile.sizeBytes,
      settings.limits,
    );
    const inspection = await parser.inspect(input, sourceSettings, settings.limits);
    memory.sample();

    const nextSettings = settingsAfterInspection(sourceSettings, inspection);
    const problems = checkSourceSettings(nextSettings, inspection);
    const columns = problems.some((problem) => problem.code !== 'DELIMITER_REQUIRED')
      ? []
      : buildSourceColumns(nextSettings, inspection);

    let mapping = current.mapping === null ? null : MappingDefinitionSchema.parse(current.mapping);
    let status: DataImportStatus = 'MAPPING_REQUIRED';
    if (mapping) {
      mapping = retainMappableEntries(mapping, columns).mapping;
      const parsedDocument = parseDesignDocument(current.templateVersion.documentJson);
      if (parsedDocument.valid && problems.length === 0) {
        const validation = validateMapping(parsedDocument.document.dataSchema, columns, mapping);
        if (validation.complete) status = 'READY_TO_VALIDATE';
      }
    }

    const processing = asObject(current.processing);
    const updated = await prisma.dataImport.updateMany({
      where: { id: current.id, status: 'INSPECTING', inspectionRun: job.inspectionRun },
      data: {
        status,
        inspection: inspection as unknown as Prisma.InputJsonValue,
        sourceSettings: nextSettings,
        columns: columns as unknown as Prisma.InputJsonValue,
        ...(mapping ? { mapping: mapping } : {}),
        progressProcessedRows: 0,
        progressTotalRows: null,
        progressUpdatedAt: new Date(),
        processing: {
          ...processing,
          parser: inspection.parser,
          normalizationVersion: IMPORT_NORMALIZATION_VERSION,
          inspection: {
            run: job.inspectionRun,
            durationMs: Date.now() - started,
            peakRssBytes: memory.peakRssBytes,
            completedAt: new Date().toISOString(),
          },
        } as unknown as Prisma.InputJsonObject,
      },
    });
    if (updated.count === 0)
      return { outcome: 'SKIPPED', reason: 'import changed during inspection' };
    logger.info(
      { importId: current.id, status, durationMs: Date.now() - started },
      'import inspected',
    );
    return { outcome: 'COMPLETED', status };
  } catch (error) {
    const failure = failureOf(error);
    if (failure.retryable && deps.finalAttempt === false) throw error;
    logger.warn(
      { importId: current.id, code: failure.code, err: error },
      'import inspection failed',
    );
    await markFailed(
      deps,
      current.id,
      job.organizationId,
      job.requestedByUserId,
      'INSPECTION',
      failure,
      {
        inspectionRun: job.inspectionRun,
      },
    );
    return { outcome: 'FAILED', code: failure.code };
  }
}

export function asObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

/**
 * Marks the import FAILED if it is still in the processing state of the given run, and records a
 * DATA_IMPORT_FAILED audit event with aggregate information only.
 */
export async function markFailed(
  deps: ImportProcessingDeps,
  importId: string,
  organizationId: string,
  actorUserId: string,
  stage: 'INSPECTION' | 'VALIDATION',
  failure: { code: string; message: string; retryable: boolean },
  run: { inspectionRun: number } | { validationRun: number },
): Promise<void> {
  const { prisma } = deps;
  await prisma.$transaction(async (tx) => {
    const updated = await tx.dataImport.updateMany({
      where: {
        id: importId,
        organizationId,
        status: stage === 'INSPECTION' ? { in: ['UPLOADED', 'INSPECTING'] } : 'VALIDATING',
        ...run,
      },
      data: {
        status: 'FAILED',
        failure: { ...failure, stage },
        progressUpdatedAt: new Date(),
      },
    });
    if (updated.count === 0) return;
    if (stage === 'VALIDATION') {
      await tx.datasetVersion.deleteMany({ where: { importId, status: 'DRAFT' } });
    }
    await tx.auditEvent.create({
      data: {
        organizationId,
        actorUserId,
        action: 'DATA_IMPORT_FAILED',
        resourceType: 'DATA_IMPORT',
        resourceId: importId,
        metadata: { stage, code: failure.code, retryable: failure.retryable, ...run },
      },
    });
  });
}
