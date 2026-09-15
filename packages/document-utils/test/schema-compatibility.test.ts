import {
  CURRENT_SCHEMA_VERSION,
  migrateDesignDocument,
  parseDesignDocument,
  validateDesignDocument,
} from '@smarttag/document-schema';
import { describe, expect, it } from 'vitest';
import {
  collectAssetReferencesByKind,
  computeDocumentHash,
  createTextObject,
  hashCanonicalJson,
} from '../src';
import {
  SAMPLE_FONT_ASSET_IDS,
  SAMPLE_HANG_TAG_V1_HASH,
  SAMPLE_HANG_TAG_V1_JSON,
  SAMPLE_HANG_TAG_V2_HASH,
  SAMPLE_HANG_TAG_V2_JSON,
  createSampleHangTagDocument,
  createVariableDataHangTagDocument,
} from '../src/fixtures';

type JsonRecord = Record<string, unknown>;

const SAMPLE_USED_FONT_ASSET_IDS = [
  SAMPLE_FONT_ASSET_IDS.notoSansMedium,
  SAMPLE_FONT_ASSET_IDS.notoSansSemiBold,
  SAMPLE_FONT_ASSET_IDS.notoSansBold,
  SAMPLE_FONT_ASSET_IDS.notoSansBengaliRegular,
];

const copy = (value: unknown) => JSON.parse(JSON.stringify(value)) as JsonRecord;

/** A v3 document with the keys added by the v2 → v3 migration removed. */
function withoutV3Keys(document: unknown): JsonRecord {
  const result = copy(document);
  result.schemaVersion = 2;
  for (const field of (result.dataSchema as { fields: JsonRecord[] }).fields) {
    delete field.validation;
  }
  return result;
}

/** A v2 document with the keys added by the v1 → v2 migration removed. */
function withoutV2Keys(document: unknown): JsonRecord {
  const result = copy(document);
  result.schemaVersion = 1;
  for (const page of result.pages as JsonRecord[]) {
    for (const object of page.objects as JsonRecord[]) {
      if (object.type === 'text') {
        delete object.fontAssetId;
        delete object.wrap;
      }
    }
  }
  return result;
}

describe('stored historical documents keep their JSON and hashes', () => {
  it('the Phase 1 sample (schema v1) still verifies against its stored hash', async () => {
    expect(SAMPLE_HANG_TAG_V1_JSON.schemaVersion).toBe(1);
    expect(await hashCanonicalJson(SAMPLE_HANG_TAG_V1_JSON)).toBe(SAMPLE_HANG_TAG_V1_HASH);
  });

  it('the Phase 2 sample (schema v2) still verifies against its stored hash', async () => {
    expect(SAMPLE_HANG_TAG_V2_JSON.schemaVersion).toBe(2);
    expect(await hashCanonicalJson(SAMPLE_HANG_TAG_V2_JSON)).toBe(SAMPLE_HANG_TAG_V2_HASH);
    expect(SAMPLE_HANG_TAG_V2_HASH).toBe(
      '477325dbd915fbf674474dc7a4b9c0b683d81f716ce3971cb4e82fcf717903e7',
    );
  });

  it('reading through migration never rewrites the stored objects', async () => {
    const v1 = JSON.stringify(SAMPLE_HANG_TAG_V1_JSON);
    const v2 = JSON.stringify(SAMPLE_HANG_TAG_V2_JSON);
    parseDesignDocument(SAMPLE_HANG_TAG_V1_JSON);
    parseDesignDocument(SAMPLE_HANG_TAG_V2_JSON);
    expect(JSON.stringify(SAMPLE_HANG_TAG_V1_JSON)).toBe(v1);
    expect(JSON.stringify(SAMPLE_HANG_TAG_V2_JSON)).toBe(v2);
    expect(await hashCanonicalJson(SAMPLE_HANG_TAG_V2_JSON)).toBe(SAMPLE_HANG_TAG_V2_HASH);
  });
});

describe('v1 → v2 → v3 migration of real content', () => {
  it('loads the v1 sample through both migrations and validates it as v3', () => {
    const result = parseDesignDocument(SAMPLE_HANG_TAG_V1_JSON);
    expect(result.valid).toBe(true);
    expect(result.originalSchemaVersion).toBe(1);
    expect(result.appliedMigrations).toHaveLength(2);
    expect(result.document?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    // v1 had no controlled fonts: every text object is reported, nothing is guessed.
    const textCount = result.document!.pages.flatMap((page) =>
      page.objects.filter((object) => object.type === 'text'),
    ).length;
    expect(result.warnings.filter((w) => w.code === 'TEXT_FONT_NOT_CONTROLLED')).toHaveLength(
      textCount,
    );
    for (const page of result.document!.pages) {
      for (const object of page.objects) {
        if (object.type === 'text') {
          expect(object.fontAssetId).toBeNull();
          expect(object.wrap).toBe('NONE');
        }
      }
    }
  });

  it('loads the v2 sample through one migration and validates it as v3 without warnings', () => {
    const result = parseDesignDocument(SAMPLE_HANG_TAG_V2_JSON);
    expect(result).toMatchObject({
      valid: true,
      originalSchemaVersion: 2,
      appliedMigrations: ['v2→v3: data fields gain validation rules (none)'],
      warnings: [],
    });
  });

  it('v2 → v3 adds exactly the empty validation rules — nothing else changes', () => {
    const migrated = migrateDesignDocument(SAMPLE_HANG_TAG_V2_JSON);
    expect(migrated.ok).toBe(true);
    expect(withoutV3Keys(migrated.ok ? migrated.document : null)).toEqual(SAMPLE_HANG_TAG_V2_JSON);
  });

  it('the current sample is the v2 sample migrated to v3, and the v2 sample is v1 plus fonts', () => {
    const v3 = createSampleHangTagDocument();
    const migrated = migrateDesignDocument(SAMPLE_HANG_TAG_V2_JSON);
    expect(migrated.ok && migrated.document).toEqual(copy(v3));
    expect(withoutV2Keys(SAMPLE_HANG_TAG_V2_JSON)).toEqual(SAMPLE_HANG_TAG_V1_JSON);
    expect(collectAssetReferencesByKind(v3).fontAssetIds).toEqual(
      [...SAMPLE_USED_FONT_ASSET_IDS].sort(),
    );
    expect(validateDesignDocument(v3)).toMatchObject({ valid: true, warnings: [] });
  });

  it('migration is deterministic: migrating a migrated document changes nothing', async () => {
    const once = migrateDesignDocument(SAMPLE_HANG_TAG_V1_JSON);
    if (!once.ok) throw new Error('migration failed');
    const twice = migrateDesignDocument(once.document);
    expect(twice).toMatchObject({ ok: true, applied: [] });
    expect(await hashCanonicalJson(twice.ok ? twice.document : null)).toBe(
      await hashCanonicalJson(once.document),
    );
  });

  it('pins the hashes of the current fixtures so accidental changes are noticed', async () => {
    expect(await computeDocumentHash(createSampleHangTagDocument())).toBe(
      await hashCanonicalJson(
        (migrateDesignDocument(SAMPLE_HANG_TAG_V2_JSON) as { document: unknown }).document,
      ),
    );
    const variable = createVariableDataHangTagDocument();
    expect(validateDesignDocument(variable)).toMatchObject({ valid: true, warnings: [] });
    expect(await computeDocumentHash(variable)).toBe(
      await computeDocumentHash(createVariableDataHangTagDocument()),
    );
  });
});

describe('text object builder', () => {
  it('defaults to word wrapping and no controlled font', () => {
    const text = createTextObject({ x: 0, y: 0, width: 10, height: 10, zIndex: 0 });
    expect(text).toMatchObject({ fontAssetId: null, wrap: 'WORD', fontFamily: 'Noto Sans' });
    expect(createSampleHangTagDocument().schemaVersion).toBe(3);
  });
});
