import {
  cssWeightFromWeightClass,
  toUnicodeRanges,
  type AssetMimeType,
  type FontEmbeddingPermission,
  type FontFaceStyle,
  type FontFormat,
  type UnicodeRange,
} from '@smarttag/shared-types';
import * as fontkit from 'fontkit';

/**
 * Reads registry metadata from an uploaded font file (see docs/typography.md#font-registry).
 * Everything stored about a font comes from the file itself, never from the client.
 */
export interface InspectedFont {
  readonly familyName: string;
  readonly subfamilyName: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly fontVersion: string;
  readonly weight: number;
  readonly style: FontFaceStyle;
  readonly format: FontFormat;
  readonly embeddingPermission: FontEmbeddingPermission;
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly capHeight: number | null;
  readonly xHeight: number | null;
  readonly glyphCount: number;
  readonly unicodeRanges: readonly UnicodeRange[];
}

export type FontInspectionResult =
  | { readonly ok: true; readonly font: InspectedFont }
  | { readonly ok: false; readonly reason: string };

const FORMAT_BY_MIME: Partial<Record<AssetMimeType, FontFormat>> = {
  'font/ttf': 'TTF',
  'font/otf': 'OTF',
  'font/woff': 'WOFF',
  'font/woff2': 'WOFF2',
};

const MAX_NAME_LENGTH = 200;

function text(value: unknown, max = MAX_NAME_LENGTH): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function integerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

export function inspectFont(buffer: Buffer, mimeType: AssetMimeType): FontInspectionResult {
  const format = FORMAT_BY_MIME[mimeType];
  if (!format) {
    return { ok: false, reason: 'The file is not a supported font format' };
  }

  let parsed: fontkit.Font | fontkit.FontCollection;
  try {
    parsed = fontkit.create(buffer);
  } catch {
    return { ok: false, reason: 'The font file could not be read' };
  }
  if ('fonts' in parsed) {
    return {
      ok: false,
      reason: 'Font collections are not supported; upload each font face as its own file',
    };
  }
  const font = parsed;

  try {
    if (Object.keys(font.variationAxes ?? {}).length > 0) {
      return {
        ok: false,
        reason:
          'Variable fonts are not supported yet; upload static instances (one file per weight and style)',
      };
    }

    const os2 = font['OS/2'];
    const familyName = text(font.getName('preferredFamily', 'en')) || text(font.familyName);
    const subfamilyName =
      text(font.getName('preferredSubfamily', 'en')) || text(font.subfamilyName) || 'Regular';
    const postscriptName = text(font.postscriptName, 127);
    if (!familyName || !postscriptName) {
      return { ok: false, reason: 'The font has no family or PostScript name' };
    }
    const unitsPerEm = integerOrNull(font.unitsPerEm);
    if (unitsPerEm === null || unitsPerEm < 16 || unitsPerEm > 16_384) {
      return { ok: false, reason: 'The font has an invalid units-per-em value' };
    }
    const glyphCount = integerOrNull(font.numGlyphs) ?? 0;
    const characterSet = font.characterSet;
    if (glyphCount < 1 || characterSet.length === 0) {
      return { ok: false, reason: 'The font maps no characters to glyphs' };
    }

    // Line metrics: OS/2 typo metrics when the font asks for them, otherwise hhea — the same rule
    // modern browsers and layout engines apply.
    const useTypo = Boolean(os2?.fsSelection?.useTypoMetrics);
    const ascender = integerOrNull(useTypo ? os2.typoAscender : font.hhea.ascent) ?? 0;
    const descender = integerOrNull(useTypo ? os2.typoDescender : font.hhea.descent) ?? 0;
    const lineGap = integerOrNull(useTypo ? os2.typoLineGap : font.hhea.lineGap) ?? 0;

    const fsType = os2?.fsType;
    const embeddingPermission: FontEmbeddingPermission = fsType?.noEmbedding
      ? 'RESTRICTED'
      : fsType?.viewOnly
        ? 'PREVIEW_AND_PRINT'
        : fsType?.editable
          ? 'EDITABLE'
          : 'INSTALLABLE';

    const italic = Boolean(os2?.fsSelection?.italic || os2?.fsSelection?.oblique);

    return {
      ok: true,
      font: {
        familyName,
        subfamilyName,
        fullName: text(font.fullName, 300) || `${familyName} ${subfamilyName}`,
        postscriptName,
        fontVersion: text(String(font.version ?? ''), 100) || 'unknown',
        weight: cssWeightFromWeightClass(integerOrNull(os2?.usWeightClass) ?? 400),
        style: italic ? 'ITALIC' : 'NORMAL',
        format,
        embeddingPermission,
        unitsPerEm,
        ascender,
        descender,
        lineGap,
        capHeight: integerOrNull(font.capHeight),
        xHeight: integerOrNull(font.xHeight),
        glyphCount,
        unicodeRanges: toUnicodeRanges(characterSet),
      },
    };
  } catch {
    return { ok: false, reason: 'The font file could not be read' };
  }
}
