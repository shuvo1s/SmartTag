import { computeResolvedInputHash, validateDataRecord } from '@smarttag/data-core';
import { sha256Hex } from '@smarttag/document-utils';
import { VARIABLE_DATA_RECORD } from '@smarttag/document-utils/fixtures';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  computeRecordHash,
  createRowProcessor,
  emptyMapping,
  mappingEntry,
  validateMapping,
  type MappingDefinition,
  type SourceRow,
} from '../src';
import { HANG_TAG_HEADERS, TEMPLATE_HASH, columnsFor, row, vdpDocument } from './fixtures';

const document = vdpDocument();
const columns = columnsFor(HANG_TAG_HEADERS);
const mapping: MappingDefinition = {
  ...emptyMapping(),
  entries: [
    ['style', 0],
    ['product_name', 1],
    ['color', 2],
    ['size', 3],
    ['price', 4],
    ['currency', 5],
    ['gtin', 6],
    ['country_of_origin', 7],
    ['product_url', 8],
    ['is_sustainable', 9],
    ['product_image', 10],
  ].map(([field, index]) => mappingEntry(field as string, columns[index as number]!)),
};

const IMAGE_ID = '0192b8a0-0000-7000-8000-000000000001';
const GOOD = [
  'YT-2045',
  'Premium Cotton Shirt',
  'Navy',
  'XL',
  '39.95',
  'USD',
  '9501234567891',
  'Bangladesh',
  'https://example.com/products/YT-2045',
  'true',
  '',
];

const processor = createRowProcessor({
  document,
  templateVersionHash: TEMPLATE_HASH,
  columns,
  mapping,
});
const available = () => 'AVAILABLE' as const;

function process(
  values: readonly string[],
  availability: Parameters<typeof processor.finish>[1] = available,
  rowNumber = 2,
) {
  const source: SourceRow = row(rowNumber, values);
  const prepared = processor.prepare(source);
  return processor.finish(prepared, availability);
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('the import row pipeline reuses the Phase 3 engine', () => {
  it('the mapping is complete', () => {
    expect(validateMapping(document.dataSchema, columns, mapping).complete).toBe(true);
  });

  it('a valid row: normalized record identical to Test Data, hashes identical to data-core', async () => {
    const result = process(GOOD);
    expect(result.issues).toEqual([]);
    expect(result.status).toBe('VALID');
    const direct = validateDataRecord(document.dataSchema, VARIABLE_DATA_RECORD);
    expect(result.normalizedRecord).toEqual(direct.normalizedRecord);
    expect(sha256(result.recordHashPayload)).toBe(await computeRecordHash(direct.normalizedRecord));
    expect(sha256(result.resolvedInputHashPayload!)).toBe(
      await computeResolvedInputHash(TEMPLATE_HASH, direct.normalizedRecord),
    );
    expect(await sha256Hex(result.recordHashPayload)).toBe(sha256(result.recordHashPayload));
    expect(result.searchText).toContain('premium cotton shirt');
  });

  it('warning row: a missing optional value under the WARN policy', () => {
    const warn = createRowProcessor({
      document: { ...document, settings: { ...document.settings, missingDataPolicy: 'WARN' } },
      templateVersionHash: TEMPLATE_HASH,
      columns,
      mapping: {
        ...mapping,
        entries: mapping.entries.filter((entry) => entry.field !== 'country_of_origin'),
      },
    });
    const withoutProductUrl = row(
      3,
      GOOD.map((value, index) => (index === 1 ? '' : value)),
    );
    const result = warn.finish(warn.prepare(withoutProductUrl), available);
    expect(result.status).toBe('ERROR'); // product_name is required
    const optional = createRowProcessor({
      document: {
        ...document,
        settings: { ...document.settings, missingDataPolicy: 'WARN' },
        dataSchema: {
          fields: document.dataSchema.fields.map((field) =>
            field.key === 'color' ? { ...field, required: false } : field,
          ),
        },
      },
      templateVersionHash: TEMPLATE_HASH,
      columns,
      mapping,
    });
    const warning = optional.finish(
      optional.prepare(
        row(
          4,
          GOOD.map((value, index) => (index === 2 ? '' : value)),
        ),
      ),
      available,
    );
    expect(warning.status).toBe('WARNING');
    expect(warning.issues).toMatchObject([
      { layer: 'BINDING', code: 'MISSING_DATA_VALUE', severity: 'WARNING', field: 'color' },
    ]);
    expect(warning.resolvedInputHashPayload).not.toBeNull();
  });

  it('missing required value: DATA error from validateDataRecord', () => {
    const result = process(GOOD.map((value, index) => (index === 6 ? '' : value)));
    expect(result.status).toBe('ERROR');
    expect(result.issues[0]).toMatchObject({
      layer: 'DATA',
      code: 'REQUIRED_VALUE_EMPTY',
      field: 'gtin',
    });
    expect(result.resolvedInputHashPayload).toBeNull();
  });

  it('decimal parse failure: one IMPORT issue, no duplicate DATA issue, never replaced by a default', () => {
    const result = process(GOOD.map((value, index) => (index === 4 ? '19,99' : value)));
    expect(result.status).toBe('ERROR');
    expect(result.issues[0]).toMatchObject({
      layer: 'IMPORT',
      code: 'DECIMAL_PARSE_FAILED',
      field: 'price',
      column: { letter: 'E' },
    });
    expect(result.issues.filter((issue) => issue.layer === 'DATA')).toEqual([]);
    expect(result.normalizedRecord.price).toBeNull();
    // Bound properties report the invalid input exactly as for invalid Test Data.
    expect(
      result.issues.some(
        (issue) => issue.layer === 'BINDING' && issue.code === 'INVALID_DATA_VALUE',
      ),
    ).toBe(true);
  });

  it('invalid EAN-13 check digit: OBJECT error on the resolved barcode', () => {
    const result = process(GOOD.map((value, index) => (index === 6 ? '9501234567893' : value)));
    expect(result.status).toBe('ERROR');
    expect(result.issues).toMatchObject([
      {
        layer: 'OBJECT',
        code: 'BARCODE_VALUE_INVALID',
        message: expect.stringContaining('Check digit should be 1') as string,
      },
    ]);
  });

  it('cross-tenant or unknown asset id: UNKNOWN_ASSET_REFERENCE from the tenant-scoped lookup', () => {
    const values = GOOD.map((value, index) => (index === 10 ? IMAGE_ID.toUpperCase() : value));
    const prepared = processor.prepare(row(2, values));
    expect(processor.imageCandidates(prepared)).toEqual([IMAGE_ID]);
    const result = processor.finish(prepared, () => 'UNAVAILABLE');
    expect(result.issues.map((issue) => [issue.layer, issue.code])).toEqual([
      ['DATA', 'UNKNOWN_ASSET_REFERENCE'],
      ['OBJECT', 'IMAGE_ASSET_UNAVAILABLE'],
    ]);
    expect(processor.finish(prepared, available).status).toBe('VALID');
  });

  it('identical rows have identical record hashes (duplicates are recognisable, never removed)', () => {
    const first = process(GOOD, available, 2);
    const second = process(GOOD, available, 9);
    expect(sha256(first.recordHashPayload)).toBe(sha256(second.recordHashPayload));
    expect(first.rowNumber).not.toBe(second.rowNumber);
  });

  it('refuses a mapping that does not match the columns', () => {
    expect(() =>
      createRowProcessor({
        document,
        templateVersionHash: TEMPLATE_HASH,
        columns: columnsFor(['OTHER']),
        mapping,
      }),
    ).toThrow(/does not match/);
  });
});
