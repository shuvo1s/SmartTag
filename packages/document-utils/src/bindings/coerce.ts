import {
  DECIMAL_PATTERN,
  ISO_DATE_PATTERN,
  type DataField,
} from '@smarttag/document-schema';

/** A raw value as it arrives from a data source (CSV cell, JSON payload, ERP message). */
export type DataValue = string | number | boolean | null;

/** One row of variable data, keyed by stable field key. */
export type DataRecord = Readonly<Record<string, DataValue | undefined>>;

export type CoercionResult =
  | { readonly ok: true; readonly value: string | number | boolean }
  | { readonly ok: false; readonly message: string };

const NUMBER_PATTERN = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HTTP_URL_PATTERN = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const TRUE_VALUES = new Set(['true', '1', 'yes', 'y']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'n']);

/** Whether a raw value counts as "not supplied" for a given field. */
export function isMissingValue(field: DataField, raw: DataValue | undefined): boolean {
  if (raw === undefined || raw === null) {
    return true;
  }
  // For non-text fields an empty cell carries no value. For text fields "" is a legitimate value.
  return field.type !== 'string' && typeof raw === 'string' && raw.trim() === '';
}

/** Converts a supplied raw value into the field's declared type, rejecting ambiguous input. */
export function coerceDataValue(field: DataField, raw: string | number | boolean): CoercionResult {
  const fail = (expected: string): CoercionResult => ({
    ok: false,
    message: `Field "${field.key}" expects ${expected}, received ${JSON.stringify(raw)}`,
  });

  switch (field.type) {
    case 'string':
      return { ok: true, value: typeof raw === 'string' ? raw : String(raw) };

    case 'number': {
      if (typeof raw === 'number') {
        return Number.isFinite(raw) ? { ok: true, value: raw } : fail('a finite number');
      }
      const text = String(raw).trim();
      return NUMBER_PATTERN.test(text) ? { ok: true, value: Number(text) } : fail('a number');
    }

    case 'decimal': {
      const text = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : String(raw).trim();
      return typeof raw !== 'boolean' && DECIMAL_PATTERN.test(text)
        ? { ok: true, value: text }
        : fail('a decimal such as "19.99"');
    }

    case 'boolean': {
      if (typeof raw === 'boolean') {
        return { ok: true, value: raw };
      }
      const text = String(raw).trim().toLowerCase();
      if (TRUE_VALUES.has(text)) return { ok: true, value: true };
      if (FALSE_VALUES.has(text)) return { ok: true, value: false };
      return fail('a boolean');
    }

    case 'date': {
      const text = String(raw).trim();
      return typeof raw === 'string' && ISO_DATE_PATTERN.test(text) && isRealCalendarDate(text)
        ? { ok: true, value: text }
        : fail('an ISO date (YYYY-MM-DD)');
    }

    case 'url': {
      const text = String(raw).trim();
      return typeof raw === 'string' && HTTP_URL_PATTERN.test(text) ? { ok: true, value: text } : fail('an http(s) URL');
    }

    case 'image': {
      const text = String(raw).trim().toLowerCase();
      return typeof raw === 'string' && UUID_PATTERN.test(text) ? { ok: true, value: text } : fail('an asset id');
    }
  }
}

function isRealCalendarDate(isoDate: string): boolean {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
