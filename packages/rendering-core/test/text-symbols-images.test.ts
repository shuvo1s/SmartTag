import { createBwipBarcodeEncoder } from '@smarttag/barcode-bwip';
import type { TextObject } from '@smarttag/document-schema';
import {
  createBarcodeObject,
  createImageObject,
  createQrCodeObject,
  createTextObject,
  toUnicodeRanges,
} from '@smarttag/document-utils';
import { createSampleHangTagDocument } from '@smarttag/document-utils/fixtures';
import { describe, expect, it } from 'vitest';
import {
  buildPageGuides,
  buildPageScene,
  computeImagePlacement,
  createTextLayoutEngine,
  renderSceneToSvg,
  type BarcodeSceneNode,
  type FontMetrics,
  type QrCodeSceneNode,
  type TextMeasurer,
  type TextSceneNode,
} from '../src';

/** Every grapheme is exactly 0.5 em wide: layouts become easy to reason about. */
const monospace: TextMeasurer = {
  id: 'test-monospace',
  measureLine: (text, style) => [...text].length * 0.5 * style.fontSize,
};

const text = (overrides: Partial<TextObject>): TextObject =>
  createTextObject({ x: 10, y: 20, width: 50, height: 40, zIndex: 0, fontSize: 10, ...overrides });

describe('text layout engine', () => {
  const engine = createTextLayoutEngine({ measurer: monospace });

  it('wraps at word boundaries within the frame width (5 pt per character at 10 pt)', () => {
    const layout = engine.layout(text({ content: 'Organic Cotton Tee', wrap: 'WORD', width: 45 }));
    expect(layout.lines.map((line) => line.text)).toEqual(['Organic', 'Cotton', 'Tee']);
    expect(layout.overflow).toBe(false);
    expect(layout.lines.every((line) => line.width <= 45)).toBe(true);
    // exactly filling the frame is not overflow
    expect(engine.layout(text({ content: 'Cotton Tee', wrap: 'WORD' })).lines).toHaveLength(1);
  });

  it('keeps explicit lines only with wrap NONE and reports width overflow', () => {
    const layout = engine.layout(text({ content: 'Organic Cotton Tee', wrap: 'NONE' }));
    expect(layout.lines.map((line) => line.text)).toEqual(['Organic Cotton Tee']);
    expect(layout).toMatchObject({ overflow: true, overflowWidth: true, overflowHeight: false });
  });

  it('never breaks inside "ST-1001" or "19.99" but breaks an over-long word by graphemes', () => {
    expect(
      engine.layout(text({ content: 'Style ST-1001', wrap: 'WORD' })).lines.map((l) => l.text),
    ).toEqual(['Style', 'ST-1001']);
    const long = engine.layout(
      text({ content: 'Supercalifragilistic', wrap: 'WORD', height: 100 }),
    );
    expect(long.lines.map((l) => l.text)).toEqual(['Supercalif', 'ragilistic']);
  });

  it('reports height overflow instead of silently truncating', () => {
    const layout = engine.layout(
      text({ content: 'one two three four five six', wrap: 'WORD', height: 20, lineHeight: 1.2 }),
    );
    expect(layout.lines.length * 12).toBeGreaterThan(20);
    expect(layout).toMatchObject({ overflow: true, overflowHeight: true });
  });

  it('shrinks to fit down to the minimum size, and flags overflow when even that is too big', () => {
    const shrunk = engine.layout(
      text({
        content: 'Organic Cotton Tee',
        wrap: 'NONE',
        overflow: { mode: 'SHRINK_TO_FIT', minFontSize: 4 },
      }),
    );
    // 18 characters × 0.5 em must fit 50 pt → size ≤ 5.555…
    expect(shrunk.fontSize).toBeLessThanOrEqual(50 / 9);
    expect(shrunk.fontSize).toBeGreaterThan(50 / 9 - 0.02);
    expect(shrunk.overflow).toBe(false);

    const tooBig = engine.layout(
      text({
        content: 'Organic Cotton Tee',
        wrap: 'NONE',
        overflow: { mode: 'SHRINK_TO_FIT', minFontSize: 8 },
      }),
    );
    expect(tooBig).toMatchObject({ fontSize: 8, overflow: true });
  });

  it('places baselines with the font metrics of the controlled font (CSS half-leading)', () => {
    const metrics: FontMetrics = {
      unitsPerEm: 1000,
      ascender: 1069,
      descender: -293,
      lineGap: 0,
      unicodeRanges: toUnicodeRanges([...'ABC abc'].map((c) => c.codePointAt(0)!)),
    };
    const withFont = createTextLayoutEngine({
      measurer: monospace,
      resolveFontMetrics: (id) => (id === 'font-1' ? metrics : null),
    });
    const object = text({ content: 'abc', fontAssetId: 'font-1', lineHeight: 1.5, wrap: 'NONE' });
    const layout = withFont.layout(object);
    const halfLeading = (15 - (10.69 + 2.93)) / 2;
    expect(layout.lines[0]!.y).toBeCloseTo(20 + halfLeading + 10.69, 10);
    expect(layout.metricsSource).toBe('FONT');
    expect(
      withFont.layout(text({ content: 'abc বাংলা', fontAssetId: 'font-1' })).missingGlyphs,
    ).toEqual(['ব', 'া', 'ং', 'ল']);
  });

  it('adds letter spacing after every grapheme cluster', () => {
    const layout = engine.layout(text({ content: 'SIZE', letterSpacing: 0.4, wrap: 'NONE' }));
    expect(layout.lines[0]!.width).toBeCloseTo(4 * 5 + 4 * 0.4, 10);
  });

  it('caches per immutable object and recomputes after invalidation', () => {
    let calls = 0;
    const counting = createTextLayoutEngine({
      measurer: { id: 'count', measureLine: (t, s) => (calls++, monospace.measureLine(t, s)) },
    });
    const object = text({ content: 'cache me', wrap: 'NONE' });
    counting.layout(object);
    const afterFirst = calls;
    counting.layout(object);
    expect(calls).toBe(afterFirst);
    counting.invalidate();
    counting.layout(object);
    expect(calls).toBeGreaterThan(afterFirst);
  });
});

describe('scene symbols with an injected encoder', () => {
  const encoder = createBwipBarcodeEncoder();

  it('renders real EAN-13 bars and QR modules instead of placeholders', () => {
    const document = createSampleHangTagDocument();
    const front = buildPageScene(document, 'page-front', { barcodeEncoder: encoder });
    const barcode = front.nodes.find((node) => node.kind === 'barcode') as BarcodeSceneNode;
    expect(barcode.symbolStatus).toBe('ENCODED');
    expect(barcode.symbol?.bars.length).toBeGreaterThan(20);
    const svg = renderSceneToSvg(front);
    expect(svg).toContain('data-symbol="bars"');
    expect(svg).not.toContain('>placeholder</text>');
    expect(svg).toContain('>006381</text>');

    const back = buildPageScene(document, 'page-back', { barcodeEncoder: encoder });
    const qr = back.nodes.find((node) => node.kind === 'qrCode') as QrCodeSceneNode;
    expect(qr.symbolStatus).toBe('ENCODED');
    expect(renderSceneToSvg(back)).toContain('data-symbol="modules"');
  });

  it('shows a labelled placeholder with the validation message for invalid values', () => {
    const document = createSampleHangTagDocument();
    document.pages[0]!.objects.push(
      createBarcodeObject({
        id: 'bad',
        x: 0,
        y: 0,
        width: 80,
        height: 40,
        zIndex: 90,
        symbology: 'EAN13',
        value: '4006381333932',
      }),
      createBarcodeObject({
        id: 'itf',
        x: 0,
        y: 0,
        width: 80,
        height: 40,
        zIndex: 91,
        symbology: 'ITF14',
        value: '15400141288763',
      }),
      createQrCodeObject({
        id: 'empty-qr',
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        zIndex: 92,
        value: '',
      }),
    );
    const scene = buildPageScene(document, 'page-front', { barcodeEncoder: encoder });
    const byId = (id: string) => scene.nodes.find((node) => node.id === id) as BarcodeSceneNode;
    expect(byId('bad')).toMatchObject({ symbolStatus: 'INVALID_VALUE', symbol: null });
    expect(byId('itf')).toMatchObject({ symbolStatus: 'NOT_ENABLED', symbol: null });
    expect(byId('empty-qr')).toMatchObject({ symbolStatus: 'INVALID_VALUE' });
    const svg = renderSceneToSvg(scene, { showIssues: true });
    expect(svg).toContain('invalid: Check digit should be 1');
    expect(svg).toContain('preview not enabled');
    expect(svg).toContain('data-highlight="issue"');
  });
});

describe('text and image rendering details', () => {
  it('uses the resolved controlled font family and marks overflowing text', () => {
    const document = createSampleHangTagDocument();
    document.pages[0]!.objects.push(
      createTextObject({
        id: 'long',
        x: 10,
        y: 10,
        width: 20,
        height: 5,
        zIndex: 99,
        content: 'A very long line',
        wrap: 'NONE',
        fontAssetId: '0192f0a0-5b1e-7c3d-9b01-00000000f400',
      }),
    );
    const scene = buildPageScene(document, 'page-front');
    const node = scene.nodes.find((n) => n.id === 'long') as TextSceneNode;
    expect(node.overflow).toBe(true);
    const svg = renderSceneToSvg(scene, {
      resolveFontFamily: (n) => (n.fontAssetId ? `st-font-${n.fontAssetId}` : null),
    });
    expect(svg).toContain('font-family="&apos;st-font-0192f0a0-5b1e-7c3d-9b01-00000000f400&apos;"');
    expect(svg).toContain('data-overflow="true"');
  });

  it('computes contain, cover, stretch and crop placements', () => {
    const frame = { width: 100, height: 50 };
    const source = { width: 400, height: 400 };
    expect(computeImagePlacement(frame, source, 'CONTAIN', null)).toEqual({
      source: { x: 0, y: 0, width: 400, height: 400 },
      destination: { x: 25, y: 0, width: 50, height: 50 },
      clip: false,
    });
    expect(computeImagePlacement(frame, source, 'COVER', null).destination).toEqual({
      x: 0,
      y: -25,
      width: 100,
      height: 100,
    });
    expect(computeImagePlacement(frame, source, 'STRETCH', null).destination).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
    const cropped = computeImagePlacement(frame, source, 'CONTAIN', {
      x: 0,
      y: 0.5,
      width: 1,
      height: 0.5,
    });
    expect(cropped).toEqual({
      source: { x: 0, y: 200, width: 400, height: 200 },
      destination: { x: 0, y: 0, width: 100, height: 50 },
      clip: false,
    });
  });

  it('applies crops in SVG when the intrinsic image size is known', () => {
    const document = createSampleHangTagDocument();
    const assetId = '0192f0a0-5b1e-7c3d-8a4f-000000000009';
    document.pages[0]!.objects.push(
      createImageObject({
        id: 'cropped',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        zIndex: 95,
        assetId,
        fitMode: 'COVER',
        crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
      }),
    );
    const svg = renderSceneToSvg(buildPageScene(document, 'page-front'), {
      resolveAssetUrl: (id) => `/api/v1/assets/${id}/content`,
      resolveAssetSize: (id) => (id === assetId ? { width: 800, height: 400 } : null),
    });
    expect(svg).toContain('viewBox="200 0 400 400"');
  });
});

describe('page guides', () => {
  it('match the scene boxes and mirrored dieline without building nodes', () => {
    const document = createSampleHangTagDocument();
    const guides = buildPageGuides(document, 'page-back');
    const scene = buildPageScene(document, 'page-back');
    expect(guides.boxes).toEqual(scene.boxes);
    expect(guides.dieline).toEqual(scene.dieline);
    expect(guides).not.toHaveProperty('nodes');
  });
});
