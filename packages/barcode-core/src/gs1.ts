/**
 * GS1 modulo-10 check digit (used by GTIN-8/12/13/14, SSCC, GLN).
 * Weights alternate 3,1,3,1… starting from the rightmost digit of the payload (excluding the check digit).
 */
export function computeGs1CheckDigit(payload: string): number {
  if (!/^\d+$/.test(payload)) {
    throw new RangeError('GS1 check digits are computed over digits only');
  }
  let sum = 0;
  for (let i = 0; i < payload.length; i += 1) {
    const digit = payload.charCodeAt(payload.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** True when the last digit of `value` is the correct GS1 check digit for the preceding digits. */
export function hasValidGs1CheckDigit(value: string): boolean {
  if (!/^\d{2,}$/.test(value)) {
    return false;
  }
  return computeGs1CheckDigit(value.slice(0, -1)) === Number(value.at(-1));
}

/**
 * Expands an 8-digit UPC-E (number system + 6 digits + check) to its 12-digit UPC-A equivalent.
 * UPC-E check digits are defined on the expanded UPC-A form.
 */
export function expandUpceToUpca(upce: string): string {
  if (!/^[01]\d{7}$/.test(upce)) {
    throw new RangeError('UPC-E must be 8 digits starting with number system 0 or 1');
  }
  const ns = upce[0]!;
  const d = upce.slice(1, 7);
  const check = upce[7]!;
  const last = d[5]!;
  let body: string;
  switch (last) {
    case '0':
    case '1':
    case '2':
      body = `${d.slice(0, 2)}${last}0000${d.slice(2, 5)}`;
      break;
    case '3':
      body = `${d.slice(0, 3)}00000${d.slice(3, 5)}`;
      break;
    case '4':
      body = `${d.slice(0, 4)}00000${d[4]!}`;
      break;
    default:
      body = `${d.slice(0, 5)}0000${last}`;
  }
  return `${ns}${body}${check}`;
}
