/**
 * Exact decimal helpers on plain decimal strings ("-1234.50"). Values never pass through binary
 * floating point, so 0.1 + 0.2 style errors cannot affect prices, and results are identical on
 * every platform. Formatting never consults the runtime locale.
 */

/** Plain decimal text: optional sign, integer digits, optional fraction. No exponent, no grouping. */
export const PLAIN_DECIMAL_PATTERN = /^([+-])?(\d+)(?:\.(\d+))?$/;

interface DecimalParts {
  readonly negative: boolean;
  /** Integer digits without leading zeros ("0" for zero). */
  readonly integer: string;
  /** Fraction digits exactly as written (scale is preserved). */
  readonly fraction: string;
}

function parts(text: string): DecimalParts | null {
  const match = PLAIN_DECIMAL_PATTERN.exec(text);
  if (!match) return null;
  const integer = match[2]!.replace(/^0+(?=\d)/, '');
  const fraction = match[3] ?? '';
  const zero = /^0+$/.test(integer + fraction || '0');
  return { negative: match[1] === '-' && !zero, integer, fraction };
}

function format({ negative, integer, fraction }: DecimalParts): string {
  return `${negative ? '-' : ''}${integer}${fraction.length > 0 ? `.${fraction}` : ''}`;
}

export function isPlainDecimal(text: string): boolean {
  return PLAIN_DECIMAL_PATTERN.test(text);
}

/**
 * Canonical form of a decimal string: no "+" sign, no leading integer zeros, no negative zero.
 * The number of fraction digits is preserved ("39.90" stays "39.90") because it is visible in
 * printed output. Returns null for anything that is not a plain decimal.
 */
export function normalizeDecimal(text: string): string | null {
  const parsed = parts(text);
  return parsed ? format(parsed) : null;
}

/**
 * Exact decimal text of a finite JavaScript number, using the shortest round-trip digits that
 * ECMAScript guarantees on every platform (39.95 → "39.95", 1e21 → "1000000000000000000000").
 */
export function decimalFromNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError('Only finite numbers can be converted to decimals');
  }
  if (Object.is(value, -0) || value === 0) return '0';
  const text = String(value);
  const exponent = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!exponent) return text;
  const [, sign, lead, rest = '', power] = exponent;
  const digits = `${lead}${rest}`;
  const shift = Number(power);
  // Position of the decimal point within `digits` after shifting.
  const point = 1 + shift;
  let result: string;
  if (point <= 0) {
    result = `0.${'0'.repeat(-point)}${digits}`;
  } else if (point >= digits.length) {
    result = `${digits}${'0'.repeat(point - digits.length)}`;
  } else {
    result = `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return normalizeDecimal(`${sign}${result}`)!;
}

/** Plain text of a number without exponent notation (for printing number values). */
export function numberToPlainText(value: number): string {
  return decimalFromNumber(value);
}

/** -1, 0 or 1. Both arguments must be plain decimals. */
export function compareDecimals(a: string, b: string): -1 | 0 | 1 {
  const left = parts(a);
  const right = parts(b);
  if (!left || !right) {
    throw new RangeError('compareDecimals expects plain decimal strings');
  }
  if (left.negative !== right.negative) return left.negative ? -1 : 1;
  const magnitude = compareMagnitude(left, right);
  return (left.negative ? -magnitude : magnitude) as -1 | 0 | 1;
}

function compareMagnitude(a: DecimalParts, b: DecimalParts): -1 | 0 | 1 {
  if (a.integer.length !== b.integer.length) return a.integer.length < b.integer.length ? -1 : 1;
  if (a.integer !== b.integer) return a.integer < b.integer ? -1 : 1;
  const length = Math.max(a.fraction.length, b.fraction.length);
  const fa = a.fraction.padEnd(length, '0');
  const fb = b.fraction.padEnd(length, '0');
  if (fa === fb) return 0;
  return fa < fb ? -1 : 1;
}

/** Adds one unit in the last place of an unsigned digit string ("199" → "200", "99" → "100"). */
function incrementDigits(digits: string): string {
  const chars = digits.split('');
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    if (chars[index] === '9') {
      chars[index] = '0';
    } else {
      chars[index] = String(Number(chars[index]) + 1);
      return chars.join('');
    }
  }
  return `1${chars.join('')}`;
}

/**
 * Rounds to exactly `fractionDigits` digits, half away from zero (2.345 → "2.35", -2.345 → "-2.35").
 * The result always has `fractionDigits` fraction digits ("39.9" at 2 → "39.90").
 */
export function roundDecimal(value: string, fractionDigits: number): string {
  const parsed = parts(value);
  if (!parsed) {
    throw new RangeError('roundDecimal expects a plain decimal string');
  }
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0) {
    throw new RangeError('fractionDigits must be a non-negative integer');
  }
  const { negative, integer, fraction } = parsed;
  if (fraction.length <= fractionDigits) {
    return format({ negative, integer, fraction: fraction.padEnd(fractionDigits, '0') });
  }
  const kept = `${integer}${fraction.slice(0, fractionDigits)}`;
  const roundUp = fraction.charCodeAt(fractionDigits) >= 53; // '5'
  const digits = roundUp ? incrementDigits(kept) : kept;
  const integerLength = digits.length - fractionDigits;
  const rounded = {
    negative,
    integer: digits.slice(0, integerLength).replace(/^0+(?=\d)/, '') || '0',
    fraction: digits.slice(integerLength),
  };
  const zero = /^0+$/.test(rounded.integer + rounded.fraction);
  return format({ ...rounded, negative: negative && !zero });
}

export interface DecimalFormat {
  readonly fractionDigits: number;
  /** Separator between integer and fraction digits. */
  readonly decimalSeparator: string;
  /** Separator between groups of three integer digits; "" disables grouping. */
  readonly groupSeparator: string;
}

/** Rounds and formats with explicit separators — never the runtime locale. */
export function formatDecimal(value: string, options: DecimalFormat): string {
  const rounded = parts(roundDecimal(value, options.fractionDigits))!;
  let integer = rounded.integer;
  if (options.groupSeparator.length > 0 && integer.length > 3) {
    const groups: string[] = [];
    for (let end = integer.length; end > 0; end -= 3) {
      groups.unshift(integer.slice(Math.max(0, end - 3), end));
    }
    integer = groups.join(options.groupSeparator);
  }
  return `${rounded.negative ? '-' : ''}${integer}${
    rounded.fraction.length > 0 ? `${options.decimalSeparator}${rounded.fraction}` : ''
  }`;
}

export function negateDecimal(value: string): string {
  const parsed = parts(value);
  if (!parsed) throw new RangeError('negateDecimal expects a plain decimal string');
  const zero = /^0+$/.test(parsed.integer + parsed.fraction);
  return format({ ...parsed, negative: !parsed.negative && !zero });
}
