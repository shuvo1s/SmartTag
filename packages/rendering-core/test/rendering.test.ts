import type { DesignDocument } from '@smarttag/document-schema';
import { createTextObject, mmToPt, rgb } from '@smarttag/document-utils';
import { createSampleHangTagDocument } from '@smarttag/document-utils/fixtures';
import { describe, expect, it } from 'vitest';
import {
  PageNotFoundError,
  buildDocumentScenes,
  buildPageScene,
  colorToCss,
  isSafeImageUrl,
  renderSceneToSvg,
  resolveTextDirection,
  type TextSceneNode,
} from '../src';

function sample(): DesignDocument {
  return createSampleHangTagDocument();
}

function countTags(svg: string, tag: string): { open: number; close: number; selfClosing: number } {
  const open = (svg.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
  const selfClosing = (svg.match(new RegExp(`<${tag}\\s[^>]*/>`, 'g')) ?? []).length;
  const close = (svg.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
  return { open, close, selfClosing };
}

describe('buildPageScene', () => {
  it('derives boxes from canonical dimensions', () => {
    const scene = buildPageScene(sample(), 'page-front');
    expect(scene.boxes.trim).toEqual({ x: 0, y: 0, width: mmToPt(50), height: mmToPt(90) });
    expect(scene.boxes.bleed.x).toBeCloseTo(-mmToPt(3), 10);
    expect(scene.boxes.safe.width).toBeCloseTo(mmToPt(44), 10);
    expect(scene.trimCornerRadius).toBeCloseTo(mmToPt(4), 10);
  });

  it('orders nodes by zIndex regardless of array order', () => {
    const document = sample();
    document.pages[0]!.objects.reverse();
    const ids = buildPageScene(document, 'page-front').nodes.map((node) => node.id);
    expect(ids[0]).toBe('front-band');
    expect(ids.at(-1)).toBe('front-barcode');
  });

  it('omits hidden objects and objects in hidden groups unless requested', () => {
    const document = sample();
    const front = document.pages[0]!;
    front.objects = front.objects.map((object) => (object.id === 'front-logo' ? { ...object, visible: false } : object));
    front.groups = front.groups.map((group) => ({ ...group, visible: false }));

    const ids = buildPageScene(document, 'page-front').nodes.map((node) => node.id);
    expect(ids).not.toContain('front-logo');
    expect(ids).not.toContain('front-price'); // in hidden group
    expect(buildPageScene(document, 'page-front', { includeHidden: true }).nodes).toHaveLength(front.objects.length);
  });

  it('flags data-bound nodes', () => {
    const nodes = buildPageScene(sample(), 'page-front').nodes;
    expect(nodes.find((node) => node.id === 'front-product-name')?.dataBound).toBe(true);
    expect(nodes.find((node) => node.id === 'front-size-label')?.dataBound).toBe(false);
  });

  it('mirrors dieline features on the back side according to the flip axis', () => {
    const document = sample();
    document.dimensions.dieline.features = [{ id: 'hole', type: 'PUNCH_HOLE', center: { x: 20, y: 30 }, diameter: 10 }];
    const width = document.dimensions.width;
    const height = document.dimensions.height;

    const front = buildPageScene(document, 'page-front').dieline[0];
    const backHorizontal = buildPageScene(document, 'page-back').dieline[0];
    expect(front).toMatchObject({ cx: 20, cy: 30, radius: 5 });
    expect(backHorizontal).toMatchObject({ cx: width - 20, cy: 30 });

    document.printSettings.backSideFlip = 'VERTICAL';
    expect(buildPageScene(document, 'page-back').dieline[0]).toMatchObject({ cx: 20, cy: height - 30 });
  });

  it('lays out text lines with logical alignment', () => {
    const document = sample();
    const text = createTextObject({ id: 'multi', x: 10, y: 20, width: 100, height: 40, zIndex: 50, content: 'one\ntwo', fontSize: 10, lineHeight: 1.5, textAlign: 'END' });
    document.pages[0]!.objects.push(text);
    const node = buildPageScene(document, 'page-front').nodes.find((n) => n.id === 'multi') as TextSceneNode;
    expect(node.anchor).toBe('end');
    expect(node.lines.map((line) => line.x)).toEqual([110, 110]);
    expect(node.lines[1]!.y - node.lines[0]!.y).toBeCloseTo(15, 10);
  });

  it('resolves text direction for right-to-left scripts', () => {
    expect(resolveTextDirection({ direction: 'AUTO', content: 'صنع في بنغلاديش' })).toBe('rtl');
    expect(resolveTextDirection({ direction: 'AUTO', content: '123 বাংলাদেশ' })).toBe('ltr');
    expect(resolveTextDirection({ direction: 'AUTO', content: '— 42 —' })).toBe('ltr');
    expect(resolveTextDirection({ direction: 'RTL', content: 'abc' })).toBe('rtl');
  });

  it('throws for unknown pages and builds all pages in order', () => {
    expect(() => buildPageScene(sample(), 'nope')).toThrow(PageNotFoundError);
    expect(buildDocumentScenes(sample()).map((scene) => scene.side)).toEqual(['FRONT', 'BACK']);
  });
});

describe('colorToCss', () => {
  it('converts preview colors', () => {
    expect(colorToCss(rgb('#0B6E4F'))).toBe('#0B6E4F');
    expect(colorToCss({ space: 'CMYK', c: 0, m: 0, y: 0, k: 100 })).toBe('#000000');
    expect(colorToCss({ space: 'CMYK', c: 100, m: 0, y: 0, k: 0 })).toBe('#00FFFF');
    expect(colorToCss({ space: 'SPOT', name: 'PANTONE 186 C', tint: 50, alternate: rgb('#FF0000') })).toBe('#FF8080');
  });
});

describe('renderSceneToSvg', () => {
  it('produces a physically sized SVG whose viewBox is the bleed box', () => {
    const svg = renderSceneToSvg(buildPageScene(sample(), 'page-front'));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8.5039 -8.5039 158.7402 272.126" width="56mm" height="96mm"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    for (const tag of ['g', 'text', 'defs', 'svg']) {
      const counts = countTags(svg, tag);
      expect(counts.open - counts.selfClosing, `balanced <${tag}>`).toBe(counts.close);
    }
  });

  it('is deterministic', () => {
    const a = renderSceneToSvg(buildPageScene(sample(), 'page-back'));
    const b = renderSceneToSvg(buildPageScene(sample(), 'page-back'));
    expect(a).toBe(b);
  });

  it('draws guides that can be toggled individually', () => {
    const scene = buildPageScene(sample(), 'page-front');
    const all = renderSceneToSvg(scene);
    for (const guide of ['bleed', 'trim', 'safe', 'margins', 'dieline']) {
      expect(all).toContain(`data-guide="${guide}"`);
    }
    const none = renderSceneToSvg(scene, { guides: { bleed: false, trim: false, safe: false, margins: false, dieline: false } });
    expect(none).not.toContain('data-guide=');
  });

  it('renders symbols as labelled placeholders, never as bars', () => {
    const svg = renderSceneToSvg(buildPageScene(sample(), 'page-front'));
    expect(svg).toContain('data-object-type="barcode"');
    expect(svg).toContain('>EAN13</text>');
    expect(svg).toContain('>4006381333931</text>');
    expect(svg).toContain('>placeholder</text>');
  });

  it('escapes text content and attributes (no markup injection)', () => {
    const document = sample();
    const hostile = createTextObject({
      id: 'hostile', x: 10, y: 10, width: 100, height: 20, zIndex: 77,
      content: '</text><script>alert(1)</script><text onload="x">&',
      fontFamily: `Evil" onload="alert(1)`,
    });
    document.pages[0]!.objects.push(hostile);
    const svg = renderSceneToSvg(buildPageScene(document, 'page-front'));
    expect(svg).not.toContain('<script');

    // Because "<", ">" and quotes are escaped inside text and attribute values, every tag can be
    // tokenized safely. Each must be well-formed and must not carry an event-handler attribute.
    const tags = svg.match(/<[^>]+>/g) ?? [];
    const wellFormed = /^<\/?[A-Za-z][\w:-]*(\s+[\w:-]+="[^"<>]*")*\s*\/?>$/;
    for (const tag of tags) {
      expect(tag, 'well-formed tag').toMatch(wellFormed);
      const attributeNames = [...tag.matchAll(/\s([\w:-]+)="/g)].map((match) => match[1]!.toLowerCase());
      expect(attributeNames.filter((name) => name.startsWith('on'))).toEqual([]);
    }
    expect(svg).toContain('&lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(svg).toContain('&amp;</tspan>');
  });

  it('only embeds safe image URLs', () => {
    const scene = buildPageScene(sample(), 'page-front');
    const safe = renderSceneToSvg(scene, { resolveAssetUrl: (id) => `/api/v1/assets/${id}/content` });
    expect(safe).toMatch(/<image href="\/api\/v1\/assets\/[0-9a-f-]+\/content"/);

    const unsafe = renderSceneToSvg(scene, { resolveAssetUrl: () => 'javascript:alert(1)' });
    expect(unsafe).not.toContain('javascript:');
    expect(unsafe).toContain('>IMAGE</text>');

    expect(isSafeImageUrl('https://cdn.example.com/a.png')).toBe(true);
    expect(isSafeImageUrl('//evil.example.com/a.png')).toBe(false);
    expect(isSafeImageUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
  });

  it('masks artwork to the finished shape including punch holes', () => {
    const svg = renderSceneToSvg(buildPageScene(sample(), 'page-front'), { finish: 'TRIM', idPrefix: 'preview' });
    expect(svg).toContain('<mask id="preview-finish"');
    expect(svg).toContain('mask="url(#preview-finish)"');
    expect(svg).toMatch(/<circle cx="70.8661" cy="17.0079" r="5.6693" fill="black"\/>/);
  });

  it('marks right-to-left text and preserves non-Latin content', () => {
    const document = sample();
    document.pages[1]!.objects.push(
      createTextObject({ id: 'arabic', x: 10, y: 10, width: 100, height: 20, zIndex: 40, content: 'صنع في بنغلاديش', language: 'ar' }),
    );
    const svg = renderSceneToSvg(buildPageScene(document, 'page-back'));
    expect(svg).toContain('direction="rtl"');
    expect(svg).toContain('xml:lang="ar"');
    expect(svg).toContain('বাংলাদেশে তৈরি');
  });
});
