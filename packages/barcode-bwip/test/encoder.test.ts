import {
  encodeBarcodeObject,
  encodeQrCodeObject,
  layoutLinearSymbol,
  layoutMatrixSymbol,
  type MatrixBarcodePattern,
} from '@smarttag/barcode-core';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { createBwipBarcodeEncoder } from '../src';

const encoder = createBwipBarcodeEncoder();

/**
 * Independent EAN-13 reference encoder written from the GS1 General Specifications tables, so the
 * adapter is verified against the standard rather than against itself.
 */
const L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

function referenceEan13(code: string): string {
  const digits = [...code].map(Number);
  const parity = PARITY[digits[0]!]!;
  let bits = '101';
  for (let i = 1; i <= 6; i += 1) {
    bits += (parity[i - 1] === 'L' ? L : G)[digits[i]!]!;
  }
  bits += '01010';
  for (let i = 7; i <= 12; i += 1) {
    bits += R[digits[i]!]!;
  }
  return `${bits}101`;
}

const CODE128_START_B = '11010010000';
const CODE128_STOP = '1100011101011';

function bitsOf(modules: readonly boolean[]): string {
  return modules.map((dark) => (dark ? '1' : '0')).join('');
}

/** Rasterizes a matrix pattern (with a 4-module quiet zone) and decodes it with jsQR. */
function decodeQr(pattern: MatrixBarcodePattern): string | null {
  const scale = 4;
  const quiet = 4;
  const side = (pattern.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let row = 0; row < pattern.size; row += 1) {
    for (let column = 0; column < pattern.size; column += 1) {
      if (!pattern.modules[row * pattern.size + column]) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const offset = (((row + quiet) * scale + dy) * side + (column + quiet) * scale + dx) * 4;
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
        }
      }
    }
  }
  return jsQR(data, side, side)?.data ?? null;
}

describe('bwip-js BarcodeEncoder adapter', () => {
  it('encodes EAN-13 exactly as the GS1 reference encoding, with guard bars marked', () => {
    for (const code of ['4006381333931', '5901234123457', '0012345678905']) {
      const pattern = encoder.encodeLinear('EAN13', code);
      expect(pattern.modules).toHaveLength(95);
      expect(bitsOf(pattern.modules)).toBe(referenceEan13(code));
      // start (0–2), centre (45–49) and end (92–94) guard bars extend into the text area
      const guardBars = pattern.guardModules.flatMap((guard, index) => (guard ? [index] : []));
      expect(guardBars).toEqual([0, 2, 46, 48, 92, 94]);
      expect(pattern.humanReadableText).toBe(code);
    }
  });

  it('encodes Code 128 with a valid structure and modulo-103 symbol', () => {
    const pattern = encoder.encodeLinear('CODE128', 'ST-1001');
    const bits = bitsOf(pattern.modules);
    expect(bits.startsWith(CODE128_START_B)).toBe(true);
    expect(bits.endsWith(CODE128_STOP)).toBe(true);
    // every symbol character is 11 modules; the stop pattern is 13
    expect((bits.length - 13) % 11).toBe(0);
    expect(pattern.guardModules.every((guard) => !guard)).toBe(true);
  });

  it('produces QR codes that decode back to the exact value, including UTF-8 text', () => {
    for (const [value, level] of [
      ['https://example.com/products/st-1001', 'M'],
      ['Organic Cotton Tee · বাংলাদেশে তৈরি · 19,99 €', 'Q'],
      ['A', 'H'],
    ] as const) {
      const pattern = encoder.encodeQr(value, level);
      expect(pattern.size % 4).toBe(1); // QR sizes are 21, 25, 29, …
      expect(decodeQr(pattern)).toBe(value);
    }
  });

  it('is deterministic', () => {
    expect(encoder.encodeQr('same', 'M')).toEqual(encoder.encodeQr('same', 'M'));
    expect(encoder.encodeLinear('CODE128', 'X-1')).toEqual(encoder.encodeLinear('CODE128', 'X-1'));
  });
});

describe('central symbol encoding and geometry', () => {
  it('validates values before encoding and never draws bars for invalid data', () => {
    expect(
      encodeBarcodeObject(encoder, { symbology: 'EAN13', value: '4006381333932' }),
    ).toMatchObject({
      status: 'INVALID_VALUE',
      issues: [{ code: 'INVALID_CHECK_DIGIT' }],
    });
    // 12 digits: the check digit is computed and appended
    const encoded = encodeBarcodeObject(encoder, { symbology: 'EAN13', value: '400638133393' });
    expect(encoded).toMatchObject({
      status: 'ENCODED',
      pattern: { encodedValue: '4006381333931' },
    });
    expect(
      encodeBarcodeObject(encoder, { symbology: 'ITF14', value: '15400141288763' }),
    ).toMatchObject({
      status: 'NOT_ENABLED',
    });
    expect(encodeQrCodeObject(encoder, { value: '', errorCorrection: 'M' })).toMatchObject({
      status: 'INVALID_VALUE',
    });
  });

  it('lays out EAN-13 bars from the X-dimension with GS1 human-readable text placement', () => {
    const pattern = encoder.encodeLinear('EAN13', '4006381333931');
    const width = 36 * (72 / 25.4);
    const geometry = layoutLinearSymbol(pattern, {
      width,
      height: 65,
      quietZone: 11,
      barHeight: 54,
      showHumanReadableText: true,
    });
    const x = width / (95 + 22);
    expect(geometry.moduleWidth).toBeCloseTo(x, 10);
    expect(geometry.bars[0]).toMatchObject({ x: 11 * x, width: x });
    const guard = geometry.bars[0]!.height;
    const normal = geometry.bars.find((bar) => bar.height < guard)!.height;
    expect(normal).toBe(54);
    expect(guard).toBeGreaterThan(54);
    expect(geometry.texts.map((t) => [t.text, t.anchor])).toEqual([
      ['4', 'end'],
      ['006381', 'middle'],
      ['333931', 'middle'],
    ]);
    // no bar ever leaves the frame
    for (const bar of geometry.bars) {
      expect(bar.x + bar.width).toBeLessThanOrEqual(width + 1e-9);
      expect(bar.y + bar.height).toBeLessThanOrEqual(65 + 1e-9);
    }
  });

  it('suppresses text that does not fit and reports it', () => {
    const pattern = encoder.encodeLinear('CODE128', 'ABC');
    const geometry = layoutLinearSymbol(pattern, {
      width: 100,
      height: 30,
      quietZone: 10,
      barHeight: 30,
      showHumanReadableText: true,
    });
    expect(geometry.texts).toEqual([]);
    expect(geometry.textSuppressed).toBe(true);
  });

  it('centres QR modules with the quiet zone inside a square frame', () => {
    const pattern = encoder.encodeQr('https://example.com', 'M');
    const geometry = layoutMatrixSymbol(pattern, { width: 60, height: 50, quietZone: 4 });
    expect(geometry.moduleSize).toBeCloseTo(50 / (pattern.size + 8), 10);
    expect(geometry.bounds).toEqual({ x: 5, y: 0, width: 50, height: 50 });
    const first = geometry.runs[0]!;
    expect(first.x).toBeCloseTo(5 + 4 * geometry.moduleSize, 10);
    expect(first.y).toBeCloseTo(4 * geometry.moduleSize, 10);
  });
});
