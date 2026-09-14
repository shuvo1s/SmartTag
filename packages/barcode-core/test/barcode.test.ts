import { BARCODE_SYMBOLOGIES } from '@smarttag/document-schema';
import { describe, expect, it } from 'vitest';
import {
  SYMBOLOGY_SPECS,
  computeGs1CheckDigit,
  expandUpceToUpca,
  hasValidGs1CheckDigit,
  validateBarcodeValue,
  validateQrValue,
} from '../src';

describe('GS1 check digits', () => {
  it.each([
    ['400638133393', 1], // EAN-13 4006381333931
    ['590123412345', 7], // EAN-13 5901234123457
    ['9638507', 4], // EAN-8 96385074
    ['03600029145', 2], // UPC-A 036000291452
    ['1540014128876', 3], // ITF-14 15400141288763
  ])('computes the check digit for %s', (payload, expected) => {
    expect(computeGs1CheckDigit(payload)).toBe(expected);
  });

  it('verifies complete codes', () => {
    expect(hasValidGs1CheckDigit('4006381333931')).toBe(true);
    expect(hasValidGs1CheckDigit('4006381333932')).toBe(false);
  });

  it('expands UPC-E to UPC-A', () => {
    expect(expandUpceToUpca('04252614')).toBe('042100005264');
    expect(hasValidGs1CheckDigit(expandUpceToUpca('04252614'))).toBe(true);
  });
});

describe('validateBarcodeValue', () => {
  it('has a spec for every schema symbology', () => {
    expect(Object.keys(SYMBOLOGY_SPECS).sort()).toEqual([...BARCODE_SYMBOLOGIES].sort());
  });

  it.each([
    ['EAN13', '4006381333931', '4006381333931'],
    ['EAN13', '400638133393', '4006381333931'],
    ['EAN8', '9638507', '96385074'],
    ['UPCA', '036000291452', '036000291452'],
    ['UPCE', '04252614', '04252614'],
    ['UPCE', '0425261', '04252614'],
    ['ITF14', '1540014128876', '15400141288763'],
    ['CODE128', 'ST-1001/Navy', 'ST-1001/Navy'],
    ['CODE39', 'ABC-123 $', 'ABC-123 $'],
    ['GS1_128', '(01)04006381333931(10)LOT42', '(01)04006381333931(10)LOT42'],
  ] as const)('accepts %s %s', (symbology, value, normalized) => {
    expect(validateBarcodeValue(symbology, value)).toEqual({
      valid: true,
      normalizedValue: normalized,
    });
  });

  it.each([
    ['EAN13', '', 'EMPTY_VALUE'],
    ['EAN13', '4006381333932', 'INVALID_CHECK_DIGIT'],
    ['EAN13', '40063813339', 'INVALID_LENGTH'],
    ['EAN13', '40063813339A', 'INVALID_CHARACTERS'],
    ['UPCE', '24252614', 'INVALID_CHARACTERS'],
    ['UPCE', '04252615', 'INVALID_CHECK_DIGIT'],
    ['CODE39', 'lowercase', 'INVALID_CHARACTERS'],
    ['CODE128', 'naïve', 'INVALID_CHARACTERS'],
    ['GS1_128', '0104006381333931', 'INVALID_GS1_SYNTAX'],
    ['GS1_128', '(01)04006381333932', 'INVALID_CHECK_DIGIT'],
  ] as const)('rejects %s %p with %s', (symbology, value, code) => {
    const result = validateBarcodeValue(symbology, value);
    expect(result.valid).toBe(false);
    expect(!result.valid && result.issues[0]?.code).toBe(code);
  });
});

describe('validateQrValue', () => {
  it('accepts URLs and multilingual text', () => {
    expect(validateQrValue('https://example.com/products/st-1001', 'M').valid).toBe(true);
    expect(validateQrValue('বাংলাদেশে তৈরি', 'H').valid).toBe(true);
  });

  it('enforces byte capacity by error-correction level (UTF-8 aware)', () => {
    expect(validateQrValue('a'.repeat(2953), 'L').valid).toBe(true);
    expect(validateQrValue('a'.repeat(1274), 'H').valid).toBe(false);
    // 425 Bengali characters × 3 UTF-8 bytes = 1275 bytes > level H capacity
    expect(validateQrValue('ব'.repeat(425), 'H').valid).toBe(false);
    expect(validateQrValue('', 'M').valid).toBe(false);
  });
});
