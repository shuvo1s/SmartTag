import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  DesignDocumentValidationError,
  assertValidDesignDocument,
  validateDesignDocument,
  type DocumentIssueCode,
} from '../src';
import { barcodeObject, imageObject, minimalDocument, objectsOf, textObject } from './fixtures';

function errorCodes(input: unknown): DocumentIssueCode[] {
  const result = validateDesignDocument(input);
  return result.errors.map((issue) => issue.code);
}

describe('validateDesignDocument — envelope & schema version', () => {
  it('accepts a structurally and semantically valid document', () => {
    const result = validateDesignDocument(minimalDocument());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.document?.pages).toHaveLength(2);
  });

  it('requires migration for documents stored with an older schema version', () => {
    expect(errorCodes({ ...minimalDocument(), schemaVersion: 1 })).toEqual([
      'SCHEMA_MIGRATION_REQUIRED',
    ]);
  });

  it('requires fontAssetId and wrap on text objects and warns when no controlled font is set', () => {
    const missing = minimalDocument();
    const text = objectsOf(missing)[0]!;
    delete text.fontAssetId;
    expect(errorCodes(missing)).toEqual(['INVALID_STRUCTURE']);

    const badWrap = minimalDocument();
    objectsOf(badWrap)[0]!.wrap = 'CHARACTER';
    expect(errorCodes(badWrap)).toEqual(['INVALID_STRUCTURE']);

    const uncontrolled = minimalDocument();
    objectsOf(uncontrolled)[0]!.fontAssetId = null;
    const result = validateDesignDocument(uncontrolled);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'TEXT_FONT_NOT_CONTROLLED',
        path: ['pages', 0, 'objects', 0, 'fontAssetId'],
      }),
    ]);
  });

  it.each([null, 42, 'doc', [], undefined])('rejects non-object input %p', (input) => {
    expect(errorCodes(input)).toEqual(['INVALID_STRUCTURE']);
  });

  it('rejects a missing or non-integer schemaVersion', () => {
    const doc = minimalDocument();
    delete doc.schemaVersion;
    expect(errorCodes(doc)).toEqual(['INVALID_STRUCTURE']);
    expect(errorCodes({ ...minimalDocument(), schemaVersion: 1.5 })).toEqual(['INVALID_STRUCTURE']);
  });

  it('rejects documents from a newer schema version', () => {
    const result = validateDesignDocument({
      ...minimalDocument(),
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      path: ['schemaVersion'],
    });
  });
});

describe('validateDesignDocument — structure', () => {
  it('rejects unknown properties instead of silently dropping them', () => {
    const result = validateDesignDocument({ ...minimalDocument(), fabricCanvas: { objects: [] } });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: 'INVALID_STRUCTURE' });
    expect(result.errors[0]!.message).toContain('fabricCanvas');
  });

  it('reports unsupported artwork object types precisely', () => {
    const doc = minimalDocument();
    objectsOf(doc).push({ ...textObject({ id: 'weird', zIndex: 9 }), type: 'hologram' });
    const result = validateDesignDocument(doc);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'UNSUPPORTED_OBJECT_TYPE',
        path: ['pages', 0, 'objects', 2, 'type'],
      }),
    ]);
  });

  it('requires at least one page', () => {
    expect(errorCodes({ ...minimalDocument(), pages: [] })).toContain('INVALID_STRUCTURE');
  });

  it.each([
    ['zero width', { width: 0 }],
    ['negative height', { height: -10 }],
    ['non-finite width', { width: Number.POSITIVE_INFINITY }],
    ['absurdly large width', { width: 1_000_000 }],
    ['pixel unit', { displayUnit: 'px' }],
  ])('rejects invalid dimensions: %s', (_label, patch) => {
    const doc = minimalDocument();
    doc.dimensions = { ...(doc.dimensions as object), ...patch };
    expect(errorCodes(doc)).toContain('INVALID_STRUCTURE');
  });

  it('rejects invalid element ids', () => {
    const doc = minimalDocument();
    objectsOf(doc)[0] = textObject({ id: 'has spaces!' });
    expect(errorCodes(doc)).toContain('INVALID_STRUCTURE');
  });

  it('requires canonical upper-case hex colors', () => {
    const doc = minimalDocument();
    objectsOf(doc)[0] = textObject({ textColor: { space: 'RGB', hex: '#1f2933' } });
    expect(errorCodes(doc)).toContain('INVALID_STRUCTURE');
  });

  it('never accepts embedded image data in place of an asset reference', () => {
    const doc = minimalDocument();
    objectsOf(doc).push(imageObject({ assetId: 'data:image/png;base64,iVBORw0KGgo=' }));
    expect(errorCodes(doc)).toContain('INVALID_STRUCTURE');
  });

  it('rejects out-of-range property values', () => {
    const doc = minimalDocument();
    objectsOf(doc)[0] = textObject({ opacity: 1.5, rotation: 360, fontWeight: 450 });
    const paths = validateDesignDocument(doc).errors.map((issue) => issue.path.at(-1));
    expect(paths).toEqual(expect.arrayContaining(['opacity', 'rotation', 'fontWeight']));
  });

  it('rejects placeholder-string bindings that are not formal binding objects', () => {
    const doc = minimalDocument();
    objectsOf(doc)[0] = textObject({
      bindings: { content: '{{product_name}}', visible: { mode: 'STATIC' } },
    });
    expect(errorCodes(doc)).toContain('INVALID_STRUCTURE');
  });

  it('accepts multilingual Unicode content (Bengali, Arabic, CJK, emoji)', () => {
    const doc = minimalDocument();
    objectsOf(doc)[0] = textObject({
      content: 'বাংলাদেশে তৈরি\nصنع في بنغلاديش\n孟加拉国制造 ✂️',
      direction: 'AUTO',
      language: 'bn',
      bindings: { content: { mode: 'STATIC' }, visible: { mode: 'STATIC' } },
    });
    expect(validateDesignDocument(doc).valid).toBe(true);
  });
});

describe('validateDesignDocument — referential integrity', () => {
  it('rejects duplicate element ids across pages', () => {
    const doc = minimalDocument();
    objectsOf(doc, 1).push(textObject({ zIndex: 0, groupId: null }));
    const result = validateDesignDocument(doc);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'DUPLICATE_ID', path: ['pages', 1, 'objects', 0, 'id'] }),
    ]);
  });

  it('rejects ids shared between a page and an object', () => {
    const doc = minimalDocument();
    objectsOf(doc)[0] = textObject({ id: 'page-back' });
    expect(errorCodes(doc)).toContain('DUPLICATE_ID');
  });

  it('rejects duplicate zIndex values on one page', () => {
    const doc = minimalDocument();
    objectsOf(doc)[1] = barcodeObject({ zIndex: 1 });
    expect(errorCodes(doc)).toEqual(['DUPLICATE_Z_INDEX']);
  });

  it('rejects references to groups that do not exist on the page', () => {
    const doc = minimalDocument();
    objectsOf(doc)[1] = barcodeObject({ groupId: 'grp-missing' });
    expect(errorCodes(doc)).toEqual(['UNKNOWN_GROUP_REFERENCE']);
  });

  it('rejects duplicate data field keys', () => {
    const doc = minimalDocument();
    const fields = (doc.dataSchema as { fields: unknown[] }).fields;
    fields.push({ ...(fields[0] as object), displayName: 'Duplicate' });
    expect(errorCodes(doc)).toEqual(['DUPLICATE_FIELD_KEY']);
  });

  it('rejects bindings to undefined data fields', () => {
    const doc = minimalDocument();
    objectsOf(doc)[0] = textObject({
      bindings: { content: { mode: 'FIELD', field: 'productname' }, visible: { mode: 'STATIC' } },
    });
    const result = validateDesignDocument(doc);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'UNKNOWN_BINDING_FIELD',
        path: ['pages', 0, 'objects', 0, 'bindings', 'content', 'field'],
      }),
    ]);
  });

  it('rejects bindings whose field type is incompatible with the property', () => {
    const doc = minimalDocument();
    objectsOf(doc)[0] = textObject({
      bindings: {
        content: { mode: 'FIELD', field: 'logo' },
        visible: { mode: 'FIELD', field: 'product_name' },
      },
    });
    expect(errorCodes(doc)).toEqual(['INCOMPATIBLE_BINDING', 'INCOMPATIBLE_BINDING']);
  });

  it('accepts compatible image and visibility bindings', () => {
    const doc = minimalDocument();
    objectsOf(doc).push(
      imageObject({
        assetId: null,
        bindings: {
          assetId: { mode: 'FIELD', field: 'logo' },
          visible: { mode: 'FIELD', field: 'show_badge' },
        },
      }),
    );
    const result = validateDesignDocument(doc);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('accepts bindings to production system fields, which no data schema may define', () => {
    const doc = minimalDocument();
    objectsOf(doc)[0] = textObject({
      bindings: {
        content: { mode: 'EXPRESSION', expression: 'concat("SERIAL: ", __serial)' },
        visible: { mode: 'STATIC' },
      },
    });
    objectsOf(doc).push(
      barcodeObject({
        id: 'bc-serial',
        zIndex: 9,
        bindings: { value: { mode: 'FIELD', field: '__serial' }, visible: { mode: 'STATIC' } },
      }),
    );
    const result = validateDesignDocument(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects system field keys that do not exist and refuses them in a data schema', () => {
    const doc = minimalDocument();
    objectsOf(doc)[0] = textObject({
      bindings: { content: { mode: 'FIELD', field: '__made_up' }, visible: { mode: 'STATIC' } },
    });
    expect(errorCodes(doc)).toContain('INVALID_STRUCTURE');

    const withSystemField = minimalDocument();
    const fields = (withSystemField.dataSchema as { fields: Record<string, unknown>[] }).fields;
    fields.push({ ...fields[0]!, key: '__serial', displayName: 'Serial' });
    expect(errorCodes(withSystemField)).toContain('INVALID_STRUCTURE');
  });

  it('type-checks system fields like any other field', () => {
    const doc = minimalDocument();
    objectsOf(doc)[0] = textObject({
      // __instance_index is a number; visibility needs a boolean.
      bindings: {
        content: { mode: 'STATIC' },
        visible: { mode: 'FIELD', field: '__instance_index' },
      },
    });
    expect(errorCodes(doc)).toEqual(['INCOMPATIBLE_BINDING']);
  });

  it('requires field keys in bindings to be well-formed', () => {
    const doc = minimalDocument();
    objectsOf(doc)[0] = textObject({
      bindings: { content: { mode: 'FIELD', field: 'Product Name' }, visible: { mode: 'STATIC' } },
    });
    expect(errorCodes(doc)).toContain('INVALID_STRUCTURE');
  });
});

describe('validateDesignDocument — geometry & semantics', () => {
  it('rejects an orientation that contradicts width and height', () => {
    const doc = minimalDocument();
    doc.dimensions = { ...(doc.dimensions as object), orientation: 'LANDSCAPE' };
    expect(errorCodes(doc)).toEqual(['INVALID_GEOMETRY']);
  });

  it('rejects a safe area that leaves no usable space', () => {
    const doc = minimalDocument();
    const big = 100;
    doc.dimensions = {
      ...(doc.dimensions as object),
      safeArea: { top: 10, right: big, bottom: 10, left: big },
    };
    expect(errorCodes(doc)).toEqual(['INVALID_GEOMETRY']);
  });

  it('rejects punch holes outside the trim box', () => {
    const doc = minimalDocument();
    const dims = doc.dimensions as { dieline: { features: Record<string, unknown>[] } };
    dims.dieline.features[0] = { ...dims.dieline.features[0], center: { x: 1, y: 1 } };
    expect(errorCodes(doc)).toEqual(['INVALID_GEOMETRY']);
  });

  it('rejects a bar height taller than the barcode frame', () => {
    const doc = minimalDocument();
    objectsOf(doc)[1] = barcodeObject({ barHeight: 500 });
    expect(errorCodes(doc)).toEqual(['INVALID_GEOMETRY']);
  });

  it('rejects crops that extend beyond the source image', () => {
    const doc = minimalDocument();
    objectsOf(doc).push(imageObject({ crop: { x: 0.5, y: 0, width: 0.75, height: 1 } }));
    expect(errorCodes(doc)).toEqual(['INVALID_GEOMETRY']);
  });

  it('rejects a shrink-to-fit minimum above the font size', () => {
    const doc = minimalDocument();
    objectsOf(doc)[0] = textObject({ overflow: { mode: 'SHRINK_TO_FIT', minFontSize: 20 } });
    expect(errorCodes(doc)).toEqual(['INVALID_PROPERTY']);
  });

  it('warns (but accepts) when an object lies entirely outside the bleed box', () => {
    const doc = minimalDocument();
    objectsOf(doc)[1] = barcodeObject({ x: 1000 });
    const result = validateDesignDocument(doc);
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(['OBJECT_OUTSIDE_BLEED']);
  });

  it('considers rotation when deciding whether an object reaches the bleed box', () => {
    // Bleed box bottom edge is ≈263.6 pt. A 200×20 pt bar centred 30 pt below it is off the tag…
    const bar = { x: -30, y: 283.6, width: 200, height: 20, barHeight: 10 };
    const unrotated = minimalDocument();
    objectsOf(unrotated)[1] = barcodeObject({ ...bar, rotation: 0 });
    expect(validateDesignDocument(unrotated).warnings.map((w) => w.code)).toEqual([
      'OBJECT_OUTSIDE_BLEED',
    ]);

    // …but rotated 90° about its centre it extends 100 pt upward, back onto the tag.
    const rotated = minimalDocument();
    objectsOf(rotated)[1] = barcodeObject({ ...bar, rotation: 90 });
    expect(validateDesignDocument(rotated).warnings).toEqual([]);
  });

  it('warns about images with neither an asset nor a binding', () => {
    const doc = minimalDocument();
    objectsOf(doc).push(imageObject({ assetId: null }));
    expect(validateDesignDocument(doc).warnings.map((w) => w.code)).toEqual([
      'IMAGE_SOURCE_MISSING',
    ]);
  });
});

describe('assertValidDesignDocument', () => {
  it('returns the typed document when valid', () => {
    expect(assertValidDesignDocument(minimalDocument()).metadata.documentType).toBe('HANG_TAG');
  });

  it('throws a descriptive error when invalid', () => {
    expect(() => assertValidDesignDocument({ schemaVersion: 1 })).toThrow(
      DesignDocumentValidationError,
    );
  });
});
