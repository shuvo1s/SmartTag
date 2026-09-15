import type { DataField, DataSchema } from '@smarttag/document-schema';

/** A raw test value as editors hold it: text, a number, true/false or nothing. */
export type TestValue = string | number | boolean | null;

/**
 * Plausible values to start testing with: the field default, the first allowed value, or a
 * type-appropriate example that respects min/max and length rules. Images stay empty (they must
 * be chosen from the organization's assets). Values that cannot be synthesised for a pattern are
 * left for the user — the validation summary shows what still needs attention.
 */
export function createSampleRecord(schema: DataSchema): Record<string, TestValue> {
  const record: Record<string, TestValue> = {};
  for (const field of schema.fields) record[field.key] = sampleValue(field);
  return record;
}

function sampleValue(field: DataField): TestValue {
  if (field.defaultValue !== null) return field.defaultValue;
  switch (field.type) {
    case 'string': {
      const { allowedValues, maxLength, minLength, pattern } = field.validation;
      if (allowedValues) return allowedValues[0] ?? null;
      if (pattern !== null) return null;
      let text = field.displayName;
      if (minLength !== null && text.length < minLength) text = text.padEnd(minLength, 'x');
      if (maxLength !== null) text = Array.from(text).slice(0, maxLength).join('');
      return text;
    }
    case 'number': {
      const { allowedValues, min, max } = field.validation;
      if (allowedValues) return allowedValues[0] ?? null;
      return min ?? (max !== null ? Math.min(1, max) : 1);
    }
    case 'decimal': {
      const { allowedValues, min } = field.validation;
      if (allowedValues) return allowedValues[0] ?? null;
      return min ?? '9.99';
    }
    case 'boolean':
      return true;
    case 'date':
      return '2026-01-01';
    case 'url':
      return 'https://example.com';
    case 'image':
      return null;
  }
}
