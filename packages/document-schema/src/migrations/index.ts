import { validateDesignDocument, type DocumentValidationResult } from '../validation/validate-design-document';
import { CURRENT_SCHEMA_VERSION, MINIMUM_SUPPORTED_SCHEMA_VERSION } from '../version';
import { createDocumentMigrator, type DocumentMigration } from './migrator';

export * from './migrator';

/**
 * Registry of production migrations, ordered by `fromVersion`.
 * Schema version 1 is the first published version, so the registry is empty.
 *
 * When introducing schema version 2:
 *   1. bump CURRENT_SCHEMA_VERSION and change `z.literal(...)` in DesignDocumentSchema
 *   2. add `v1-to-v2.ts` exporting a DocumentMigration and register it here
 *   3. add fixture tests: a real v1 document migrates and validates as v2
 */
export const DOCUMENT_MIGRATIONS: readonly DocumentMigration[] = [];

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
