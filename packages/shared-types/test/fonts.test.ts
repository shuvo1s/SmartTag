import { describe, expect, it } from 'vitest';
import {
  ListAssetsQuerySchema,
  cssWeightFromWeightClass,
  findMissingGlyphs,
  isPlaceableImageMimeType,
  rangesContainCodePoint,
  toUnicodeRanges,
} from '../src';

describe('font registry helpers', () => {
  it('maps usWeightClass to CSS weights', () => {
    expect(cssWeightFromWeightClass(400)).toBe(400);
    expect(cssWeightFromWeightClass(350)).toBe(400);
    expect(cssWeightFromWeightClass(1)).toBe(100);
    expect(cssWeightFromWeightClass(1000)).toBe(900);
  });

  it('compresses code points into ranges and finds them again', () => {
    const ranges = toUnicodeRanges([0x42, 0x41, 0x43, 0x9b8, 0x61, 0x41]);
    expect(ranges).toEqual([
      [0x41, 0x43],
      [0x61, 0x61],
      [0x9b8, 0x9b8],
    ]);
    expect(rangesContainCodePoint(ranges, 0x42)).toBe(true);
    expect(rangesContainCodePoint(ranges, 0x44)).toBe(false);
    expect(rangesContainCodePoint([], 0x41)).toBe(false);
  });

  it('reports characters a font cannot render, ignoring whitespace and joiners', () => {
    const latin = toUnicodeRanges([...'Made in Bangladesh'].map((c) => c.codePointAt(0)!));
    expect(findMissingGlyphs(latin, 'Made in\nBangladesh')).toEqual([]);
    expect(findMissingGlyphs(latin, 'Made in বাংলাদেশ')).toEqual([
      'ব',
      'া',
      'ং',
      'ল',
      'দ',
      'ে',
      'শ',
    ]);
    expect(findMissingGlyphs(latin, 'Ma‍de')).toEqual([]);
  });
});

describe('asset listing contract', () => {
  it('accepts search and usage filters and knows placeable image types', () => {
    expect(
      ListAssetsQuerySchema.parse({ search: ' logo ', usage: 'PLACEABLE_IMAGE' }),
    ).toMatchObject({
      page: 1,
      search: 'logo',
      usage: 'PLACEABLE_IMAGE',
    });
    expect(() => ListAssetsQuerySchema.parse({ usage: 'ANYTHING' })).toThrow();
    expect(isPlaceableImageMimeType('image/svg+xml')).toBe(true);
    expect(isPlaceableImageMimeType('image/tiff')).toBe(false);
    expect(isPlaceableImageMimeType('font/ttf')).toBe(false);
  });
});
