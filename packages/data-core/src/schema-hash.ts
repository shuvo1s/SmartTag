import type { DataField, DataSchema } from '@smarttag/document-schema';
import { hashCanonicalJson } from '@smarttag/document-utils';

export const DATA_SCHEMA_HASH_SCHEME = 'smarttag-data-schema-v1' as const;

/** How a data schema hash was produced; stored next to imports, datasets and mapping profiles. */
export const DATA_SCHEMA_HASH_METHOD = `SHA-256/RFC8785-JCS/${DATA_SCHEMA_HASH_SCHEME}` as const;

export interface DataSchemaContractField {
  readonly key: string;
  readonly type: DataField['type'];
  readonly required: boolean;
  readonly defaultValue: DataField['defaultValue'];
  readonly validation: DataField['validation'];
}

/**
 * The part of a data schema that external data must satisfy: for every field its key, type,
 * whether it is required, its default and its validation rules — sorted by key.
 *
 * Presentation is excluded on purpose: display names, descriptions and the order of fields in
 * the Data panel do not change what a record must contain, so they do not change the hash.
 */
export function dataSchemaContract(schema: DataSchema): {
  readonly scheme: typeof DATA_SCHEMA_HASH_SCHEME;
  readonly fields: readonly DataSchemaContractField[];
} {
  const fields = schema.fields
    .map((field): DataSchemaContractField => ({
      key: field.key,
      type: field.type,
      required: field.required,
      defaultValue: field.defaultValue,
      validation: field.validation,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { scheme: DATA_SCHEMA_HASH_SCHEME, fields };
}

/**
 * Deterministic fingerprint of a data contract: SHA-256 of the RFC 8785 canonical JSON of
 * `dataSchemaContract(schema)`. Template versions with the same fields, types, requirements,
 * defaults and rules share it, which is how mapping profiles recognise a compatible template and
 * how imports detect that a template's data contract changed.
 */
export async function computeDataSchemaHash(schema: DataSchema): Promise<string> {
  return hashCanonicalJson(dataSchemaContract(schema));
}
