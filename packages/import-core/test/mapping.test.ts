import type { DataSchema } from '@smarttag/document-schema';
import { createDataField } from '@smarttag/document-utils';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARSING_RULES,
  MappingDefinitionSchema,
  canonicalMapping,
  emptyMapping,
  mappingEntry,
  retainMappableEntries,
  suggestMappings,
  validateMapping,
  type MappingDefinition,
} from '../src';
import { HANG_TAG_HEADERS, columnsFor, vdpDocument } from './fixtures';

const schema = vdpDocument().dataSchema;

function mappingOf(pairs: [string, number][], headers: readonly string[] = HANG_TAG_HEADERS) {
  return {
    ...emptyMapping(),
    entries: pairs.map(([field, index]) => mappingEntry(field, { index, header: headers[index]! })),
  };
}

const COMPLETE: [string, number][] = [
  ['style', 0],
  ['product_name', 1],
  ['color', 2],
  ['size', 3],
  ['price', 4],
  ['gtin', 6],
];

describe('validateMapping', () => {
  const columns = columnsFor(HANG_TAG_HEADERS);

  it('accepts a mapping of every required field without a default', () => {
    const result = validateMapping(schema, columns, mappingOf(COMPLETE));
    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.mappedFields).toEqual([
      'product_name',
      'style',
      'color',
      'size',
      'price',
      'gtin',
    ]);
    // currency, country_of_origin and is_sustainable have defaults; product_url and image are optional.
    expect(result.unmappedOptionalFields).toEqual([
      'currency',
      'country_of_origin',
      'product_url',
      'is_sustainable',
      'product_image',
    ]);
    expect(result.ignoredColumns).toEqual([5, 7, 8, 9, 10]);
  });

  it('reports required fields that are not mapped', () => {
    const result = validateMapping(
      schema,
      columns,
      mappingOf(COMPLETE.filter(([field]) => field !== 'gtin')),
    );
    expect(result.complete).toBe(false);
    expect(result.unmappedRequiredFields).toEqual(['gtin']);
    expect(result.issues).toMatchObject([
      {
        code: 'REQUIRED_MAPPING_MISSING',
        message: 'Required field "gtin" (GTIN) is not mapped and has no default',
      },
    ]);
  });

  it('allows at most one column per target field, but one column may feed several fields', () => {
    const twice = mappingOf([...COMPLETE, ['gtin', 7]]);
    expect(validateMapping(schema, columns, twice).issues).toMatchObject([
      { code: 'TARGET_FIELD_ALREADY_MAPPED', field: 'gtin' },
    ]);
    const shared = mappingOf([...COMPLETE, ['country_of_origin', 2]]);
    expect(validateMapping(schema, columns, shared).complete).toBe(true);
  });

  it('refuses unknown fields and columns that are no longer where the mapping expects them', () => {
    const unknown = mappingOf([...COMPLETE]);
    const result = validateMapping(schema, columns, {
      ...unknown,
      entries: [
        ...unknown.entries,
        mappingEntry('__proto__', { index: 5, header: 'Currency' }),
        mappingEntry('currency', { index: 5, header: 'CURRENCY_CODE' }),
      ],
    });
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'UNKNOWN_TARGET_FIELD',
      'SOURCE_COLUMN_NOT_FOUND',
    ]);
  });

  it('warns about duplicate and unnamed headers', () => {
    const headers = ['STYLE', 'PRICE', 'PRICE', ''];
    const duplicateColumns = columnsFor(headers);
    const numbers: DataSchema = {
      fields: [
        createDataField({ key: 'price', type: 'decimal' }),
        createDataField({ key: 'note', type: 'string' }),
      ],
    };
    const result = validateMapping(
      numbers,
      duplicateColumns,
      mappingOf(
        [
          ['price', 2],
          ['note', 3],
        ],
        headers,
      ),
    );
    expect(result.complete).toBe(true);
    expect(result.issues.map((issue) => [issue.code, issue.message])).toEqual([
      ['DUPLICATE_HEADER_MAPPED', '"PRICE" appears more than once; Price uses column C, not B'],
      ['UNNAMED_COLUMN_MAPPED', 'Column D (no header) has no header; check that it holds Note'],
    ]);
  });

  it('refuses parsing overrides that do not fit the field type', () => {
    const mapping = mappingOf(COMPLETE);
    const withOverride: MappingDefinition = {
      ...mapping,
      entries: mapping.entries.map((entry) =>
        entry.field === 'style' ? { ...entry, dateFormat: 'DD/MM/YYYY' } : entry,
      ),
    };
    expect(validateMapping(schema, columns, withOverride).issues).toMatchObject([
      { code: 'PARSING_OPTION_NOT_APPLICABLE', field: 'style' },
    ]);
  });

  it('schema-validates definitions and canonicalizes entry order', () => {
    const mapping = mappingOf([
      ['size', 3],
      ['color', 2],
    ]);
    expect(MappingDefinitionSchema.safeParse(mapping).success).toBe(true);
    expect(MappingDefinitionSchema.safeParse({ ...mapping, extra: true }).success).toBe(false);
    expect(canonicalMapping(mapping).entries.map((entry) => entry.field)).toEqual([
      'color',
      'size',
    ]);
    expect(canonicalMapping(mapping).parsing).toEqual(DEFAULT_PARSING_RULES);
  });

  it('keeps only entries whose column still exists after the header row changes', () => {
    const shifted = columnsFor(['STYLE_NO', 'NAME', 'Color']);
    const { mapping, removed } = retainMappableEntries(mappingOf(COMPLETE), shifted);
    expect(mapping.entries.map((entry) => entry.field)).toEqual(['style', 'color']);
    expect(removed.map((entry) => entry.field)).toEqual(['product_name', 'size', 'price', 'gtin']);
  });
});

describe('suggestMappings — deterministic, never fuzzy', () => {
  it('matches keys and display names in order of confidence', () => {
    const columns = columnsFor([
      'product_name',
      'STYLE',
      'Country Of Origin',
      'Product URL',
      'Sustainable',
      'EAN',
    ]);
    const { suggestions } = suggestMappings(schema.fields, columns);
    expect(
      suggestions.map((suggestion) => [
        suggestion.column.header,
        suggestion.field,
        suggestion.match,
        suggestion.exact,
      ]),
    ).toEqual([
      ['product_name', 'product_name', 'EXACT_KEY', true],
      ['STYLE', 'style', 'CASE_INSENSITIVE_KEY', false],
      ['Country Of Origin', 'country_of_origin', 'NORMALIZED_KEY', false],
      ['Product URL', 'product_url', 'NORMALIZED_KEY', false],
      ['Sustainable', 'is_sustainable', 'EXACT_LABEL', true],
    ]);
  });

  it('"PRODUCT NAME" suggests product_name but requires confirmation', () => {
    const { suggestions } = suggestMappings(schema.fields, columnsFor(['PRODUCT NAME']));
    expect(suggestions).toEqual([
      {
        field: 'product_name',
        column: { index: 0, header: 'PRODUCT NAME' },
        match: 'NORMALIZED_KEY',
        exact: false,
      },
    ]);
  });

  it('never suggests ambiguous duplicate headers', () => {
    const { suggestions, ambiguous } = suggestMappings(
      schema.fields,
      columnsFor(['price', 'PRICE', 'price']),
    );
    expect(suggestions.find((suggestion) => suggestion.column.header === 'price')).toBeUndefined();
    expect(ambiguous.some((entry) => entry.reason.includes('more than one column'))).toBe(true);
  });

  it('never picks between two columns that match one field equally', () => {
    const { suggestions, ambiguous } = suggestMappings(schema.fields, columnsFor(['Size', 'SIZE']));
    expect(suggestions).toEqual([]);
    expect(ambiguous).toMatchObject([{ field: 'size' }]);
  });

  it('prefers the better match when columns compete', () => {
    const { suggestions } = suggestMappings(schema.fields, columnsFor(['GTIN', 'gtin']));
    expect(suggestions).toEqual([
      { field: 'gtin', column: { index: 1, header: 'gtin' }, match: 'EXACT_KEY', exact: true },
    ]);
  });

  it('ignores unnamed columns and headers that match nothing', () => {
    expect(
      suggestMappings(schema.fields, columnsFor(['', 'Barcode type', 'RETAIL'])).suggestions,
    ).toEqual([]);
  });
});
