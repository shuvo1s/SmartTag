import type { PrismaClient } from '@smarttag/database';
import {
  cleanupDataImports,
  processInspectJob,
  processValidateJob,
  type ImportProcessingSettings,
} from '@smarttag/import-processing';
import type { ObjectStorage } from '@smarttag/object-storage';
import {
  DataCleanupJobSchema,
  ImportInspectJobSchema,
  ImportValidateJobSchema,
  JOB_NAMES,
} from '@smarttag/shared-types';
import { defineJobHandler, type JobHandler } from '../job-registry';

export interface ImportHandlerDeps {
  readonly prisma: PrismaClient;
  readonly storage: ObjectStorage;
  readonly settings: ImportProcessingSettings;
}

/**
 * Import queue handlers. The processing itself lives in @smarttag/import-processing so it is the
 * same code the API integration tests exercise. Unexpected errors are rethrown while BullMQ still
 * has attempts left; on the last attempt the import is marked FAILED (retryable) instead.
 */
export function createImportHandlers(deps: ImportHandlerDeps): JobHandler[] {
  return [
    defineJobHandler({
      name: JOB_NAMES.IMPORT_INSPECT,
      schema: ImportInspectJobSchema,
      handle: (payload, context) =>
        processInspectJob(
          { ...deps, logger: context.logger, finalAttempt: context.finalAttempt },
          payload,
        ),
    }),
    defineJobHandler({
      name: JOB_NAMES.IMPORT_VALIDATE,
      schema: ImportValidateJobSchema,
      handle: (payload, context) =>
        processValidateJob(
          { ...deps, logger: context.logger, finalAttempt: context.finalAttempt },
          payload,
        ),
    }),
    defineJobHandler({
      name: JOB_NAMES.DATA_CLEANUP,
      schema: DataCleanupJobSchema,
      handle: (_payload, context) => cleanupDataImports({ ...deps, logger: context.logger }),
    }),
  ];
}
