import { findMissingGlyphs } from '@smarttag/shared-types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectMimeType } from './asset-content-inspector';
import { inspectFont } from './font-inspector';

const font = (file: string) =>
  readFileSync(resolve(__dirname, '../../../prisma/seed-assets/fonts', file));

describe('inspectFont', () => {
  it('reads family, weight, style, metrics and coverage from the file', () => {
    const buffer = font('NotoSans-Regular.ttf');
    expect(detectMimeType(buffer)).toBe('font/ttf');
    const result = inspectFont(buffer, 'font/ttf');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.font).toMatchObject({
      familyName: 'Noto Sans',
      subfamilyName: 'Regular',
      postscriptName: 'NotoSans-Regular',
      fontVersion: 'Version 2.015',
      weight: 400,
      style: 'NORMAL',
      format: 'TTF',
      embeddingPermission: 'INSTALLABLE',
      unitsPerEm: 1000,
      ascender: 1069,
      descender: -293,
      lineGap: 0,
      capHeight: 714,
    });
    expect(findMissingGlyphs(result.font.unicodeRanges, 'Organic Cotton Tee — 19,99 €')).toEqual(
      [],
    );
    expect(findMissingGlyphs(result.font.unicodeRanges, 'বাংলাদেশে')).not.toEqual([]);
  });

  it('uses the typographic family for non-RIBBI weights (name IDs 16/17)', () => {
    const result = inspectFont(font('NotoSans-SemiBold.ttf'), 'font/ttf');
    expect(result).toMatchObject({
      ok: true,
      font: { familyName: 'Noto Sans', subfamilyName: 'SemiBold', weight: 600 },
    });
  });

  it('covers the Bengali script with the Bengali face', () => {
    const result = inspectFont(font('NotoSansBengali-Regular.ttf'), 'font/ttf');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.font.familyName).toBe('Noto Sans Bengali');
    expect(findMissingGlyphs(result.font.unicodeRanges, 'বাংলাদেশে তৈরি')).toEqual([]);
  });

  it('refuses unreadable, truncated and non-font content', () => {
    expect(inspectFont(Buffer.from('not a font at all'), 'font/ttf')).toMatchObject({ ok: false });
    expect(inspectFont(font('NotoSans-Bold.ttf').subarray(0, 1024), 'font/ttf')).toMatchObject({
      ok: false,
    });
    expect(inspectFont(font('NotoSans-Bold.ttf'), 'image/png')).toMatchObject({ ok: false });
  });
});
