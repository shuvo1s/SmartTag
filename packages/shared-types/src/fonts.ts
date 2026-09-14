/**
 * Font registry contract (see docs/typography.md).
 *
 * Every FONT asset has exactly one registry entry whose metadata is read from the font file on
 * the server. Text objects reference the asset id (`fontAssetId`); family, weight and style in the
 * document must match this entry. Metrics are in font units — scale by fontSize / unitsPerEm.
 */
import type { UnicodeRange } from '@smarttag/document-utils';

export {
  findMissingGlyphs,
  rangesContainCodePoint,
  toUnicodeRanges,
  type UnicodeRange,
} from '@smarttag/document-utils';

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
