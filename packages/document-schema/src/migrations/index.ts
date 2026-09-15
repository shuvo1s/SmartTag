import {
  validateDesignDocument,
  type DocumentValidationResult,
} from '../validation/validate-design-document';
import { CURRENT_SCHEMA_VERSION, MINIMUM_SUPPORTED_SCHEMA_VERSION } from '../version';
import { createDocumentMigrator, type DocumentMigration } from './migrator';
import { migrateV1ToV2 } from './v1-to-v2';
import { migrateV2ToV3 } from './v2-to-v3';

export * from './migrator';
export { migrateV1ToV2 } from './v1-to-v2';
export { migrateV2ToV3 } from './v2-to-v3';

/**
 * Registry of production migrations, ordered by `fromVersion`.
 *
 * When introducing schema version N+1:
 *   1. bump CURRENT_SCHEMA_VERSION (DesignDocumentSchema uses it as a literal)
 *   2. add `vN-to-vN+1.ts` exporting a DocumentMigration and register it here
 *   3. add fixture tests: a real vN document migrates and validates as vN+1
 */
export const DOCUMENT_MIGRATIONS: readonly DocumentMigration[] = [migrateV1ToV2, migrateV2ToV3];

const migrator = createDocumentMigrator({
  currentVersion: CURRENT_SCHEMA_VERSION,
  minimumVersion: MINIMUM_SUPPORTED_SCHEMA_VERSION,
  migrations: DOCUMENT_MIGRATIONS,
});

export function migrateDesignDocument(input: unknown) {
  return migrator.migrate(input);
}

export type ParseDesignDocumentResult = DocumentValidationResult & {
  /** Schema version the input was stored with (before migration), or null if unreadable. */
  readonly originalSchemaVersion: number | null;
  readonly appliedMigrations: readonly string[];
};

/**
 * Read path for persisted documents: upgrade to the current schema, then validate.
 * Stored TemplateVersion JSON is never rewritten by this function.
 */
export function parseDesignDocument(input: unknown): ParseDesignDocumentResult {
  const migration = migrator.migrate(input);
  if (!migration.ok) {
    return {
      valid: false,
      document: null,
      errors: [migration.issue],
      warnings: [],
      originalSchemaVersion: null,
      appliedMigrations: [],
    };
  }
  return {
    ...validateDesignDocument(migration.document),
    originalSchemaVersion: migration.fromVersion,
    appliedMigrations: migration.applied,
  };
}
