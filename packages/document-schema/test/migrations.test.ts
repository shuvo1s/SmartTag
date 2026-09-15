import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  DOCUMENT_MIGRATIONS,
  createDocumentMigrator,
  migrateDesignDocument,
  migrateV1ToV2,
  migrateV2ToV3,
  parseDesignDocument,
  type DocumentMigration,
} from '../src';
import { minimalDocument, minimalDocumentV1, minimalDocumentV2, objectsOf } from './fixtures';

const v1ToV2: DocumentMigration = {
  fromVersion: 1,
  toVersion: 2,
  description: 'v1→v2: rename settings.missingDataPolicy to settings.onMissingData',
  migrate: (doc) => {
    const { missingDataPolicy, ...settings } = doc.settings as Record<string, unknown>;
    return {
      ...doc,
      schemaVersion: 2,
      settings: { ...settings, onMissingData: missingDataPolicy },
    };
  },
};

const v2ToV3: DocumentMigration = {
  fromVersion: 2,
  toVersion: 3,
  description: 'v2→v3: add metadata.revisionNote',
  migrate: (doc) => ({
    ...doc,
    schemaVersion: 3,
    metadata: { ...(doc.metadata as object), revisionNote: null },
  }),
};

describe('createDocumentMigrator', () => {
  const migrator = createDocumentMigrator({
    currentVersion: 3,
    minimumVersion: 1,
    migrations: [v2ToV3, v1ToV2],
  });

  it('applies single-step migrations in order until the current version', () => {
    const result = migrator.migrate(minimalDocumentV1());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(3);
    expect(result.applied).toEqual([v1ToV2.description, v2ToV3.description]);
    expect(result.document.schemaVersion).toBe(3);
    expect(result.document.settings).toEqual({ onMissingData: 'FAIL' });
    expect((result.document.metadata as Record<string, unknown>).revisionNote).toBeNull();
  });

  it('starts from the stored version and skips already-applied steps', () => {
    const result = migrator.migrate({ ...minimalDocumentV1(), schemaVersion: 2 });
    expect(result.ok && result.applied).toEqual([v2ToV3.description]);
  });

  it('never mutates the input document', () => {
    const input = minimalDocumentV1();
    const snapshot = JSON.stringify(input);
    migrator.migrate(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('refuses documents newer than the current version', () => {
    const result = migrator.migrate({ ...minimalDocumentV1(), schemaVersion: 4 });
    expect(result).toMatchObject({ ok: false, issue: { code: 'UNSUPPORTED_SCHEMA_VERSION' } });
  });

  it('refuses input without an integer schemaVersion', () => {
    expect(migrator.migrate({ pages: [] })).toMatchObject({
      ok: false,
      issue: { code: 'INVALID_STRUCTURE' },
    });
  });

  it('verifies the registry forms a complete chain', () => {
    expect(() =>
      createDocumentMigrator({ currentVersion: 3, minimumVersion: 1, migrations: [v1ToV2] }),
    ).toThrow(/Missing migration from schema version 2/);
    expect(() =>
      createDocumentMigrator({
        currentVersion: 2,
        minimumVersion: 1,
        migrations: [v1ToV2, v1ToV2],
      }),
    ).toThrow(/Duplicate migration/);
    expect(() =>
      createDocumentMigrator({
        currentVersion: 3,
        minimumVersion: 1,
        migrations: [{ ...v1ToV2, toVersion: 3 }],
      }),
    ).toThrow(/exactly one version/);
  });

  it('detects a migration that forgets to bump schemaVersion', () => {
    const broken = createDocumentMigrator({
      currentVersion: 2,
      minimumVersion: 1,
      migrations: [{ ...v1ToV2, migrate: (doc) => doc }],
    });
    expect(() => broken.migrate(minimalDocumentV1())).toThrow(/did not set schemaVersion/);
  });
});

describe('production migration registry', () => {
  it('forms a valid chain up to the current schema version', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
    expect(DOCUMENT_MIGRATIONS.length).toBe(CURRENT_SCHEMA_VERSION - 1);
    expect(migrateDesignDocument(minimalDocument())).toMatchObject({ ok: true, applied: [] });
  });

  it('v1 → v2 adds only fontAssetId and wrap to text objects', () => {
    const v1 = minimalDocumentV1();
    const snapshot = JSON.stringify(v1);
    const migrated = migrateV1ToV2.migrate(JSON.parse(snapshot) as Record<string, unknown>);
    expect(JSON.stringify(v1)).toBe(snapshot);

    const text = objectsOf(migrated)[0]!;
    expect(text).toMatchObject({ type: 'text', fontAssetId: null, wrap: 'NONE' });
    // Removing exactly the two new keys gives back the original v1 document.
    const stripped = JSON.parse(JSON.stringify(migrated)) as Record<string, unknown>;
    stripped.schemaVersion = 1;
    for (const object of objectsOf(stripped)) {
      if (object.type === 'text') {
        delete object.fontAssetId;
        delete object.wrap;
      }
    }
    expect(stripped).toEqual(JSON.parse(snapshot));
    // Non-text objects are untouched.
    expect(objectsOf(migrated)[1]).toEqual(objectsOf(v1)[1]);
  });

  it('v2 → v3 adds only empty validation rules to data fields', () => {
    const v2 = minimalDocumentV2();
    const snapshot = JSON.stringify(v2);
    const result = migrateDesignDocument(v2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(v2)).toBe(snapshot);
    expect(result.applied).toEqual(['v2→v3: data fields gain validation rules (none)']);
    expect(result.document).toEqual(minimalDocument());

    const fields = (result.document.dataSchema as { fields: Record<string, unknown>[] }).fields;
    expect(fields.map((field) => field.validation)).toEqual([
      { minLength: null, maxLength: null, pattern: null, allowedValues: null },
      { minLength: null, maxLength: null, pattern: null, allowedValues: null },
      {},
      {},
    ]);
  });

  it('v2 → v3 gives every field type its rule keys and keeps unknown shapes for validation', () => {
    const migrated = migrateV2ToV3.migrate({
      schemaVersion: 2,
      dataSchema: {
        fields: [
          { key: 'n', type: 'number' },
          { key: 'd', type: 'decimal' },
          { key: 'b', type: 'boolean' },
          { key: 'x', type: 'mystery' },
          'not a field',
        ],
      },
    });
    expect(migrated).toEqual({
      schemaVersion: 3,
      dataSchema: {
        fields: [
          { key: 'n', type: 'number', validation: { min: null, max: null, allowedValues: null } },
          { key: 'd', type: 'decimal', validation: { min: null, max: null, allowedValues: null } },
          { key: 'b', type: 'boolean', validation: {} },
          { key: 'x', type: 'mystery' },
          'not a field',
        ],
      },
    });
    // A document without a data schema is left for validation to report.
    expect(migrateV2ToV3.migrate({ schemaVersion: 2 })).toEqual({ schemaVersion: 3 });
  });

  it('migrates a stored v1 document through v2 to v3', () => {
    const result = migrateDesignDocument(minimalDocumentV1());
    expect(result).toMatchObject({ ok: true, fromVersion: 1, toVersion: 3 });
    expect(result.ok && result.applied).toEqual([
      'v1→v2: text objects gain fontAssetId (null) and wrap (NONE)',
      'v2→v3: data fields gain validation rules (none)',
    ]);
  });

  it('a migrated v1 document validates as v3 and reports its uncontrolled fonts', () => {
    const result = parseDesignDocument(minimalDocumentV1());
    expect(result.valid).toBe(true);
    expect(result.originalSchemaVersion).toBe(1);
    expect(result.document?.schemaVersion).toBe(3);
    expect(result.warnings.map((warning) => warning.code)).toEqual(['TEXT_FONT_NOT_CONTROLLED']);
  });

  it('migration is deterministic and repeated migration causes no drift', () => {
    const once = migrateDesignDocument(minimalDocumentV1());
    const twice = once.ok ? migrateDesignDocument(once.document) : null;
    expect(twice).toMatchObject({ ok: true, applied: [] });
    expect(twice?.ok && twice.document).toEqual(once.ok && once.document);
    expect(JSON.stringify(migrateDesignDocument(minimalDocumentV2()))).toBe(
      JSON.stringify(migrateDesignDocument(minimalDocumentV2())),
    );
  });

  it('keeps current-version documents unchanged', () => {
    const current = minimalDocument();
    const result = migrateDesignDocument(current);
    expect(result).toMatchObject({ ok: true, applied: [], fromVersion: 3 });
    expect(result.ok && result.document).toEqual(current);
  });

  it('parseDesignDocument migrates then validates', () => {
    const result = parseDesignDocument(minimalDocument());
    expect(result.valid).toBe(true);
    expect(result.originalSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(parseDesignDocument({ schemaVersion: 99 }).errors[0]?.code).toBe(
      'UNSUPPORTED_SCHEMA_VERSION',
    );
  });
});
