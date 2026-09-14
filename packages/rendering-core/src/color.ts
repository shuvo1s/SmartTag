import type { CmykColor, Color, RgbColor, Stroke } from '@smarttag/document-schema';
import type { SceneStroke } from './scene';

/**
 * Screen-preview color conversion. CMYK and spot colors are approximated with a naive,
 * profile-less formula — adequate for on-screen previews, NOT for proofing. Color-managed
 * (ICC-based) conversion belongs to the production PDF renderer.
 */
export function colorToCss(color: Color): string {
  switch (color.space) {
    case 'RGB':
      return color.hex;
    case 'CMYK':
      return cmykToHex(color);
    case 'SPOT': {
      const alternate: RgbColor | CmykColor = color.alternate;
      const base = alternate.space === 'RGB' ? alternate.hex : cmykToHex(alternate);
      return color.tint >= 100 ? base : mixWithWhite(base, color.tint / 100);
    }
  }
}

function cmykToHex({ c, m, y, k }: CmykColor): string {
  const channel = (value: number) => Math.round(255 * (1 - value / 100) * (1 - k / 100));
  return toHex(channel(c), channel(m), channel(y));
}

function mixWithWhite(hex: string, amount: number): string {
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
  const mix = (value: number) => Math.round(255 - (255 - value) * amount);
  return toHex(mix(r), mix(g), mix(b));
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

export function strokeToScene(stroke: Stroke): SceneStroke {
  return {
    color: colorToCss(stroke.color),
    width: stroke.width,
    dash: stroke.dashPattern,
    lineCap: stroke.lineCap.toLowerCase() as SceneStroke['lineCap'],
    lineJoin: stroke.lineJoin.toLowerCase() as SceneStroke['lineJoin'],
  };
}
