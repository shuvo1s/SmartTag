import { createBwipBarcodeEncoder } from '@smarttag/barcode-bwip';
import {
  validateDesignDocument,
  type ArtworkObject,
  type DesignDocument,
} from '@smarttag/document-schema';
import {
  createBarcodeObject,
  createEllipseObject,
  createImageObject,
  createLineObject,
  createQrCodeObject,
  createRectangleObject,
  createTextObject,
  mmToPt,
  normalizeLength,
} from '@smarttag/document-utils';
import { createSampleHangTagDocument } from '@smarttag/document-utils/fixtures';
import { findPage, moveObjects, updateObject } from '@smarttag/editor-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BrowserFontRegistry, createCanvasTextMeasurer, type ArtworkFabricObject } from '../src';
import { mountCanvas, testServices } from './helpers';

function darkPixels(
  context: CanvasRenderingContext2D,
  rect: { left: number; top: number; width: number; height: number },
) {
  const data = context.getImageData(
    Math.round(rect.left),
    Math.round(rect.top),
    Math.max(1, Math.round(rect.width)),
    Math.max(1, Math.round(rect.height)),
  ).data;
  let dark = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (
      data[index]! < 80 &&
      data[index + 1]! < 80 &&
      data[index + 2]! < 80 &&
      data[index + 3]! > 200
    )
      dark += 1;
  }
  return dark;
}

describe('canvas rendering', () => {
  it('draws the page, real barcode bars and guides without Fabric objects for guides', () => {
    const { canvas } = mountCanvas(createSampleHangTagDocument());
    canvas.setViewport({ zoom: 2, panX: 100, panY: 50 });
    canvas.fabric.renderAll();
    const context = canvas.fabric.getContext();
    const barcode = canvas.objectScreenFrame('front-barcode')!;
    expect(darkPixels(context, barcode)).toBeGreaterThan(500);
    // guides are drawn on the context, not added as objects
    expect(canvas.fabric.getObjects()).toHaveLength(
      findPage(createSampleHangTagDocument(), 'page-front').objects.length,
    );
    canvas.dispose();
  });

  it('reports font, overflow and symbol issues instead of hiding them', () => {
    const document = createSampleHangTagDocument();
    document.pages[0]!.objects.push(
      createTextObject({
        id: 'overflowing',
        x: 20,
        y: 20,
        width: 10,
        height: 5,
        zIndex: 50,
        content: 'Far too long',
        wrap: 'NONE',
      }),
      createBarcodeObject({
        id: 'bad-ean',
        x: 20,
        y: 60,
        width: 80,
        height: 40,
        zIndex: 51,
        symbology: 'EAN13',
        value: '4006381333932',
      }),
    );
    const { canvas } = mountCanvas(document);
    canvas.fabric.renderAll();
    const issues = (id: string) => canvas.getFabricObject(id)!.lastIssues;
    expect(issues('overflowing')).toEqual(
      expect.arrayContaining(['TEXT_OVERFLOW', 'FONT_UNASSIGNED']),
    );
    // the sample's fonts are registry assets; the null provider cannot load them
    expect(issues('front-price')).toContain('FONT_UNAVAILABLE');
    expect(issues('bad-ean')).toEqual(['SYMBOL_INVALID']);
    expect(issues('front-barcode')).toEqual([]);
    canvas.dispose();
  });

  it('encodes each symbol once per canonical snapshot, not on every redraw', () => {
    const { store, canvas } = mountCanvas(createSampleHangTagDocument());
    const encoder = createBwipBarcodeEncoder();
    const calls = { linear: 0, qr: 0 };
    canvas.setServices({
      ...testServices(),
      barcodeEncoder: {
        ...encoder,
        supportsLinear: (symbology) => encoder.supportsLinear(symbology),
        encodeLinear: (symbology, value) => {
          calls.linear += 1;
          return encoder.encodeLinear(symbology, value);
        },
        encodeQr: (value, errorCorrection) => {
          calls.qr += 1;
          return encoder.encodeQr(value, errorCorrection);
        },
      },
    });
    for (let frame = 0; frame < 10; frame += 1) canvas.fabric.renderAll();
    const symbols = findPage(store.getState().document, 'page-front').objects.filter(
      (object) => object.type === 'barcode' || object.type === 'qrCode',
    );
    expect(symbols.length).toBeGreaterThan(0);
    expect(calls.linear + calls.qr).toBe(symbols.length);

    // A changed value is a new snapshot and is encoded again, exactly once.
    store.apply('Change barcode', (document, pageId) =>
      updateObject(document, pageId, 'front-barcode', { value: '5901234123457' }),
    );
    const before = calls.linear;
    for (let frame = 0; frame < 10; frame += 1) canvas.fabric.renderAll();
    expect(calls.linear).toBe(before + 1);
    canvas.dispose();
  });
});

describe('snapping', () => {
  it('snaps a dragged object to the page centre and can be bypassed with Alt', () => {
    const document = createSampleHangTagDocument();
    const { canvas } = mountCanvas(document);
    canvas.setViewport({ zoom: 2, panX: 0, panY: 0 });
    const logo = canvas.getFabricObject('front-logo')!;
    const centre = document.dimensions.width / 2;
    const offset = 2 / canvas.fabric.getZoom(); // 2 screen px off centre
    logo.set({ left: centre + offset });
    canvas.fabric.fire('object:moving', {
      target: logo,
      e: { altKey: false } as MouseEvent,
      transform: {} as never,
      pointer: {} as never,
    });
    expect(logo.left).toBeCloseTo(centre, 6);

    logo.set({ left: centre + offset });
    canvas.fabric.fire('object:moving', {
      target: logo,
      e: { altKey: true } as MouseEvent,
      transform: {} as never,
      pointer: {} as never,
    });
    expect(logo.left).toBeCloseTo(centre + offset, 6);
    canvas.dispose();
  });
});

describe('browser services', () => {
  it('registers exact font files under unique family names with matching descriptors', async () => {
    const added: unknown[] = [];
    const created: { family: string; source: string; descriptors: FontFaceDescriptors }[] = [];
    class FakeFontFace {
      constructor(family: string, source: string, descriptors: FontFaceDescriptors) {
        created.push({ family, source, descriptors });
      }
      load() {
        return Promise.resolve(this);
      }
    }
    const original = (globalThis as { FontFace?: unknown }).FontFace;
    (globalThis as { FontFace?: unknown }).FontFace = FakeFontFace;
    try {
      const face = {
        assetId: '0192f0a0-5b1e-7c3d-9b01-00000000f700',
        familyName: 'Noto Sans',
        weight: 700,
        style: 'NORMAL' as const,
        unitsPerEm: 1000,
        ascender: 1069,
        descender: -293,
        lineGap: 0,
        unicodeRanges: [[32, 126]] as const,
      };
      const registry = new BrowserFontRegistry([face], (id) => `/api/v1/assets/${id}/content`, {
        add: (fontFace: unknown) => added.push(fontFace),
      } as unknown as FontFaceSet);
      expect(registry.status(face.assetId)).toBe('LOADING');
      expect(registry.cssFamily(face.assetId)).toBeNull();
      expect(await registry.load(face.assetId)).toBe('LOADED');
      expect(created).toEqual([
        {
          family: `st-font-${face.assetId}`,
          source: `url("/api/v1/assets/${face.assetId}/content")`,
          descriptors: { weight: '700', style: 'normal' },
        },
      ]);
      expect(added).toHaveLength(1);
      expect(registry.cssFamily(face.assetId)).toBe(`st-font-${face.assetId}`);
      expect(registry.status(null)).toBe('UNASSIGNED');
      expect(registry.status('0192f0a0-5b1e-7c3d-9b01-0000000000ff')).toBe('UNKNOWN');
      expect(registry.metrics(face.assetId)?.ascender).toBe(1069);
    } finally {
      (globalThis as { FontFace?: unknown }).FontFace = original;
    }
  });

  it('measures with canvas metrics at a reference size and caches the result', () => {
    const measurer = createCanvasTextMeasurer({ status: () => 'LOADED', cssFamily: () => null });
    const style = {
      fontAssetId: null,
      fontFamily: 'x',
      fontWeight: 400,
      fontStyle: 'NORMAL' as const,
      fontSize: 10,
      direction: 'ltr' as const,
      language: null,
    };
    const width = measurer.measureLine('Organic Cotton Tee', style);
    expect(width).toBeGreaterThan(10);
    expect(measurer.measureLine('Organic Cotton Tee', { ...style, fontSize: 20 })).toBeCloseTo(
      width * 2,
      6,
    );
  });
});

/** A representative production document with 120 artwork objects across all types. */
function largeDocument(): DesignDocument {
  const base = createSampleHangTagDocument();
  const objects: ArtworkObject[] = [];
  const mm = mmToPt;
  for (let index = 0; index < 120; index += 1) {
    const column = index % 6;
    const row = Math.floor(index / 6);
    const frame = {
      x: mm(1 + column * 8),
      y: mm(1 + row * 4.4),
      width: mm(7),
      height: mm(4),
      zIndex: index,
      rotation: index % 7 === 0 ? 15 : 0,
    };
    const id = `perf-${index}`;
    switch (index % 7) {
      case 0:
      case 1:
        objects.push(
          createTextObject({
            ...frame,
            id,
            content: `Item ${index} — Organic cotton`,
            fontSize: 5,
            wrap: 'WORD',
          }),
        );
        break;
      case 2:
        objects.push(createRectangleObject({ ...frame, id, cornerRadius: 1 }));
        break;
      case 3:
        objects.push(
          index % 2
            ? createEllipseObject({ ...frame, id })
            : createLineObject({ ...frame, id, height: 0 }),
        );
        break;
      case 4:
        objects.push(
          createImageObject({ ...frame, id, assetId: '0192f0a0-5b1e-7c3d-9a4f-6b7c8d9e0f10' }),
        );
        break;
      case 5:
        objects.push(
          createBarcodeObject({
            ...frame,
            id,
            symbology: 'CODE128',
            value: `ST-${index}`,
            barHeight: mm(3),
            quietZone: 10,
          }),
        );
        break;
      default:
        objects.push(
          createQrCodeObject({ ...frame, id, width: mm(4), value: `https://example.com/${index}` }),
        );
    }
  }
  return { ...base, pages: [{ ...base.pages[0]!, groups: [], objects }, base.pages[1]!] };
}

describe('performance with 120 objects', () => {
  it('loads, renders and commits gestures within interactive budgets', async () => {
    const document = largeDocument();
    expect(validateDesignDocument(document).errors).toEqual([]);

    const mountStart = performance.now();
    const { store, canvas } = mountCanvas(document, { width: 1400, height: 1000 });
    const mountMs = performance.now() - mountStart;
    const firstRenderMs = canvas.renderAllTimed();
    const renderMs = canvas.renderAllTimed();

    const target = canvas.getFabricObject('perf-60') as ArtworkFabricObject;
    const commitStart = performance.now();
    target.set({ left: target.left + 12 });
    canvas.fabric.fire('object:modified', { target, action: 'drag' });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const commitMs = performance.now() - commitStart;
    expect(
      findPage(store.getState().document, 'page-front').objects.find((o) => o.id === 'perf-60')!.x,
    ).toBe(normalizeLength(target.canonical.x));

    const moveAllStart = performance.now();
    store.apply('Move all', (doc, pageId) =>
      moveObjects(
        doc,
        pageId,
        findPage(doc, pageId).objects.map((o) => o.id),
        1,
        1,
      ),
    );
    const moveAllMs = performance.now() - moveAllStart;

    const report = {
      objects: 120,
      environment: 'node-canvas (jsdom)',
      mountMs,
      firstRenderMs,
      renderMs,
      commitMs,
      moveAllMs,
    };
    const directory = resolve(__dirname, '..', 'test-results');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      resolve(directory, 'canvas-performance.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );

    expect(mountMs).toBeLessThan(3000);
    expect(renderMs).toBeLessThan(1500);
    expect(commitMs).toBeLessThan(250);
    expect(moveAllMs).toBeLessThan(500);
    canvas.dispose();
  });
});
