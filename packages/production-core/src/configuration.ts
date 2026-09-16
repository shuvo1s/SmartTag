import { z } from 'zod';

/**
 * How many production instances one dataset record produces.
 *
 *   ONE_PER_RECORD  exactly one tag per record (the default)
 *   FIELD           the value of one data field, read as a whole number of tags
 *
 * Phase 4 deliberately gave a `quantity` column no meaning; this configuration is where it gets
 * one, explicitly and per job.
 */
export const QUANTITY_MODES = ['ONE_PER_RECORD', 'FIELD'] as const;
export type QuantityMode = (typeof QUANTITY_MODES)[number];

export const QuantityConfigurationSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('ONE_PER_RECORD') }),
  z.strictObject({
    mode: z.literal('FIELD'),
    /** Data field key holding the number of copies. */
    field: z.string().min(1).max(100),
    /**
     * A record without a value for that field: REFUSE makes the instance invalid (the job cannot
     * be released), DEFAULT uses `defaultQuantity`.
     */
    whenMissing: z.enum(['REFUSE', 'DEFAULT']),
    defaultQuantity: z.number().int().min(1).max(10_000_000),
  }),
]);
export type QuantityConfiguration = z.infer<typeof QuantityConfigurationSchema>;

/** Serial numbers are optional; when used, they come from exactly one sequence. */
export const SerialConfigurationSchema = z.discriminatedUnion('enabled', [
  z.strictObject({ enabled: z.literal(false) }),
  z.strictObject({ enabled: z.literal(true), sequenceId: z.uuid() }),
]);
export type SerialConfiguration = z.infer<typeof SerialConfigurationSchema>;

/**
 * Which dataset records are produced. ALL is the default; an explicit selection is a stored list
 * of record sequences, never a temporary UI filter, so the same job always resolves to the same
 * records.
 */
export const RecordSelectionSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('ALL') }),
  z.strictObject({
    mode: z.literal('SEQUENCES'),
    sequences: z.array(z.number().int().min(1)).min(1).max(100_000),
  }),
]);
export type RecordSelection = z.infer<typeof RecordSelectionSchema>;

/**
 * A production job runs in one of two modes. NON_PRODUCTION exists so a job can be exercised
 * against a draft template; it is stored, shown and hashed differently and must never be mistaken
 * for released production.
 */
export const PRODUCTION_MODES = ['PRODUCTION', 'NON_PRODUCTION'] as const;
export type ProductionMode = (typeof PRODUCTION_MODES)[number];

export const PRODUCTION_CONFIGURATION_VERSION = 1 as const;

export const ProductionConfigurationSchema = z.strictObject({
  version: z.literal(PRODUCTION_CONFIGURATION_VERSION),
  quantity: QuantityConfigurationSchema,
  serial: SerialConfigurationSchema,
  recordSelection: RecordSelectionSchema,
  /** Whether warnings must be acknowledged before the job can be released. */
  warningPolicy: z.enum(['ACKNOWLEDGE', 'ALLOW']),
  productionMode: z.enum(PRODUCTION_MODES),
});
export type ProductionConfiguration = z.infer<typeof ProductionConfigurationSchema>;

export const DEFAULT_PRODUCTION_CONFIGURATION: ProductionConfiguration = {
  version: PRODUCTION_CONFIGURATION_VERSION,
  quantity: { mode: 'ONE_PER_RECORD' },
  serial: { enabled: false },
  recordSelection: { mode: 'ALL' },
  warningPolicy: 'ACKNOWLEDGE',
  productionMode: 'PRODUCTION',
};

/**
 * The configuration in a stable shape for hashing: selected record sequences sorted and
 * deduplicated, every key written by the canonical JSON writer in sorted order. Two jobs
 * configured the same way therefore hash the same way, whatever order the UI sent.
 */
export function canonicalConfiguration(
  configuration: ProductionConfiguration,
): ProductionConfiguration {
  const selection: RecordSelection =
    configuration.recordSelection.mode === 'SEQUENCES'
      ? {
          mode: 'SEQUENCES',
          sequences: [...new Set(configuration.recordSelection.sequences)].sort((a, b) => a - b),
        }
      : { mode: 'ALL' };
  return { ...configuration, recordSelection: selection };
}

/** The data field the quantity comes from, or null for ONE_PER_RECORD. */
export function quantityField(configuration: ProductionConfiguration): string | null {
  return configuration.quantity.mode === 'FIELD' ? configuration.quantity.field : null;
}
