import { envInteger, parseEnvironment, type EnvironmentSource } from '@smarttag/config';
import {
  DEFAULT_PRODUCTION_LIMITS,
  PRODUCTION_LIMIT_BOUNDS,
  type ProductionLimits,
} from '@smarttag/production-core';
import { z } from 'zod';

/** Environment variable for each production limit (docs/production-jobs.md#limits). */
export const PRODUCTION_LIMIT_VARIABLES: Readonly<Record<keyof ProductionLimits, string>> = {
  maxQuantityPerRecord: 'PRODUCTION_MAX_QUANTITY_PER_RECORD',
  maxInstancesPerJob: 'PRODUCTION_MAX_INSTANCES_PER_JOB',
  maxSelectedRecords: 'PRODUCTION_MAX_SELECTED_RECORDS',
  expansionBatchSize: 'PRODUCTION_EXPANSION_BATCH_SIZE',
  recordBatchSize: 'PRODUCTION_RECORD_BATCH_SIZE',
  serialPreviewCount: 'PRODUCTION_SERIAL_PREVIEW_COUNT',
};

export interface ProductionProcessingSettings {
  readonly limits: ProductionLimits;
}

const shape = Object.fromEntries(
  (Object.keys(PRODUCTION_LIMIT_VARIABLES) as (keyof ProductionLimits)[]).map((key) => [
    PRODUCTION_LIMIT_VARIABLES[key],
    envInteger(DEFAULT_PRODUCTION_LIMITS[key], PRODUCTION_LIMIT_BOUNDS[key]),
  ]),
) as Record<string, ReturnType<typeof envInteger>>;

const ProductionEnvSchema = z.object(shape);

/** Validated production settings from the environment; defaults apply to unset variables. */
export function loadProductionSettings(source: EnvironmentSource): ProductionProcessingSettings {
  const env = parseEnvironment(ProductionEnvSchema, source) as Record<string, number>;
  const limits = Object.fromEntries(
    (Object.keys(PRODUCTION_LIMIT_VARIABLES) as (keyof ProductionLimits)[]).map((key) => [
      key,
      env[PRODUCTION_LIMIT_VARIABLES[key]]!,
    ]),
  ) as unknown as ProductionLimits;
  return { limits };
}
