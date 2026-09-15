import { describe, expect, it } from 'vitest';
import {
  compareDecimals,
  decimalFromNumber,
  formatDecimal,
  negateDecimal,
  normalizeDecimal,
  roundDecimal,
} from '../src';

describe('exact decimals', () => {
  it('normalizes sign and leading zeros but keeps the written scale', () => {
    expect(normalizeDecimal('39.90')).toBe('39.90');
    expect(normalizeDecimal('+007.50')).toBe('7.50');
    expect(normalizeDecimal('-0.00')).toBe('0.00');
    expect(normalizeDecimal('-0')).toBe('0');
    expect(normalizeDecimal('0012')).toBe('12');
    expect(normalizeDecimal('1e3')).toBeNull();
    expect(normalizeDecimal('19,99')).toBeNull();
    expect(normalizeDecimal('.5')).toBeNull();
    expect(normalizeDecimal('')).toBeNull();
  });

  it('converts numbers with shortest round-trip digits and no exponent', () => {
    expect(decimalFromNumber(39.95)).toBe('39.95');
    expect(decimalFromNumber(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(decimalFromNumber(1e21)).toBe('1000000000000000000000');
    expect(decimalFromNumber(-1.5e-7)).toBe('-0.00000015');
    expect(decimalFromNumber(-0)).toBe('0');
    expect(decimalFromNumber(123456789)).toBe('123456789');
    expect(() => decimalFromNumber(Number.NaN)).toThrow(RangeError);
    expect(() => decimalFromNumber(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('compares numerically regardless of scale', () => {
    expect(compareDecimals('39.90', '39.9')).toBe(0);
    expect(compareDecimals('-1', '0')).toBe(-1);
    expect(compareDecimals('10', '9.99')).toBe(1);
    expect(compareDecimals('-10', '-9.99')).toBe(-1);
    expect(compareDecimals('0.00', '-0')).toBe(0);
    expect(compareDecimals('123456789012345678901.5', '123456789012345678901.49')).toBe(1);
  });

  it('rounds half away from zero exactly (no binary floating point)', () => {
    expect(roundDecimal('1.005', 2)).toBe('1.01'); // Math.round(1.005 * 100) / 100 gives 1
    expect(roundDecimal('2.345', 2)).toBe('2.35');
    expect(roundDecimal('-2.345', 2)).toBe('-2.35');
    expect(roundDecimal('39.9', 2)).toBe('39.90');
    expect(roundDecimal('9.995', 2)).toBe('10.00');
    expect(roundDecimal('99.5', 0)).toBe('100');
    expect(roundDecimal('-0.004', 2)).toBe('0.00');
    expect(roundDecimal('0.4', 0)).toBe('0');
  });

  it('formats with explicit separators, never the runtime locale', () => {
    const format = { fractionDigits: 2, decimalSeparator: ',', groupSeparator: '.' };
    expect(formatDecimal('1234567.891', format)).toBe('1.234.567,89');
    expect(formatDecimal('-1234.5', format)).toBe('-1.234,50');
    expect(
      formatDecimal('999', { fractionDigits: 0, decimalSeparator: '.', groupSeparator: ' ' }),
    ).toBe('999');
    expect(
      formatDecimal('39.95', { fractionDigits: 2, decimalSeparator: '.', groupSeparator: '' }),
    ).toBe('39.95');
  });

  it('negates without producing negative zero', () => {
    expect(negateDecimal('39.95')).toBe('-39.95');
    expect(negateDecimal('-2')).toBe('2');
    expect(negateDecimal('0.00')).toBe('0.00');
  });
});
