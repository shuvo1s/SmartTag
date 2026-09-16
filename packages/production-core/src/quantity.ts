import type { NormalizedDataRecord } from '@smarttag/data-core';
import type { DataField, DataSchema } from '@smarttag/document-schema';
import type { ProductionConfiguration } from './configuration';
import { productionIssue, type ProductionIssue } from './issues';
import type { ProductionLimits } from './limits';

/** Field types that can carry a whole number of tags. */
const QUANTITY_FIELD_TYPES = ['number', 'decimal', 'string'] as const;

export interface QuantityFieldCheck {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Whether a data field can be used as the quantity. The value still has to be a whole number in
 * every record — that is checked per record, so one bad row fails that row instead of the job.
 */
export function checkQuantityField(schema: DataSchema, key: string): QuantityFieldCheck {
  const field: DataField | undefined = schema.fields.find((candidate) => candidate.key === key);
  if (!field) {
    return { ok: false, message: `The data schema has no field "${key}".` };
  }
  if (!(QUANTITY_FIELD_TYPES as readonly string[]).includes(field.type)) {
    return {
      ok: false,
      message: `${field.displayName} is a ${field.type} field; quantities must come from a number, decimal or text field holding whole numbers.`,
    };
  }
  return { ok: true, message: '' };
}

export type QuantityResult =
  | { readonly ok: true; readonly quantity: number }
  | { readonly ok: false; readonly issue: ProductionIssue };

const INTEGER_TEXT = /^\d{1,12}$/;

/**
 * The number of tags one record produces. Values are never rounded, never guessed and never
 * silently corrected: anything that is not a whole number greater than zero fails the instance.
 */
export function resolveQuantity(
  record: NormalizedDataRecord,
  configuration: ProductionConfiguration,
  limits: ProductionLimits,
  schema?: DataSchema,
): QuantityResult {
  const quantity = configuration.quantity;
  if (quantity.mode === 'ONE_PER_RECORD') return { ok: true, quantity: 1 };

  const key = quantity.field;
  const label = schema?.fields.find((field) => field.key === key)?.displayName ?? key;
  const raw = Object.hasOwn(record, key) ? record[key] : null;

  if (raw === null || raw === undefined || raw === '') {
    if (quantity.whenMissing === 'DEFAULT') {
      return withinLimits(quantity.defaultQuantity, limits, label);
    }
    return {
      ok: false,
      issue: productionIssue(
        'QUANTITY_VALUE_MISSING',
        'ERROR',
        `${label} has no value, so the number of tags for this record is unknown`,
        key,
      ),
    };
  }

  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && INTEGER_TEXT.test(raw.trim())
        ? Number(raw.trim())
        : Number.NaN;

  if (!Number.isInteger(value)) {
    return {
      ok: false,
      issue: productionIssue(
        'QUANTITY_VALUE_INVALID',
        'ERROR',
        `${label} is "${String(raw)}", which is not a whole number of tags`,
        key,
      ),
    };
  }
  if (value <= 0) {
    return {
      ok: false,
      issue: productionIssue(
        'QUANTITY_VALUE_INVALID',
        'ERROR',
        `${label} is ${value}; a record must produce at least one tag`,
        key,
      ),
    };
  }
  return withinLimits(value, limits, label);
}

function withinLimits(quantity: number, limits: ProductionLimits, label: string): QuantityResult {
  if (quantity > limits.maxQuantityPerRecord) {
    return {
      ok: false,
      issue: productionIssue(
        'QUANTITY_LIMIT_EXCEEDED',
        'ERROR',
        `${label} is ${quantity.toLocaleString('en-US')}; at most ${limits.maxQuantityPerRecord.toLocaleString('en-US')} tags per record are supported`,
        null,
      ),
    };
  }
  return { ok: true, quantity };
}
