/**
 * Unicode coverage of font files, as sorted inclusive code point ranges. Used by the font
 * registry (server), editors and renderers to detect characters a font cannot render, so that
 * missing glyphs are reported instead of silently falling back to another font.
 */
/** Inclusive Unicode code point range. */
export type UnicodeRange = readonly [first: number, last: number];

/** Compresses code points into sorted inclusive ranges. */
export function toUnicodeRanges(codePoints: Iterable<number>): UnicodeRange[] {
  const sorted = [...new Set(codePoints)].filter((cp) => Number.isInteger(cp) && cp >= 0);
  sorted.sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  for (const codePoint of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && codePoint === last[1] + 1) {
      last[1] = codePoint;
    } else {
      ranges.push([codePoint, codePoint]);
    }
  }
  return ranges;
}

/** Binary search: does the font map this code point? */
export function rangesContainCodePoint(
  ranges: readonly UnicodeRange[],
  codePoint: number,
): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle]!;
    if (codePoint < range[0]) {
      high = middle - 1;
    } else if (codePoint > range[1]) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}

/**
 * Characters of `text` that the font cannot render. Whitespace and control characters (including
 * line breaks) are ignored because they are not drawn with glyphs.
 */
export function findMissingGlyphs(ranges: readonly UnicodeRange[], text: string): string[] {
  const missing = new Set<string>();
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f) || /\s/u.test(char)) {
      continue;
    }
    // Zero-width joiners/non-joiners are shaping controls, not glyphs.
    if (codePoint === 0x200c || codePoint === 0x200d) {
      continue;
    }
    if (!rangesContainCodePoint(ranges, codePoint)) {
      missing.add(char);
    }
  }
  return [...missing];
}
