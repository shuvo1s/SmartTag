import type { PrismaClient } from '@smarttag/database';
import type { ObjectStorage } from '@smarttag/object-storage';
import {
  processExpandJob,
  processReleaseJob,
  type ProductionProcessingSettings,
} from '@smarttag/production-processing';
import {
  JOB_NAMES,
  ProductionExpandJobSchema,
  ProductionReleaseJobSchema,
} from '@smarttag/shared-types';
import { defineJobHandler, type JobHandler } from '../job-registry';

export interface ProductionHandlerDeps {
  readonly prisma: PrismaClient;
  readonly storage: ObjectStorage;
  readonly settings: ProductionProcessingSettings;
}

/**
 * Production queue handlers. The processing itself lives in @smarttag/production-processing so it
 * is the same code the API integration tests exercise. Unexpected errors are rethrown while BullMQ
 * still has attempts left; on the last attempt the job records the failure instead.
 */
export function createProductionHandlers(deps: ProductionHandlerDeps): JobHandler[] {
  return [
    defineJobHandler({
      name: JOB_NAMES.PRODUCTION_EXPAND,
      schema: ProductionExpandJobSchema,
      handle: (payload, context) =>
        processExpandJob(
          { ...deps, logger: context.logger, finalAttempt: context.finalAttempt },
          payload,
        ),
    }),
    defineJobHandler({
      name: JOB_NAMES.PRODUCTION_RELEASE,
      schema: ProductionReleaseJobSchema,
      handle: (payload, context) =>
        processReleaseJob(
          { ...deps, logger: context.logger, finalAttempt: context.finalAttempt },
          payload,
        ),
    }),
  ];
}
