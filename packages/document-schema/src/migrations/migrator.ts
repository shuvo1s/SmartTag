import type { DocumentValidationIssue } from '../validation/issues';
import { isPlainObject } from '../validation/validate-design-document';

export type JsonObject = Record<string, unknown>;

/**
 * A pure, single-step upgrade of persisted document JSON from `fromVersion` to `fromVersion + 1`.
 *
 * Rules for authors (see docs/canonical-document-schema.md#schema-migrations):
 * - operate on plain JSON, never on typed objects of the *current* schema
 * - never drop information silently; move it or fail loudly
 * - fill new required keys with explicit values
 * - set `schemaVersion` to `toVersion`
 * - each migration ships with a fixture-based test (vN fixture in → vN+1 fixture out)
 */
export interface DocumentMigration {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly description: string;
  migrate(document: JsonObject): JsonObject;
}

export type DocumentMigrationResult =
  | {
      readonly ok: true;
      readonly document: JsonObject;
      readonly fromVersion: number;
      readonly toVersion: number;
      readonly applied: readonly string[];
    }
  | { readonly ok: false; readonly issue: DocumentValidationIssue };

export interface DocumentMigrator {
  readonly currentVersion: number;
  migrate(input: unknown): DocumentMigrationResult;
}

export interface DocumentMigratorOptions {
  readonly currentVersion: number;
  readonly minimumVersion: number;
  readonly migrations: readonly DocumentMigration[];
}

/**
 * Builds a migrator from a registry of single-step migrations. The registry is verified eagerly:
 * every step from `minimumVersion` to `currentVersion` must exist exactly once.
 */
export function createDocumentMigrator(options: DocumentMigratorOptions): DocumentMigrator {
  const { currentVersion, minimumVersion, migrations } = options;
  const byFromVersion = new Map<number, DocumentMigration>();

  for (const migration of migrations) {
    if (migration.toVersion !== migration.fromVersion + 1) {
      throw new Error(`Migration "${migration.description}" must upgrade exactly one version`);
    }
    if (byFromVersion.has(migration.fromVersion)) {
      throw new Error(`Duplicate migration from schema version ${migration.fromVersion}`);
    }
    byFromVersion.set(migration.fromVersion, migration);
  }
  for (let version = minimumVersion; version < currentVersion; version += 1) {
    if (!byFromVersion.has(version)) {
      throw new Error(`Missing migration from schema version ${version} to ${version + 1}`);
    }
  }

  return {
    currentVersion,
    migrate(input: unknown): DocumentMigrationResult {
      if (
        !isPlainObject(input) ||
        typeof input.schemaVersion !== 'number' ||
        !Number.isInteger(input.schemaVersion)
      ) {
        return failure(
          'INVALID_STRUCTURE',
          'Design document must be an object with an integer schemaVersion',
        );
      }
      const fromVersion = input.schemaVersion;
      if (fromVersion > currentVersion || fromVersion < minimumVersion) {
        return failure(
          'UNSUPPORTED_SCHEMA_VERSION',
          `Schema version ${fromVersion} is not supported (supported: ${minimumVersion}–${currentVersion})`,
        );
      }

      // Migrations must never mutate the caller's (possibly persisted) object.
      let document = JSON.parse(JSON.stringify(input)) as JsonObject;
      const applied: string[] = [];
      for (let version = fromVersion; version < currentVersion; version += 1) {
        const migration = byFromVersion.get(version);
        if (!migration) {
          return failure(
            'UNSUPPORTED_SCHEMA_VERSION',
            `No migration from schema version ${version}`,
          );
        }
        document = migration.migrate(document);
        if (document.schemaVersion !== migration.toVersion) {
          throw new Error(
            `Migration "${migration.description}" did not set schemaVersion to ${migration.toVersion}`,
          );
        }
        applied.push(migration.description);
      }
      return { ok: true, document, fromVersion, toVersion: currentVersion, applied };
    },
  };
}

function failure(
  code: 'INVALID_STRUCTURE' | 'UNSUPPORTED_SCHEMA_VERSION',
  message: string,
): DocumentMigrationResult {
  return { ok: false, issue: { code, severity: 'error', path: ['schemaVersion'], message } };
}
