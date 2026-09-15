import { Prisma } from '@smarttag/database';
import { ObjectNotFoundError } from '@smarttag/object-storage';
import type { ImportProcessingDeps } from './inspect';
import { SILENT_LOGGER } from './support';

export interface CleanupReport {
  /** Uploads whose bytes never reached storage completely (or whose row was never completed). */
  readonly pendingUploadsRemoved: number;
  /** Imports without activity past the retention period, now CANCELLED. */
  readonly abandonedImportsCancelled: number;
  /** INSPECTING/VALIDATING imports without progress, now FAILED (retryable). */
  readonly stalledImportsFailed: number;
  /** Draft dataset versions of cancelled or failed imports removed (with their records). */
  readonly draftVersionsRemoved: number;
  /** Source files of cancelled imports removed from storage. */
  readonly sourceFilesRemoved: number;
}

async function removeObject(deps: ImportProcessingDeps, key: string): Promise<void> {
  try {
    await deps.storage.deleteObject(key);
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) throw error;
  }
}

/**
 * Safe cleanup of import leftovers (docs/data-imports.md#storage-cleanup):
 *
 * 1. PENDING source files older than the pending window: the upload or its database record failed
 *    half-way; the object (if any) is removed and the row marked DELETED.
 * 2. Imports stuck in INSPECTING/VALIDATING without progress: FAILED, retryable.
 * 3. Imports without activity past the abandonment window (never finalized): CANCELLED.
 * 4. Cancelled imports: draft versions and records are removed, and the uploaded file too.
 *    Failed imports keep their source so the user can retry, until they are abandoned.
 *
 * Finalized dataset versions and their source files are never touched (database triggers refuse it).
 */
export async function cleanupDataImports(
  deps: ImportProcessingDeps,
  now = new Date(),
): Promise<CleanupReport> {
  const { prisma, settings } = deps;
  const logger = deps.logger ?? SILENT_LOGGER;
  let pendingUploadsRemoved = 0;
  let abandonedImportsCancelled = 0;
  let stalledImportsFailed = 0;
  let draftVersionsRemoved = 0;
  let sourceFilesRemoved = 0;

  const pendingBefore = new Date(now.getTime() - settings.pendingUploadAfterMinutes * 60_000);
  const pending = await prisma.dataSourceFile.findMany({
    where: { status: 'PENDING', createdAt: { lt: pendingBefore } },
    select: { id: true, storageKey: true },
    take: 500,
  });
  for (const file of pending) {
    await removeObject(deps, file.storageKey);
    const updated = await prisma.dataSourceFile.updateMany({
      where: { id: file.id, status: 'PENDING' },
      data: { status: 'DELETED', deletedAt: now },
    });
    pendingUploadsRemoved += updated.count;
  }

  const stalledBefore = new Date(now.getTime() - settings.stalledAfterMinutes * 60_000);
  const stalled = await prisma.dataImport.findMany({
    where: {
      status: { in: ['UPLOADED', 'INSPECTING', 'VALIDATING'] },
      OR: [
        { progressUpdatedAt: { lt: stalledBefore } },
        { progressUpdatedAt: null, updatedAt: { lt: stalledBefore } },
      ],
    },
    select: { id: true, organizationId: true, status: true, createdById: true },
    take: 500,
  });
  for (const item of stalled) {
    const stage = item.status === 'VALIDATING' ? 'VALIDATION' : 'INSPECTION';
    const updated = await prisma.dataImport.updateMany({
      where: { id: item.id, status: item.status },
      data: {
        status: 'FAILED',
        failure: {
          code: 'PROCESSING_STALLED',
          message: 'Processing stopped without finishing. Retry the import.',
          stage,
          retryable: true,
        },
      },
    });
    stalledImportsFailed += updated.count;
  }

  const abandonedBefore = new Date(now.getTime() - settings.abandonedAfterHours * 3_600_000);
  const abandoned = await prisma.dataImport.findMany({
    where: {
      status: {
        in: [
          'MAPPING_REQUIRED',
          'READY_TO_VALIDATE',
          'READY',
          'READY_WITH_WARNINGS',
          'HAS_ERRORS',
          'FAILED',
        ],
      },
      updatedAt: { lt: abandonedBefore },
    },
    select: { id: true, organizationId: true, status: true },
    take: 500,
  });
  for (const item of abandoned) {
    const updated = await prisma.dataImport.updateMany({
      where: { id: item.id, status: item.status, updatedAt: { lt: abandonedBefore } },
      data: { status: 'CANCELLED', cancelledAt: now, failure: Prisma.DbNull },
    });
    if (updated.count > 0) {
      abandonedImportsCancelled += 1;
      await prisma.auditEvent.create({
        data: {
          organizationId: item.organizationId,
          actorUserId: null,
          action: 'DATA_IMPORT_CANCELLED',
          resourceType: 'DATA_IMPORT',
          resourceId: item.id,
          metadata: { reason: 'ABANDONED', previousStatus: item.status },
        },
      });
    }
  }

  const cancelled = await prisma.dataImport.findMany({
    where: {
      status: 'CANCELLED',
      OR: [
        { datasetVersions: { some: { status: 'DRAFT' } } },
        { sourceFile: { status: { not: 'DELETED' } } },
      ],
    },
    select: { id: true, sourceFile: { select: { id: true, storageKey: true, status: true } } },
    take: 200,
  });
  for (const item of cancelled) {
    const removed = await prisma.datasetVersion.deleteMany({
      where: { importId: item.id, status: 'DRAFT' },
    });
    draftVersionsRemoved += removed.count;
    if (item.sourceFile.status !== 'DELETED') {
      const finalizedUse = await prisma.datasetVersion.count({
        where: { sourceFileId: item.sourceFile.id, status: 'FINALIZED' },
      });
      if (finalizedUse === 0) {
        await removeObject(deps, item.sourceFile.storageKey);
        await prisma.dataSourceFile.updateMany({
          where: { id: item.sourceFile.id, status: { not: 'DELETED' } },
          data: { status: 'DELETED', deletedAt: now },
        });
        sourceFilesRemoved += 1;
      }
    }
  }

  const report = {
    pendingUploadsRemoved,
    abandonedImportsCancelled,
    stalledImportsFailed,
    draftVersionsRemoved,
    sourceFilesRemoved,
  };
  logger.info(report, 'data import cleanup finished');
  return report;
}
