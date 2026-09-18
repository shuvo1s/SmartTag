import { describe, expect, it } from 'vitest';
import type { FontFaceDto } from '@smarttag/shared-types';
import { filterFontFaces, formatBytes, groupFontFaces } from './font-library-model';

function face(overrides: Partial<FontFaceDto> = {}): FontFaceDto {
  return {
    assetId: crypto.randomUUID(),
    filename: 'NotoSans-Regular.ttf',
    checksumSha256: 'a'.repeat(64),
    sizeBytes: 1024,
    familyName: 'Noto Sans',
    subfamilyName: 'Regular',
    fullName: 'Noto Sans Regular',
    postscriptName: 'NotoSans-Regular',
    fontVersion: 'Version 1.0',
    weight: 400,
    style: 'NORMAL',
    format: 'TTF',
    embeddingPermission: 'INSTALLABLE',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    lineGap: 0,
    capHeight: 700,
    xHeight: 500,
    glyphCount: 1000,
    unicodeRanges: [[32, 126]],
    createdAt: '2026-09-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('font library model', () => {
  it('groups faces by family and orders faces by weight', () => {
    const groups = groupFontFaces([
      face({ assetId: 'b', weight: 700, subfamilyName: 'Bold' }),
      face({ assetId: 'a', weight: 400 }),
      face({ assetId: 'c', familyName: 'Roboto', postscriptName: 'Roboto-Regular' }),
    ]);
    expect(groups.map((group) => group.familyName)).toEqual(['Noto Sans', 'Roboto']);
    expect(groups[0]?.faces.map((item) => item.weight)).toEqual([400, 700]);
  });

  it('searches metadata and filters embedding permissions', () => {
    const faces = [
      face(),
      face({
        assetId: 'restricted',
        familyName: 'Licensed Serif',
        filename: 'licensed.otf',
        format: 'OTF',
        embeddingPermission: 'RESTRICTED',
      }),
    ];
    expect(filterFontFaces(faces, 'licensed', 'ALL')).toHaveLength(1);
    expect(filterFontFaces(faces, '', 'RESTRICTED')).toHaveLength(1);
    expect(filterFontFaces(faces, 'noto', 'RESTRICTED')).toHaveLength(0);
  });

  it('formats file sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});
