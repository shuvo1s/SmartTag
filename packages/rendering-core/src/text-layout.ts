import type { TextObject } from '@smarttag/document-schema';
import { findMissingGlyphs, type UnicodeRange } from '@smarttag/document-utils';

type CodePointRange = readonly [from: number, to: number];

// Strong right-to-left scripts: Hebrew, Arabic, Syriac, Thaana, NKo, Arabic Extended,
// Hebrew & Arabic presentation forms.
const RTL_RANGES: readonly CodePointRange[] = [
  [0x0590, 0x08ff],
  [0xfb1d, 0xfdff],
  [0xfe70, 0xfefe],
];

// Strong left-to-right scripts commonly found on garment labels: Latin, Greek, Cyrillic,
// Indic (Devanagari, Bengali, …, Sinhala), Thai, Lao, Tibetan, Hangul, Kana, CJK ideographs.
const LTR_RANGES: readonly CodePointRange[] = [
  [0x0041, 0x005a],
  [0x0061, 0x007a],
  [0x00c0, 0x024f],
  [0x0370, 0x04ff],
  [0x0900, 0x0dff],
  [0x0e00, 0x0fff],
  [0x1100, 0x11ff],
  [0x3040, 0x30ff],
  [0x4e00, 0x9fff],
  [0xac00, 0xd7af],
];

function inRanges(codePoint: number, ranges: readonly CodePointRange[]): boolean {
  return ranges.some(([from, to]) => codePoint >= from && codePoint <= to);
}

/**
 * Resolves paragraph direction. With AUTO, the first strong directional character decides
 * (a simplification of Unicode bidi rules P2/P3). Full bidi reordering is the renderer's job.
 */
export function resolveTextDirection(
  object: Pick<TextObject, 'direction' | 'content'>,
): 'ltr' | 'rtl' {
  if (object.direction !== 'AUTO') {
    return object.direction === 'RTL' ? 'rtl' : 'ltr';
  }
  for (const char of object.content) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (inRanges(codePoint, RTL_RANGES)) return 'rtl';
    if (inRanges(codePoint, LTR_RANGES)) return 'ltr';
  }
  return 'ltr';
}

// =============================================================================================
// Text layout engine (see docs/typography.md)
//
// Every consumer that needs to know where text goes — the interactive canvas, the canonical SVG
// preview and, later, the server-side PDF renderer — calls a TextLayoutEngine. Line breaking,
// shrink-to-fit, vertical metrics and overflow detection live here once. Only the TextMeasurer
// (advance widths) is platform specific, and it must measure with the exact font file referenced
// by the text object.
// =============================================================================================

/** Vertical metrics of a font file, in font units (from the font registry). */
export interface FontMetrics {
  readonly unitsPerEm: number;
  readonly ascender: number;
  /** Negative for fonts whose descender lies below the baseline. */
  readonly descender: number;
  readonly lineGap: number;
  /** Code points the font can render; null when unknown. */
  readonly unicodeRanges: readonly UnicodeRange[] | null;
}

/** Deterministic stand-in used when no controlled font metrics are available. */
export const APPROXIMATE_FONT_METRICS: FontMetrics = {
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  lineGap: 0,
  unicodeRanges: null,
};

export interface TextRunStyle {
  readonly fontAssetId: string | null;
  readonly fontFamily: string;
  readonly fontWeight: number;
  readonly fontStyle: TextObject['fontStyle'];
  readonly fontSize: number;
  readonly direction: 'ltr' | 'rtl';
  readonly language: string | null;
}

/**
 * The single place where text is measured. Implementations must use the exact font file named by
 * `style.fontAssetId` (browser: canvas metrics after the FontFace has loaded; server: a shaping
 * engine loading the same asset). Returns the advance width in points WITHOUT letter spacing.
 */
export interface TextMeasurer {
  /** Identifies the measurement backend; recorded with layouts for diagnostics. */
  readonly id: string;
  measureLine(text: string, style: TextRunStyle): number;
}

export type FontMetricsResolver = (fontAssetId: string | null) => FontMetrics | null;

export interface TextLayoutLine {
  readonly text: string;
  /** Anchor x in trim space (start, middle or end depending on `anchor`). */
  readonly x: number;
  /** Alphabetic baseline in trim space. */
  readonly y: number;
  /** Advance width including letter spacing. */
  readonly width: number;
}

export interface TextLayout {
  readonly lines: readonly TextLayoutLine[];
  readonly anchor: 'start' | 'middle' | 'end';
  readonly direction: 'ltr' | 'rtl';
  /** Font size actually used (smaller than requested after SHRINK_TO_FIT). */
  readonly fontSize: number;
  readonly lineAdvance: number;
  /** True when text does not fit its frame. Never silent: editors and preflight report it. */
  readonly overflow: boolean;
  readonly overflowWidth: boolean;
  readonly overflowHeight: boolean;
  /** Characters the controlled font cannot render. */
  readonly missingGlyphs: readonly string[];
  readonly metricsSource: 'FONT' | 'APPROXIMATE';
  readonly measurerId: string;
}

export interface TextLayoutEngine {
  readonly measurerId: string;
  layout(object: TextObject): TextLayout;
  /** Drops cached layouts, e.g. after a font file finished loading. */
  invalidate(): void;
}

const EPSILON_PT = 0.01;
const SHRINK_PRECISION_PT = 0.01;

type Segmenter = { segment(input: string): Iterable<{ segment: string }> };
type SegmenterConstructor = new (
  locale: string | undefined,
  options: { granularity: 'grapheme' | 'word' },
) => Segmenter;

function segmenter(granularity: 'grapheme' | 'word', language: string | null): Segmenter | null {
  const Ctor = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
  if (!Ctor) return null;
  try {
    return new Ctor(language ?? undefined, { granularity });
  } catch {
    return new Ctor(undefined, { granularity });
  }
}

export function splitGraphemes(text: string, language: string | null = null): string[] {
  const s = segmenter('grapheme', language);
  return s ? Array.from(s.segment(text), (part) => part.segment) : Array.from(text);
}

/** Break opportunities: each token is a word (or other segment) plus the whitespace after it. */
function wordTokens(text: string, language: string | null): string[] {
  const s = segmenter('word', language);
  const parts = s ? Array.from(s.segment(text), (part) => part.segment) : text.split(/(?<=\s)/u);
  const tokens: string[] = [];
  for (const part of parts) {
    if (/^\s+$/u.test(part) && tokens.length > 0) {
      tokens[tokens.length - 1] += part;
    } else if (tokens.length > 0 && !/\s$/u.test(tokens[tokens.length - 1]!)) {
      // Punctuation and word parts not separated by whitespace stay together (no break inside
      // "ST-1001" or "19.99").
      tokens[tokens.length - 1] += part;
    } else {
      tokens.push(part);
    }
  }
  return tokens;
}

interface MeasuredLine {
  readonly text: string;
  readonly width: number;
}

export function createTextLayoutEngine(options: {
  readonly measurer: TextMeasurer;
  readonly resolveFontMetrics?: FontMetricsResolver;
}): TextLayoutEngine {
  const { measurer } = options;
  let cache = new WeakMap<TextObject, TextLayout>();

  function styleFor(object: TextObject, fontSize: number, direction: 'ltr' | 'rtl'): TextRunStyle {
    return {
      fontAssetId: object.fontAssetId,
      fontFamily: object.fontFamily,
      fontWeight: object.fontWeight,
      fontStyle: object.fontStyle,
      fontSize,
      direction,
      language: object.language,
    };
  }

  function lineWidth(text: string, object: TextObject, style: TextRunStyle): number {
    if (text.length === 0) return 0;
    const spacing =
      object.letterSpacing === 0
        ? 0
        : object.letterSpacing * splitGraphemes(text, object.language).length;
    return measurer.measureLine(text, style) + spacing;
  }

  function breakLines(
    object: TextObject,
    style: TextRunStyle,
  ): { lines: MeasuredLine[]; brokeInsideWord: boolean } {
    const lines: MeasuredLine[] = [];
    let brokeInsideWord = false;
    const measure = (text: string) => lineWidth(text, object, style);
    const push = (text: string) => {
      const trimmed = text.replace(/\s+$/u, '');
      lines.push({ text: trimmed, width: measure(trimmed) });
    };

    for (const paragraph of object.content.split('\n')) {
      if (object.wrap === 'NONE' || paragraph.length === 0) {
        lines.push({ text: paragraph, width: measure(paragraph) });
        continue;
      }
      let current = '';
      for (const token of wordTokens(paragraph, object.language)) {
        const candidate = current + token;
        if (measure(candidate.replace(/\s+$/u, '')) <= object.width + EPSILON_PT) {
          current = candidate;
          continue;
        }
        if (current.length > 0) {
          push(current);
          current = '';
        }
        if (measure(token.replace(/\s+$/u, '')) <= object.width + EPSILON_PT) {
          current = token;
          continue;
        }
        // A single word wider than the frame: break between grapheme clusters.
        for (const grapheme of splitGraphemes(token, object.language)) {
          if (
            current.length > 0 &&
            measure((current + grapheme).replace(/\s+$/u, '')) > object.width + EPSILON_PT
          ) {
            push(current);
            brokeInsideWord = true;
            current = grapheme.replace(/^\s+/u, '');
          } else {
            current += grapheme;
          }
        }
      }
      push(current);
    }
    return { lines, brokeInsideWord };
  }

  function fits(object: TextObject, size: number, direction: 'ltr' | 'rtl'): boolean {
    const { lines, brokeInsideWord } = breakLines(object, styleFor(object, size, direction));
    const height = lines.length * size * object.lineHeight;
    return (
      !brokeInsideWord &&
      height <= object.height + EPSILON_PT &&
      lines.every((line) => line.width <= object.width + EPSILON_PT)
    );
  }

  function compute(object: TextObject): TextLayout {
    const direction = resolveTextDirection(object);
    const resolved = options.resolveFontMetrics?.(object.fontAssetId) ?? null;
    const metrics = resolved ?? APPROXIMATE_FONT_METRICS;

    let fontSize = object.fontSize;
    if (object.overflow.mode === 'SHRINK_TO_FIT' && !fits(object, fontSize, direction)) {
      const minimum = Math.min(object.overflow.minFontSize, object.fontSize);
      if (fits(object, minimum, direction)) {
        let low = minimum;
        let high = object.fontSize;
        while (high - low > SHRINK_PRECISION_PT) {
          const middle = (low + high) / 2;
          if (fits(object, middle, direction)) low = middle;
          else high = middle;
        }
        fontSize = Math.floor(low / SHRINK_PRECISION_PT) * SHRINK_PRECISION_PT;
      } else {
        fontSize = minimum;
      }
    }

    const { lines } = breakLines(object, styleFor(object, fontSize, direction));
    const lineAdvance = fontSize * object.lineHeight;
    const blockHeight = lines.length * lineAdvance;
    const ascent = (metrics.ascender / metrics.unitsPerEm) * fontSize;
    const descent = (-metrics.descender / metrics.unitsPerEm) * fontSize;
    // CSS line box model: half-leading above and below the font's ascent + descent.
    const halfLeading = (lineAdvance - (ascent + descent)) / 2;
    const blockTop =
      object.verticalAlign === 'TOP'
        ? object.y
        : object.verticalAlign === 'MIDDLE'
          ? object.y + (object.height - blockHeight) / 2
          : object.y + object.height - blockHeight;

    const left = object.x;
    const right = object.x + object.width;
    let x: number;
    let anchor: TextLayout['anchor'];
    switch (object.textAlign) {
      case 'CENTER':
        x = object.x + object.width / 2;
        anchor = 'middle';
        break;
      case 'END':
        // the "end" of an RTL paragraph is its left edge
        x = direction === 'rtl' ? left : right;
        anchor = 'end';
        break;
      case 'START':
      case 'JUSTIFY':
        x = direction === 'rtl' ? right : left;
        anchor = 'start';
        break;
    }

    const overflowWidth = lines.some((line) => line.width > object.width + EPSILON_PT);
    const overflowHeight = blockHeight > object.height + EPSILON_PT;
    return {
      lines: lines.map((line, index) => ({
        text: line.text,
        x,
        y: blockTop + index * lineAdvance + halfLeading + ascent,
        width: line.width,
      })),
      anchor,
      direction,
      fontSize,
      lineAdvance,
      overflow: overflowWidth || overflowHeight,
      overflowWidth,
      overflowHeight,
      missingGlyphs: metrics.unicodeRanges
        ? findMissingGlyphs(metrics.unicodeRanges, object.content)
        : [],
      metricsSource: resolved ? 'FONT' : 'APPROXIMATE',
      measurerId: measurer.id,
    };
  }

  return {
    measurerId: measurer.id,
    layout(object: TextObject): TextLayout {
      const cached = cache.get(object);
      if (cached) return cached;
      const layout = compute(object);
      cache.set(object, layout);
      return layout;
    },
    invalidate() {
      cache = new WeakMap();
    },
  };
}

/**
 * Deterministic measurer for environments without font rendering (Node tests, server previews
 * before the production renderer exists). Widths are an average-glyph approximation — never use
 * it for production output.
 */
export function createApproximateTextMeasurer(): TextMeasurer {
  return {
    id: 'approximate-v1',
    measureLine(text: string, style: TextRunStyle): number {
      let width = 0;
      for (const grapheme of splitGraphemes(text, style.language)) {
        width += /^\s$/u.test(grapheme) ? 0.28 : /^[.,:;!'|iIl1]$/u.test(grapheme) ? 0.3 : 0.55;
      }
      return width * style.fontSize;
    },
  };
}

const defaultEngine = createTextLayoutEngine({ measurer: createApproximateTextMeasurer() });

/** Layout with the approximate measurer and default metrics (server previews and tests). */
export function layoutTextApproximately(object: TextObject): TextLayout {
  return defaultEngine.layout(object);
}
