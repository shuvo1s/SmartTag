/**
 * Font registry contract (see docs/typography.md).
 *
 * Every FONT asset has exactly one registry entry whose metadata is read from the font file on
 * the server. Text objects reference the asset id (`fontAssetId`); family, weight and style in the
 * document must match this entry. Metrics are in font units — scale by fontSize / unitsPerEm.
 */
export const FONT_FORMATS = ['TTF', 'OTF', 'WOFF', 'WOFF2'] as const;
export type FontFormat = (typeof FONT_FORMATS)[number];

export const FONT_FACE_STYLES = ['NORMAL', 'ITALIC'] as const;
export type FontFaceStyle = (typeof FONT_FACE_STYLES)[number];

/** OpenType OS/2 `fsType` embedding rights, relevant for production PDF output. */
export const FONT_EMBEDDING_PERMISSIONS = [
  'INSTALLABLE',
  'EDITABLE',
  'PREVIEW_AND_PRINT',
  'RESTRICTED',
] as const;
export type FontEmbeddingPermission = (typeof FONT_EMBEDDING_PERMISSIONS)[number];

/** Inclusive Unicode code point range. */
export type UnicodeRange = readonly [first: number, last: number];

export interface FontFaceDto {
  readonly assetId: string;
  readonly filename: string;
  readonly checksumSha256: string;
  readonly sizeBytes: number;
  /** Typographic family (name ID 16, falling back to name ID 1), e.g. "Noto Sans". */
  readonly familyName: string;
  /** Typographic subfamily (name ID 17, falling back to name ID 2), e.g. "SemiBold". */
  readonly subfamilyName: string;
  readonly fullName: string;
  readonly postscriptName: string;
  /** Version string from the font's name table, e.g. "Version 2.015". */
  readonly fontVersion: string;
  /** CSS weight derived from usWeightClass, rounded to 100–900. */
  readonly weight: number;
  readonly style: FontFaceStyle;
  readonly format: FontFormat;
  readonly embeddingPermission: FontEmbeddingPermission;
  readonly unitsPerEm: number;
  /** Line metrics used for layout (typo metrics when USE_TYPO_METRICS is set, otherwise hhea). */
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly capHeight: number | null;
  readonly xHeight: number | null;
  readonly glyphCount: number;
  /** Code points the font maps to glyphs, as sorted inclusive ranges. */
  readonly unicodeRanges: readonly UnicodeRange[];
  readonly createdAt: string;
}

/** Converts a usWeightClass (1–1000) to the CSS weight used by documents (100–900). */
export function cssWeightFromWeightClass(weightClass: number): number {
  const rounded = Math.round(weightClass / 100) * 100;
  return Math.min(900, Math.max(100, rounded));
}

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
