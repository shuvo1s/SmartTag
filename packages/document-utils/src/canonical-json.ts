/**
 * Canonical JSON serialization (RFC 8785 "JSON Canonicalization Scheme" compatible for the JSON
 * subset used by SmartTag documents).
 *
 * Guarantees: the same logical JSON value always produces the same string, independent of key
 * insertion order or whitespace — so the same design always produces the same hash.
 *
 * Rules:
 * - object keys sorted by UTF-16 code units (RFC 8785 §3.2.3); array order preserved
 * - no insignificant whitespace
 * - numbers use the ECMAScript shortest round-trip form; -0 → 0; NaN/±Infinity rejected
 * - strings escaped per JSON.stringify (identical to RFC 8785 escaping); lone surrogates rejected
 * - `undefined`, functions, symbols, bigint, class instances (Date, Map, …) and cycles rejected —
 *   a canonical document must already be plain JSON, nothing is silently dropped
 */
export const CANONICALIZATION_SCHEME = 'RFC8785-JCS' as const;

export class CanonicalJsonError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} at ${path}`);
    this.name = 'CanonicalJsonError';
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function canonicalizeJson(value: unknown): string {
  return serialize(value, '$', new Set<object>());
}

function serialize(value: unknown, path: string, ancestors: Set<object>): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(`Non-finite number ${String(value)} is not valid JSON`, path);
      }
      return Object.is(value, -0) ? '0' : JSON.stringify(value);
    case 'string':
      if (LONE_SURROGATE.test(value)) {
        throw new CanonicalJsonError('String contains an unpaired UTF-16 surrogate', path);
      }
      return JSON.stringify(value);
    case 'object':
      return serializeObject(value, path, ancestors);
    default:
      throw new CanonicalJsonError(`Unsupported value of type "${typeof value}"`, path);
  }
}

function serializeObject(value: object, path: string, ancestors: Set<object>): string {
  if (ancestors.has(value)) {
    throw new CanonicalJsonError('Circular reference', path);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items = (value as unknown[]).map((item, index) => {
        const itemPath = `${path}[${index}]`;
        if (item === undefined) {
          throw new CanonicalJsonError('Arrays must not contain undefined', itemPath);
        }
        return serialize(item, itemPath, ancestors);
      });
      return `[${items.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonError('Only plain objects can be canonicalized', path);
    }

    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => {
        const memberPath = `${path}.${key}`;
        const member = record[key];
        if (member === undefined) {
          throw new CanonicalJsonError('Object members must not be undefined', memberPath);
        }
        if (LONE_SURROGATE.test(key)) {
          throw new CanonicalJsonError(
            'Object key contains an unpaired UTF-16 surrogate',
            memberPath,
          );
        }
        return `${JSON.stringify(key)}:${serialize(member, memberPath, ancestors)}`;
      });
    return `{${members.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}
