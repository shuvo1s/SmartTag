import type {
  FieldBinding,
  Insets,
  RgbColor,
  StaticBinding,
  Stroke,
} from '@smarttag/document-schema';

export function staticBinding(): StaticBinding {
  return { mode: 'STATIC' };
}

export function fieldBinding(field: string): FieldBinding {
  return { mode: 'FIELD', field };
}

/** Creates a canonical RGB color. Accepts "#rgb", "#rrggbb" in any case. */
export function rgb(hex: string): RgbColor {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) {
    throw new RangeError(`"${hex}" is not a valid hex color`);
  }
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join('') : match[1];
  return { space: 'RGB', hex: `#${digits.toUpperCase()}` };
}

export function uniformInsets(value: number): Insets {
  return { top: value, right: value, bottom: value, left: value };
}

export function solidStroke(color: RgbColor, width: number): Stroke {
  return { color, width, dashPattern: [], lineCap: 'BUTT', lineJoin: 'MITER' };
}

export const BLACK: RgbColor = { space: 'RGB', hex: '#000000' };
export const WHITE: RgbColor = { space: 'RGB', hex: '#FFFFFF' };

/**
 * Default family name. Noto Sans has companion families covering Bengali, Arabic, CJK and more,
 * which matters for multi-language garment labelling. The exact font file is identified by a
 * text object's `fontAssetId`; the family name alone never selects a font for production.
 */
export const DEFAULT_FONT_FAMILY = 'Noto Sans';
