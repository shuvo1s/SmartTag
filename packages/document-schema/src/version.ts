/**
 * Canonical document schema version.
 *
 * Every persisted DesignDocument carries `schemaVersion`. The value is bumped only when the
 * persisted JSON shape changes in a way that requires a migration (see `migrations/`).
 * Readers must never guess the shape of a document from its content — they dispatch on this number.
 *
 * History:
 * - 1: initial canonical model (Phase 1)
 * - 2: text objects reference an exact font file (`fontAssetId`) and declare `wrap` (Phase 2)
 * - 3: EXPRESSION bindings, per-field `validation` rules and the WARN missing-data policy (Phase 3)
 */
export const CURRENT_SCHEMA_VERSION = 3 as const;

export type CurrentSchemaVersion = typeof CURRENT_SCHEMA_VERSION;

/** Oldest schema version that the migration chain can still upgrade to the current version. */
export const MINIMUM_SUPPORTED_SCHEMA_VERSION = 1 as const;
