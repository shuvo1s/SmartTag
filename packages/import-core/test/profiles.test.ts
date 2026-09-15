import { computeDataSchemaHash } from '@smarttag/data-core';
import type { DataSchema } from '@smarttag/document-schema';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MappingProfileDefinitionSchema,
  computeHeaderSignature,
  createProfileDefinition,
  emptyMapping,
  evaluateMappingProfile,
  mappingEntry,
  type MappingDefinition,
} from '../src';
import { columnsFor, vdpDocument } from './fixtures';

const schema = vdpDocument().dataSchema;
const HEADERS = ['STYLE_NO', 'PRODUCT NAME', 'Color', 'SIZE_CODE', 'RETAIL', 'EAN_CODE'];
const FIELDS = ['style', 'product_name', 'color', 'size', 'price', 'gtin'];

function mappingFor(headers: readonly string[], fields = FIELDS): MappingDefinition {
  return {
    ...emptyMapping(),
    entries: fields.map((field, index) => mappingEntry(field, { index, header: headers[index]! })),
  };
}

let schemaHash: string;
beforeAll(async () => {
  schemaHash = await computeDataSchemaHash(schema);
});

function profileFrom(headers: readonly string[], mapping = mappingFor(headers)) {
  return {
    dataSchemaHash: schemaHash,
    definition: createProfileDefinition(schema, columnsFor(headers), mapping, 'CSV'),
  };
}

describe('mapping profile compatibility', () => {
  it('same schema + same headers → compatible', () => {
    const profile = profileFrom(HEADERS);
    expect(MappingProfileDefinitionSchema.safeParse(profile.definition).success).toBe(true);
    const result = evaluateMappingProfile(profile, {
      dataSchemaHash: schemaHash,
      schema,
      columns: columnsFor(HEADERS),
    });
    expect(result).toMatchObject({
      compatibility: 'COMPATIBLE',
      schemaMatches: true,
      layoutMatches: true,
      resolvedEntries: 6,
      notes: [],
    });
  });

  it('same schema + reordered columns → compatible, the mapping follows the headers', () => {
    const reordered = [
      'EAN_CODE',
      'RETAIL',
      'STYLE_NO',
      'Color',
      'PRODUCT NAME',
      'SIZE_CODE',
      'Extra',
    ];
    const result = evaluateMappingProfile(profileFrom(HEADERS), {
      dataSchemaHash: schemaHash,
      schema,
      columns: columnsFor(reordered),
    });
    expect(result.compatibility).toBe('COMPATIBLE');
    expect(result.layoutMatches).toBe(false);
    const byField = Object.fromEntries(
      result.mapping.entries.map((entry) => [entry.field, entry.column]),
    );
    expect(byField.gtin).toEqual({ index: 0, header: 'EAN_CODE' });
    expect(byField.style).toEqual({ index: 2, header: 'STYLE_NO' });
    expect(result.notes.every((note) => note.code === 'COLUMN_MOVED' && !note.blocking)).toBe(true);
  });

  it('same schema + missing source column → requires review', () => {
    const missing = HEADERS.filter((header) => header !== 'EAN_CODE');
    const result = evaluateMappingProfile(profileFrom(HEADERS), {
      dataSchemaHash: schemaHash,
      schema,
      columns: columnsFor(missing),
    });
    expect(result.compatibility).toBe('REQUIRES_REVIEW');
    expect(result.notes.map((note) => note.code)).toEqual([
      'COLUMN_NOT_FOUND',
      'REQUIRED_FIELD_UNMAPPED',
    ]);
    expect(result.mapping.entries.map((entry) => entry.field)).not.toContain('gtin');
  });

  it('different schema → requires review; nothing applicable → incompatible', () => {
    const changed: DataSchema = {
      fields: schema.fields.map((field) =>
        field.key === 'size' ? { ...field, required: false } : field,
      ),
    };
    const review = evaluateMappingProfile(profileFrom(HEADERS), {
      dataSchemaHash: 'b'.repeat(64),
      schema: changed,
      columns: columnsFor(HEADERS),
    });
    expect(review.compatibility).toBe('REQUIRES_REVIEW');
    expect(review.notes[0]).toMatchObject({ code: 'SCHEMA_CHANGED', blocking: true });

    const otherTemplate: DataSchema = { fields: [] };
    const none = evaluateMappingProfile(profileFrom(HEADERS), {
      dataSchemaHash: 'c'.repeat(64),
      schema: otherTemplate,
      columns: columnsFor(HEADERS),
    });
    expect(none.compatibility).toBe('INCOMPATIBLE');
    expect(none.resolvedEntries).toBe(0);
  });

  it('a field whose type changed is not applied', () => {
    const retyped = {
      fields: schema.fields.map((field) =>
        field.key === 'price'
          ? { ...field, type: 'number', validation: { min: null, max: null, allowedValues: null } }
          : field,
      ),
    } as DataSchema;
    const result = evaluateMappingProfile(profileFrom(HEADERS), {
      dataSchemaHash: 'd'.repeat(64),
      schema: retyped,
      columns: columnsFor(HEADERS),
    });
    expect(result.notes.map((note) => note.code)).toContain('FIELD_TYPE_CHANGED');
    expect(result.mapping.entries.map((entry) => entry.field)).not.toContain('price');
  });

  describe('duplicate source headers are never mapped ambiguously', () => {
    const duplicated = [
      'STYLE_NO',
      'PRODUCT NAME',
      'Color',
      'SIZE_CODE',
      'PRICE',
      'EAN_CODE',
      'PRICE',
    ];

    it('the same positions resolve', () => {
      const profile = profileFrom(duplicated, mappingFor(duplicated));
      const result = evaluateMappingProfile(profile, {
        dataSchemaHash: schemaHash,
        schema,
        columns: columnsFor(duplicated),
      });
      expect(result.compatibility).toBe('COMPATIBLE');
      expect(result.mapping.entries.find((entry) => entry.field === 'price')?.column).toEqual({
        index: 4,
        header: 'PRICE',
      });
    });

    it('moved duplicates are ambiguous and left for review', () => {
      const profile = profileFrom(duplicated, mappingFor(duplicated));
      const moved = [
        'PRICE',
        'STYLE_NO',
        'PRODUCT NAME',
        'Color',
        'SIZE_CODE',
        'EAN_CODE',
        'PRICE',
      ];
      const result = evaluateMappingProfile(profile, {
        dataSchemaHash: schemaHash,
        schema,
        columns: columnsFor(moved),
      });
      expect(result.compatibility).toBe('REQUIRES_REVIEW');
      expect(result.notes.map((note) => note.code)).toContain('COLUMN_AMBIGUOUS');
      expect(result.mapping.entries.find((entry) => entry.field === 'price')).toBeUndefined();
    });

    it('a header that becomes duplicated is ambiguous', () => {
      const profile = profileFrom(HEADERS);
      const nowDuplicated = [...HEADERS, 'RETAIL'];
      const result = evaluateMappingProfile(profile, {
        dataSchemaHash: schemaHash,
        schema,
        columns: columnsFor(nowDuplicated),
      });
      expect(result.notes.map((note) => note.code)).toContain('COLUMN_AMBIGUOUS');
    });
  });
});

describe('header signature', () => {
  it('is deterministic and order-sensitive', async () => {
    const signature = await computeHeaderSignature(columnsFor(HEADERS));
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(await computeHeaderSignature(columnsFor([...HEADERS]))).toBe(signature);
    expect(await computeHeaderSignature(columnsFor([...HEADERS].reverse()))).not.toBe(signature);
  });
});
