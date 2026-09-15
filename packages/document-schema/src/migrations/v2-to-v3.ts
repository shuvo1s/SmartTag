import type { DocumentMigration, JsonObject } from './migrator';

/** The rule keys each field type carries in schema v3, all without a rule (null). */
const EMPTY_RULES: Readonly<Record<string, JsonObject>> = {
  string: { minLength: null, maxLength: null, pattern: null, allowedValues: null },
  number: { min: null, max: null, allowedValues: null },
  decimal: { min: null, max: null, allowedValues: null },
  boolean: {},
  date: {},
  url: {},
  image: {},
};

/**
 * Schema v2 → v3 (Phase 3 — variable data).
 *
 * Every data field gains `validation`, the explicit rule set of its type with no rules (all keys
 * null). v2 had no validation rules, so values that were acceptable before stay acceptable.
 *
 * Nothing else changes:
 * - the EXPRESSION binding mode is new; v2 documents only contain STATIC and FIELD bindings
 * - the WARN missing-data policy is new; FAIL and EMPTY keep their meaning
 * - resolution order is unchanged: record value, then field default, then the policy
 *
 * The migrator hands this function a deep copy, so input is never mutated.
 */
export const migrateV2ToV3: DocumentMigration = {
  fromVersion: 2,
  toVersion: 3,
  description: 'v2→v3: data fields gain validation rules (none)',
  migrate(document: JsonObject): JsonObject {
    const dataSchema = isObject(document.dataSchema) ? document.dataSchema : null;
    const fields: unknown[] =
      dataSchema && Array.isArray(dataSchema.fields) ? dataSchema.fields : [];
    return {
      ...document,
      schemaVersion: 3,
      ...(dataSchema && {
        dataSchema: {
          ...dataSchema,
          fields: fields.map((field) => (isObject(field) ? addValidation(field) : field)),
        },
      }),
    };
  },
};

function addValidation(field: JsonObject): JsonObject {
  if ('validation' in field || typeof field.type !== 'string') return field;
  const rules = Object.hasOwn(EMPTY_RULES, field.type) ? EMPTY_RULES[field.type] : undefined;
  // Unknown types are left untouched; validation reports them precisely afterwards.
  return rules ? { ...field, validation: { ...rules } } : field;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
