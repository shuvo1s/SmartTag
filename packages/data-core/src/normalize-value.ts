import {
  DECIMAL_PATTERN,
  isRealCalendarDate,
  type DataField,
  type NormalizedFieldValue,
} from '@smarttag/document-schema';
import { decimalFromNumber, normalizeDecimal } from '@smarttag/expression-core';
import { DATA_LIMITS } from './limits';

/** How a raw value was empty. Absent keys, null and blank text are distinguished for messages. */
export type EmptyKind = 'MISSING' | 'NULL' | 'EMPTY';

export type ValueNormalization =
  | { readonly kind: 'VALUE'; readonly value: NormalizedFieldValue }
  | { readonly kind: EmptyKind }
  | {
      readonly kind: 'INVALID';
      readonly code: 'INVALID_TYPE' | 'INVALID_VALUE' | 'PAYLOAD_LIMIT_EXCEEDED';
      readonly message: string;
    };

const NUMBER_TEXT = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRUE_TEXT = new Set(['true', 'yes', 'y', '1']);
const FALSE_TEXT = new Set(['false', 'no', 'n', '0']);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

interface UrlLike {
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
}
const UrlConstructor = (globalThis as unknown as { URL?: new (input: string) => UrlLike }).URL;

function describeRaw(raw: unknown): string {
  if (Array.isArray(raw)) return 'a list';
  if (typeof raw === 'object') return 'an object';
  if (typeof raw === 'string') return 'text';
  return `a ${typeof raw}`;
}

/**
 * Converts one raw value into the field's type. Accepts native JSON values and the canonical
 * text forms produced by spreadsheets and form controls ("39.95", "true", "2026-09-15"), rejects
 * everything ambiguous ("19,99", "2026-02-30", "javascript:…"). Never trims or rewrites text
 * content except to recognise blank values.
 */
export function normalizeFieldValue(field: DataField, raw: unknown): ValueNormalization {
  if (raw === undefined) return { kind: 'MISSING' };
  if (raw === null) return { kind: 'NULL' };
  if (typeof raw === 'string' && raw.trim().length === 0) return { kind: 'EMPTY' };

  const invalidType = (expected: string): ValueNormalization => ({
    kind: 'INVALID',
    code: 'INVALID_TYPE',
    message: `${field.displayName} expects ${expected}, but received ${describeRaw(raw)}`,
  });
  const invalidValue = (message: string): ValueNormalization => ({
    kind: 'INVALID',
    code: 'INVALID_VALUE',
    message: `${field.displayName}: ${message}`,
  });

  if (typeof raw === 'string') {
    if (raw.length > DATA_LIMITS.maxStringValueLength) {
      return {
        kind: 'INVALID',
        code: 'PAYLOAD_LIMIT_EXCEEDED',
        message: `${field.displayName} is longer than ${DATA_LIMITS.maxStringValueLength} characters`,
      };
    }
    if (LONE_SURROGATE.test(raw)) return invalidValue('the text contains invalid Unicode');
    if (FORBIDDEN_CONTROL.test(raw)) return invalidValue('the text contains control characters');
  } else if (typeof raw !== 'number' && typeof raw !== 'boolean') {
    return invalidType(expectedFor(field.type));
  }

  switch (field.type) {
    case 'string':
      if (typeof raw === 'string') return { kind: 'VALUE', value: raw };
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return { kind: 'VALUE', value: decimalFromNumber(raw) };
      }
      return invalidType('text');

    case 'number': {
      if (typeof raw === 'number') {
        return Number.isFinite(raw)
          ? { kind: 'VALUE', value: raw === 0 ? 0 : raw }
          : invalidValue('the number is not finite');
      }
      if (typeof raw !== 'string') return invalidType('a number');
      const text = raw.trim();
      if (!NUMBER_TEXT.test(text)) {
        return invalidValue(
          text.includes(',')
            ? `"${text}" is not a number; use "." as the decimal separator and no grouping`
            : `"${text}" is not a number`,
        );
      }
      const value = Number(text);
      return Number.isFinite(value)
        ? { kind: 'VALUE', value: value === 0 ? 0 : value }
        : invalidValue(`"${text}" is out of range`);
    }

    case 'decimal': {
      let text: string;
      if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) return invalidValue('the number is not finite');
        text = decimalFromNumber(raw);
      } else if (typeof raw === 'string') {
        text = raw.trim();
      } else {
        return invalidType('a decimal number');
      }
      if (!DECIMAL_PATTERN.test(text)) {
        return invalidValue(
          text.includes(',')
            ? `"${text}" is not a decimal; use "." as the decimal separator and no grouping, e.g. 1234.50`
            : `"${text}" is not a decimal (at most 20 integer and 12 fraction digits, e.g. 39.95)`,
        );
      }
      return { kind: 'VALUE', value: normalizeDecimal(text)! };
    }

    case 'boolean': {
      if (typeof raw === 'boolean') return { kind: 'VALUE', value: raw };
      if (typeof raw === 'number') {
        return raw === 1 || raw === 0
          ? { kind: 'VALUE', value: raw === 1 }
          : invalidValue(`${raw} is not true/false`);
      }
      const text = raw.trim().toLowerCase();
      if (TRUE_TEXT.has(text)) return { kind: 'VALUE', value: true };
      if (FALSE_TEXT.has(text)) return { kind: 'VALUE', value: false };
      return invalidValue(`"${raw}" is not true/false`);
    }

    case 'date': {
      if (typeof raw !== 'string') return invalidType('a date (YYYY-MM-DD)');
      const text = raw.trim();
      return isRealCalendarDate(text)
        ? { kind: 'VALUE', value: text }
        : invalidValue(`"${text}" is not a calendar date in the form YYYY-MM-DD`);
    }

    case 'url': {
      if (typeof raw !== 'string') return invalidType('a URL');
      const text = raw.trim();
      if (text.length > DATA_LIMITS.maxUrlLength) {
        return invalidValue(`URLs are limited to ${DATA_LIMITS.maxUrlLength} characters`);
      }
      return isSafeHttpUrl(text)
        ? { kind: 'VALUE', value: text }
        : invalidValue(`"${text}" is not an http(s) URL`);
    }

    case 'image': {
      if (typeof raw !== 'string') return invalidType('an image asset id');
      const text = raw.trim();
      return UUID.test(text)
        ? { kind: 'VALUE', value: text.toLowerCase() }
        : invalidValue('images must reference an asset of the organization by id');
    }
  }
}

function expectedFor(type: DataField['type']): string {
  switch (type) {
    case 'string':
      return 'text';
    case 'number':
      return 'a number';
    case 'decimal':
      return 'a decimal number';
    case 'boolean':
      return 'true/false';
    case 'date':
      return 'a date (YYYY-MM-DD)';
    case 'url':
      return 'a URL';
    case 'image':
      return 'an image asset id';
  }
}

/**
 * http(s) URL with a host, no embedded credentials and no white space. `javascript:`, `data:`,
 * `file:` and every other scheme are refused; URLs are only ever encoded (QR) or printed as text.
 */
export function isSafeHttpUrl(text: string): boolean {
  if (!/^https?:\/\/[^\s]+$/i.test(text)) return false;
  if (!UrlConstructor) return /^https?:\/\/[^\s/?#@]+([/?#][^\s]*)?$/i.test(text);
  try {
    const url = new UrlConstructor(text);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname.length > 0 &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}
