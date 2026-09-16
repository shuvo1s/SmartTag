import { SYSTEM_FIELD_KEYS, type DesignDocument } from '@smarttag/document-schema';
import { createVariableDataHangTagDocument } from '@smarttag/document-utils/fixtures';
import { VARIABLE_DATA_RECORD } from '@smarttag/document-utils/fixtures';
import { describe, expect, it } from 'vitest';
import { checkResolvedObjects, resolveDocumentBindings, validateDataRecord } from '../src';

/** The hang tag with its barcode value bound to the production serial number. */
function documentWithSerialBarcode(): DesignDocument {
  const document = createVariableDataHangTagDocument();
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      objects: page.objects.map((object) =>
        object.type === 'barcode'
          ? {
              ...object,
              bindings: {
                ...object.bindings,
                value: { mode: 'FIELD' as const, field: SYSTEM_FIELD_KEYS.SERIAL },
              },
            }
          : object,
      ),
    })),
  };
}

function textOf(document: DesignDocument, objectId: string): string {
  for (const page of document.pages) {
    for (const object of page.objects) {
      if (object.id === objectId && object.type === 'text') return object.content;
    }
  }
  throw new Error(`no text object ${objectId}`);
}

describe('production system fields in bindings', () => {
  const document = createVariableDataHangTagDocument();
  const RECORD = validateDataRecord(document.dataSchema, VARIABLE_DATA_RECORD).normalizedRecord;

  it('resolve from the production context, not from the record', () => {
    const withSerial: DesignDocument = {
      ...document,
      pages: document.pages.map((page) => ({
        ...page,
        objects: page.objects.map((object) =>
          object.id === 'vd-sku' && object.type === 'text'
            ? {
                ...object,
                bindings: {
                  ...object.bindings,
                  content: {
                    mode: 'EXPRESSION' as const,
                    expression: `concat("SERIAL: ", ${SYSTEM_FIELD_KEYS.SERIAL})`,
                  },
                },
              }
            : object,
        ),
      })),
    };
    const resolution = resolveDocumentBindings(withSerial, {
      normalizedRecord: RECORD,
      systemValues: { [SYSTEM_FIELD_KEYS.SERIAL]: 'YT-00001257' },
    });
    expect(resolution.issues).toEqual([]);
    expect(textOf(resolution.document, 'vd-sku')).toBe('SERIAL: YT-00001257');
  });

  it('without a production context they are pending, never "missing data"', () => {
    const resolution = resolveDocumentBindings(documentWithSerialBarcode(), {
      normalizedRecord: RECORD,
    });
    expect(resolution.issues).toEqual([]);
    const barcode = resolution.properties.find(
      (property) => property.target.property === 'value' && property.kind === 'SYMBOL_DATA',
    );
    expect(barcode?.pendingSystemFields).toEqual([SYSTEM_FIELD_KEYS.SERIAL]);
    // The empty barcode value is not checked: production has not produced it yet.
    expect(checkResolvedObjects(resolution)).toEqual([]);
  });

  it('are checked as soon as production supplies them', () => {
    const resolution = resolveDocumentBindings(documentWithSerialBarcode(), {
      normalizedRecord: RECORD,
      systemValues: { [SYSTEM_FIELD_KEYS.SERIAL]: 'YT-00001257' },
    });
    // An EAN-13 barcode cannot hold letters: the real value is now checked like any other.
    expect(checkResolvedObjects(resolution)).toMatchObject([
      { layer: 'OBJECT', code: 'BARCODE_VALUE_INVALID' },
    ]);
  });

  it('do not change how ordinary data fields behave', () => {
    const resolution = resolveDocumentBindings(document, {
      normalizedRecord: { ...RECORD, style: null },
    });
    expect(resolution.issues.map((issue) => issue.code)).toContain('MISSING_DATA_VALUE');
    expect(
      resolution.properties.every((property) => property.pendingSystemFields.length === 0),
    ).toBe(true);
  });
});
