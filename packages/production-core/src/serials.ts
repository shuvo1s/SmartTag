import { z } from 'zod';

/**
 * Serial numbers are whole numbers formatted deterministically. The number itself comes from a
 * server-side sequence; the format is stored with the sequence, so the same number always
 * produces the same text.
 */
export const MAX_SERIAL_PADDING = 24;
export const MAX_SERIAL_AFFIX = 16;
/** Sequence values stay inside the range PostgreSQL bigint and JS integers both represent. */
export const MAX_SEQUENCE_VALUE = Number.MAX_SAFE_INTEGER;

export const SEQUENCE_RESET_POLICIES = ['NEVER'] as const;
export type SequenceResetPolicy = (typeof SEQUENCE_RESET_POLICIES)[number];

export const SerialFormatSchema = z.strictObject({
  prefix: z.string().max(MAX_SERIAL_AFFIX),
  suffix: z.string().max(MAX_SERIAL_AFFIX),
  /** Minimum number of digits; the number is padded with leading zeros. 0 means no padding. */
  padding: z.number().int().min(0).max(MAX_SERIAL_PADDING),
});
export type SerialFormat = z.infer<typeof SerialFormatSchema>;

export const DEFAULT_SERIAL_FORMAT: SerialFormat = { prefix: '', suffix: '', padding: 0 };

/** "YT-" + 1257 padded to 8 digits → "YT-00001257". */
export function formatSerial(value: number, format: SerialFormat): string {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SEQUENCE_VALUE) {
    throw new RangeError('serial values must be whole numbers within the sequence range');
  }
  const digits = String(value).padStart(format.padding, '0');
  return `${format.prefix}${digits}${format.suffix}`;
}

export interface SerialRange {
  readonly startValue: number;
  readonly endValue: number;
  readonly count: number;
}

/** The range a job of `count` instances would take, starting at `nextValue`. */
export function serialRange(nextValue: number, count: number): SerialRange {
  if (!Number.isInteger(nextValue) || nextValue < 1) {
    throw new RangeError('a sequence starts at 1');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('a reservation covers at least one serial number');
  }
  const endValue = nextValue + count - 1;
  if (endValue > MAX_SEQUENCE_VALUE) {
    throw new RangeError('the sequence does not have that many numbers left');
  }
  return { startValue: nextValue, endValue, count };
}

export interface SerialPreview {
  readonly first: string;
  readonly last: string;
  /** The first few serial numbers, for showing what the job will produce. */
  readonly samples: readonly string[];
  readonly range: SerialRange;
  /** True while the numbers are only a preview: nothing is reserved until the job is released. */
  readonly provisional: boolean;
}

/**
 * What the serial numbers would look like. A preview never reserves anything — it reads the
 * sequence's current position, and the real range is taken in the release transaction.
 */
export function previewSerials(
  nextValue: number,
  count: number,
  format: SerialFormat,
  sampleCount = 5,
  provisional = true,
): SerialPreview {
  const range = serialRange(nextValue, count);
  const samples: string[] = [];
  for (let index = 0; index < Math.min(sampleCount, count); index += 1) {
    samples.push(formatSerial(range.startValue + index, format));
  }
  return {
    first: formatSerial(range.startValue, format),
    last: formatSerial(range.endValue, format),
    samples,
    range,
    provisional,
  };
}

/** The serial of the instance at `offset` inside a reserved range. */
export function serialAt(range: SerialRange, offset: number, format: SerialFormat): string {
  if (!Number.isInteger(offset) || offset < 0 || offset >= range.count) {
    throw new RangeError('the instance is outside the reserved serial range');
  }
  return formatSerial(range.startValue + offset, format);
}
