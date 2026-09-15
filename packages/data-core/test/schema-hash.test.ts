import type { DataSchema } from '@smarttag/document-schema';
import { createDataField } from '@smarttag/document-utils';
import { VARIABLE_DATA_FIELDS, VARIABLE_DATA_RECORD } from '@smarttag/document-utils/fixtures';
import { describe, expect, it } from 'vitest';
import {
  checkRecordAssetReferences,
  computeDataSchemaHash,
  dataSchemaContract,
  recordImageAssetIds,
  validateDataRecord,
} from '../src';

const schema: DataSchema = { fields: [...VARIABLE_DATA_FIELDS] };

describe('computeDataSchemaHash', () => {
  it('is a stable SHA-256 of the field contract', async () => {
    const hash = await computeDataSchemaHash(schema);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await computeDataSchemaHash({ fields: [...VARIABLE_DATA_FIELDS] })).toBe(hash);
  });

  it('ignores presentation: display names, descriptions and field order', async () => {
    const hash = await computeDataSchemaHash(schema);
    const presented: DataSchema = {
      fields: [...VARIABLE_DATA_FIELDS]
        .reverse()
        .map((field) => ({
          ...field,
          displayName: `${field.displayName} (renamed)`,
          description: 'x',
        })),
    };
    expect(await computeDataSchemaHash(presented)).toBe(hash);
    expect(dataSchemaContract(presented)).toEqual(dataSchemaContract(schema));
  });

  it.each([
    ['a type', { type: 'number' }],
    ['required', { required: true }],
    ['a default', { defaultValue: 'x' }],
  ])('changes when %s changes', async (_label, change) => {
    const base = createDataField({ key: 'size', type: 'string' });
    const changed = { ...base, ...change } as typeof base;
    expect(await computeDataSchemaHash({ fields: [changed] })).not.toBe(
      await computeDataSchemaHash({ fields: [base] }),
    );
  });

  it('changes when a key or a validation rule changes', async () => {
    const base = createDataField({ key: 'size', type: 'string' });
    const renamed = { ...base, key: 'size_code' };
    const ruled = { ...base, validation: { ...base.validation, maxLength: 4 } } as typeof base;
    const hashes = await Promise.all(
      [[base], [renamed], [ruled]].map((fields) => computeDataSchemaHash({ fields })),
    );
    expect(new Set(hashes).size).toBe(3);
  });
});

describe('record asset references', () => {
  const imageId = '0192b8a0-0000-7000-8000-000000000001';

  it('reports record image values that are not available to the organization', () => {
    const validation = validateDataRecord(schema, {
      ...VARIABLE_DATA_RECORD,
      product_image: imageId,
    });
    expect(recordImageAssetIds(schema, validation)).toEqual([imageId]);
    expect(checkRecordAssetReferences(schema, validation, () => 'AVAILABLE')).toEqual([]);
    const issues = checkRecordAssetReferences(schema, validation, () => 'UNAVAILABLE');
    expect(issues).toMatchObject([
      { layer: 'DATA', code: 'UNKNOWN_ASSET_REFERENCE', severity: 'ERROR', field: 'product_image' },
    ]);
  });

  it('ignores fields without a record value', () => {
    const validation = validateDataRecord(schema, VARIABLE_DATA_RECORD);
    expect(recordImageAssetIds(schema, validation)).toEqual([]);
    expect(checkRecordAssetReferences(schema, validation, () => 'UNAVAILABLE')).toEqual([]);
  });
});
