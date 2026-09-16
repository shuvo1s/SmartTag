/**
 * Safety limits for production jobs. Configuration, never scattered constants: the API and the
 * worker load them from the same environment variables (see @smarttag/production-processing), so a
 * single row can never expand into an unbounded number of production instances.
 */
export interface ProductionLimits {
  /** Largest quantity one dataset record may request. */
  readonly maxQuantityPerRecord: number;
  /** Largest number of production instances one job may contain. */
  readonly maxInstancesPerJob: number;
  /** Largest number of dataset records one job may select explicitly. */
  readonly maxSelectedRecords: number;
  /** Instances written per database statement while expanding. */
  readonly expansionBatchSize: number;
  /** Dataset records read per batch while expanding. */
  readonly recordBatchSize: number;
  /** Serial numbers shown in a preview. */
  readonly serialPreviewCount: number;
}

export const DEFAULT_PRODUCTION_LIMITS: ProductionLimits = {
  maxQuantityPerRecord: 100_000,
  maxInstancesPerJob: 1_000_000,
  maxSelectedRecords: 100_000,
  expansionBatchSize: 1_000,
  recordBatchSize: 1_000,
  serialPreviewCount: 5,
};

export const PRODUCTION_LIMIT_BOUNDS: Readonly<
  Record<keyof ProductionLimits, { readonly min: number; readonly max: number }>
> = {
  maxQuantityPerRecord: { min: 1, max: 10_000_000 },
  maxInstancesPerJob: { min: 1, max: 50_000_000 },
  maxSelectedRecords: { min: 1, max: 1_000_000 },
  expansionBatchSize: { min: 50, max: 10_000 },
  recordBatchSize: { min: 50, max: 10_000 },
  serialPreviewCount: { min: 1, max: 50 },
};
