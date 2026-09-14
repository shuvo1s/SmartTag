import type { TextObject } from '@smarttag/document-schema';
import type { SceneTextLine, TextSceneNode } from './scene';

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
export function resolveTextDirection(object: Pick<TextObject, 'direction' | 'content'>): 'ltr' | 'rtl' {
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

/** Approximate ascent as a fraction of the em box, used until real font metrics are available. */
const APPROXIMATE_ASCENT = 0.8;

/**
 * Places explicit lines ("\n") inside the text frame.
 *
 * Phase 1 limitation (intentional): no automatic line wrapping, shaping, kerning or fitting —
 * those require font metrics and belong to the server-side renderer. The layout here is a
 * deterministic approximation for previews.
 */
export function layoutTextLines(object: TextObject, direction: 'ltr' | 'rtl'): Pick<TextSceneNode, 'lines' | 'anchor'> {
  const rawLines = object.content.split('\n');
  const lineAdvance = object.fontSize * object.lineHeight;
  const blockHeight = rawLines.length * lineAdvance;

  const blockTop =
    object.verticalAlign === 'TOP'
      ? object.y
      : object.verticalAlign === 'MIDDLE'
        ? object.y + (object.height - blockHeight) / 2
        : object.y + object.height - blockHeight;
  const firstBaseline = blockTop + (lineAdvance - object.fontSize) / 2 + object.fontSize * APPROXIMATE_ASCENT;

  const left = object.x;
  const right = object.x + object.width;
  let x: number;
  let anchor: TextSceneNode['anchor'];
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

  const lines: SceneTextLine[] = rawLines.map((text, index) => ({ text, x, y: firstBaseline + index * lineAdvance }));
  return { lines, anchor };
}
