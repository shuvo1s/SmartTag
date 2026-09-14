import type { FontLoadStatus, FontProvider } from '@smarttag/canvas-adapter';
import { createTextObject } from '@smarttag/document-utils';
import { createSampleHangTagDocument } from '@smarttag/document-utils/fixtures';
import { describe, expect, it } from 'vitest';
import { summarizeFontAvailability } from './font-availability';

function provider(statuses: Record<string, FontLoadStatus>): FontProvider {
  return {
    status: (id) => (id === null ? 'UNASSIGNED' : (statuses[id] ?? 'UNKNOWN')),
    cssFamily: (id) => (id && statuses[id] === 'LOADED' ? `st-font-${id}` : null),
  };
}

describe('summarizeFontAvailability', () => {
  const text = (id: string, fontAssetId: string | null, extra: object = {}) =>
    createTextObject({
      id,
      x: 0,
      y: 0,
      width: 50,
      height: 10,
      zIndex: 0,
      content: 'Text',
      fontAssetId,
      fontFamily: 'Brand Sans',
      fontWeight: 400,
      ...extra,
    });

  function documentWith(objects: ReturnType<typeof text>[]) {
    const document = createSampleHangTagDocument();
    document.pages[0]!.objects = objects.map((object, zIndex) => ({ ...object, zIndex }));
    document.pages[0]!.groups = [];
    document.pages[1]!.objects = [];
    document.pages[1]!.groups = [];
    return document;
  }

  it('reports only text that is not drawn with its exact loaded font, grouped by reason', () => {
    const document = documentWith([
      text('loaded', 'a'),
      text('loading', 'b'),
      text('failed-1', 'c'),
      text('failed-2', 'c'),
      text('unknown', 'z'),
      text('unassigned', null),
      text('empty', null, { content: '' }),
    ]);
    const result = summarizeFontAvailability(
      document,
      provider({ a: 'LOADED', b: 'LOADING', c: 'FAILED' }),
    );
    expect(result.loading).toBe(1);
    expect(result.substitutes).toEqual([
      {
        fontFamily: 'Brand Sans',
        fontWeight: 400,
        reason: 'FAILED',
        objectIds: ['failed-1', 'failed-2'],
      },
      { fontFamily: 'Brand Sans', fontWeight: 400, reason: 'UNKNOWN', objectIds: ['unknown'] },
      {
        fontFamily: 'Brand Sans',
        fontWeight: 400,
        reason: 'UNASSIGNED',
        objectIds: ['unassigned'],
      },
    ]);
  });

  it('treats a view without a font registry as substituting every text', () => {
    const result = summarizeFontAvailability(documentWith([text('a', 'a')]), null);
    expect(result.substitutes).toEqual([
      { fontFamily: 'Brand Sans', fontWeight: 400, reason: 'NOT_LOADED', objectIds: ['a'] },
    ]);
  });

  it('is empty when every font is loaded', () => {
    const result = summarizeFontAvailability(
      documentWith([text('a', 'a')]),
      provider({ a: 'LOADED' }),
    );
    expect(result).toEqual({ loading: 0, substitutes: [] });
  });
});
