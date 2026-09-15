import { decimalFromNumber } from './decimal';
import type { ExpressionType, ExpressionValue, ValueType } from './types';

export type NumericType = 'number' | 'decimal';

export function isNumericType(type: ExpressionType): type is NumericType {
  return type === 'number' || type === 'decimal';
}

/** Types that are text at heart and compare as text. */
export function isTextualType(type: ExpressionType): type is 'string' | 'url' | 'date' {
  return type === 'string' || type === 'url' || type === 'date';
}

/**
 * The type of a value that may come from either of two expressions (fallback(), if()).
 * Returns null when the types cannot be combined.
 */
export function unifyTypes(a: ExpressionType, b: ExpressionType): ExpressionType | null {
  if (a === b) return a;
  if (a === 'null') return b;
  if (b === 'null') return a;
  if (isNumericType(a) && isNumericType(b)) return 'decimal';
  if (isTextualType(a) && isTextualType(b)) return 'string';
  return null;
}

/** Whether == and != may compare values of these types. */
export function areComparable(a: ExpressionType, b: ExpressionType): boolean {
  if (a === 'null' || b === 'null') return true;
  if (isNumericType(a) && isNumericType(b)) return true;
  if (isTextualType(a) && isTextualType(b)) return true;
  return a === b;
}

/**
 * Whether <, <=, > and >= may order values of these types. Text orders by code units (never by
 * locale); ISO dates therefore order chronologically, also against date text such as "2026-01-01".
 */
export function areOrderable(a: ExpressionType, b: ExpressionType): boolean {
  if (a === 'null' || b === 'null') return true;
  if (isNumericType(a) && isNumericType(b)) return true;
  return isTextualType(a) && isTextualType(b);
}

/** Types whose values can be written as text (concat(), text content). */
export const TEXT_CONVERTIBLE_TYPES: readonly ExpressionType[] = [
  'string',
  'number',
  'decimal',
  'date',
  'url',
  'null',
];

/**
 * Deterministic text of a value: numbers without exponent notation, decimals exactly as stored,
 * dates as ISO dates. Returns null for null. Booleans and images have no text form.
 */
export function valueToText(value: ExpressionValue): string | null {
  switch (value.type) {
    case 'null':
      return null;
    case 'number':
      return decimalFromNumber(value.value);
    case 'string':
    case 'decimal':
    case 'date':
    case 'url':
    case 'image':
      return value.value;
    case 'boolean':
      return value.value ? 'true' : 'false';
  }
}

/** Decimal text of a numeric value. */
export function numericToDecimal(value: ExpressionValue): string {
  if (value.type === 'number') return decimalFromNumber(value.value);
  if (value.type === 'decimal') return value.value;
  throw new TypeError(`Expected a numeric value, got ${value.type}`);
}

/** null, or text that is empty after trimming. */
export function isEmptyValue(value: ExpressionValue): boolean {
  return (
    value.type === 'null' || (typeof value.value === 'string' && value.value.trim().length === 0)
  );
}

export function describeType(type: ExpressionType | ValueType): string {
  switch (type) {
    case 'string':
      return 'text';
    case 'number':
    case 'decimal':
      return 'a number';
    case 'boolean':
      return 'true/false';
    case 'date':
      return 'a date';
    case 'url':
      return 'a URL';
    case 'image':
      return 'an image';
    case 'null':
      return 'null';
  }
}
