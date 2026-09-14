import {
  CURRENT_SCHEMA_VERSION,
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
  createSampleHangTagDocument,
} from '../src/fixtures';

const V1_SAMPLE: unknown = SAMPLE_HANG_TAG_V1_JSON;
const V1_SAMPLE_HASH = SAMPLE_HANG_TAG_V1_HASH;

type JsonRecord = Record<string, unknown>;

const SAMPLE_USED_FONT_ASSET_IDS = [
  SAMPLE_FONT_ASSET_IDS.notoSansMedium,
  SAMPLE_FONT_ASSET_IDS.notoSansSemiBold,
  SAMPLE_FONT_ASSET_IDS.notoSansBold,
  SAMPLE_FONT_ASSET_IDS.notoSansBengaliRegular,
];

function withoutV2TextKeys(document: unknown): JsonRecord {
  const copy = JSON.parse(JSON.stringify(document)) as JsonRecord;
  copy.schemaVersion = 1;
  for (const page of copy.pages as JsonRecord[]) {
    for (const object of page.objects as JsonRecord[]) {
      if (object.type === 'text') {
        delete object.fontAssetId;
        delete object.wrap;
      }
    }
  }
  return copy;
}

describe('schema v1 → v2 compatibility with real Phase 1 content', () => {
  it('still verifies the hash stored for the Phase 1 sample (stored v1 JSON is never rewritten)', async () => {
    expect((V1_SAMPLE as JsonRecord).schemaVersion).toBe(1);
    expect(await hashCanonicalJson(V1_SAMPLE)).toBe(V1_SAMPLE_HASH);
  });

  it('loads the v1 sample through migration and validates it as the current schema', () => {
    const result = parseDesignDocument(V1_SAMPLE);
    expect(result.valid).toBe(true);
    expect(result.originalSchemaVersion).toBe(1);
    expect(result.appliedMigrations).toHaveLength(1);
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

  it('the v2 sample is the v1 sample plus controlled fonts and wrap modes — nothing else changed', () => {
    const v2 = createSampleHangTagDocument();
    expect(withoutV2TextKeys(v2)).toEqual(V1_SAMPLE);
    expect(collectAssetReferencesByKind(v2).fontAssetIds).toEqual(
      [...SAMPLE_USED_FONT_ASSET_IDS].sort(),
    );
    expect(validateDesignDocument(v2)).toMatchObject({ valid: true, warnings: [] });
  });

  it('pins the hash of the v2 sample so accidental fixture changes are noticed', async () => {
    expect(await computeDocumentHash(createSampleHangTagDocument())).toBe(
      '477325dbd915fbf674474dc7a4b9c0b683d81f716ce3971cb4e82fcf717903e7',
    );
  });
});

describe('text object builder (schema v2)', () => {
  it('defaults to word wrapping and no controlled font', () => {
    const text = createTextObject({ x: 0, y: 0, width: 10, height: 10, zIndex: 0 });
    expect(text).toMatchObject({ fontAssetId: null, wrap: 'WORD', fontFamily: 'Noto Sans' });
    expect(createSampleHangTagDocument().schemaVersion).toBe(2);
  });
});
