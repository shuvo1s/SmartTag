import { getBleedBox, validateDesignDocument } from '@smarttag/document-schema';
import { CSS_PIXELS_PER_POINT, inToPt, mmToPt } from '@smarttag/document-utils';
import { createSampleHangTagDocument } from '@smarttag/document-utils/fixtures';
import { describe, expect, it } from 'vitest';
import {
  SNAP_TOLERANCE_PX,
  addObjects,
  buildSnapTargets,
  classifyPlacement,
  createToolObject,
  duplicateOffsetPt,
  findPage,
  fitBox,
  nextZoomStep,
  nudgeDistancePt,
  placementWarning,
  pointToScreen,
  rateImageResolution,
  screenToPoint,
  snapMovingBounds,
  zoomAt,
  type ToolType,
} from '../src';

describe('snapping', () => {
  const document = createSampleHangTagDocument();
  const page = findPage(document, 'page-front');
  const targets = buildSnapTargets(document, page, new Set(['front-logo']));

  it('snaps a moving box to the page centre within a zoom-independent tolerance', () => {
    const width = 40;
    const centre = document.dimensions.width / 2;
    const zoom = 2;
    const tolerance = SNAP_TOLERANCE_PX / (zoom * CSS_PIXELS_PER_POINT);
    const bounds = { x: centre - width / 2 + tolerance * 0.8, y: 400, width, height: 10 };
    const result = snapMovingBounds(bounds, targets, tolerance);
    expect(result.dx).toBeCloseTo(-tolerance * 0.8, 10);
    expect(result.guides).toContainEqual({
      orientation: 'VERTICAL',
      position: centre,
      kind: 'PAGE_CENTER',
    });
  });

  it('snaps edges to safe-area and other objects, and ignores targets beyond tolerance', () => {
    const safeLeft = document.dimensions.safeArea.left;
    const snapped = snapMovingBounds(
      { x: safeLeft + 0.5, y: 500, width: 10, height: 10 },
      targets,
      1,
    );
    expect(snapped.dx).toBeCloseTo(-0.5, 10);
    const free = snapMovingBounds({ x: safeLeft + 5, y: 500, width: 1, height: 1 }, targets, 1);
    expect(free).toEqual({ dx: 0, dy: 0, guides: [] });
    expect(targets.vertical.some((line) => line.kind === 'OBJECT_EDGE')).toBe(true);
    // the moving object itself is never a target
    const logo = page.objects.find((o) => o.id === 'front-logo')!;
    expect(
      targets.vertical.some((line) => line.kind === 'OBJECT_EDGE' && line.position === logo.x),
    ).toBe(false);
  });
});

describe('placement', () => {
  const document = createSampleHangTagDocument();
  const page = findPage(document, 'page-front');
  const byId = (id: string) => page.objects.find((o) => o.id === id)!;

  it('classifies safe, trim, bleed and outside placements', () => {
    expect(classifyPlacement(byId('front-product-name'), document.dimensions)).toBe('INSIDE_SAFE');
    expect(classifyPlacement(byId('front-band'), document.dimensions)).toBe('INSIDE_BLEED');
    expect(placementWarning(byId('front-band'), document.dimensions)?.severity).toBe('info');
    const text = { ...byId('front-price'), x: -20 };
    expect(classifyPlacement(text, document.dimensions)).toBe('BEYOND_BLEED');
    expect(placementWarning(text, document.dimensions)?.severity).toBe('warning');
    const gone = { ...byId('front-price'), x: 1000 };
    expect(placementWarning(gone, document.dimensions)?.placement).toBe('OUTSIDE_BLEED');
  });
});

describe('viewport', () => {
  it('converts between points and screen pixels without touching geometry', () => {
    const viewport = { zoom: 1.5, panX: 40, panY: 20 };
    const point = { x: 12.5, y: 80 };
    const screen = pointToScreen(viewport, point);
    expect(screen.x).toBeCloseTo(12.5 * 1.5 * (96 / 72) + 40, 10);
    const back = screenToPoint(viewport, screen);
    expect(back.x).toBeCloseTo(point.x, 10);
    expect(back.y).toBeCloseTo(point.y, 10);
  });

  it('zooms around the pointer and clamps to 10 %–800 %', () => {
    const viewport = { zoom: 1, panX: 0, panY: 0 };
    const anchor = { x: 300, y: 200 };
    const before = screenToPoint(viewport, anchor);
    const zoomed = zoomAt(viewport, 3, anchor);
    const after = screenToPoint(zoomed, anchor);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
    expect(zoomAt(viewport, 50, anchor).zoom).toBe(8);
    expect(zoomAt(viewport, 0.001, anchor).zoom).toBe(0.1);
    expect(nextZoomStep(1, 1)).toBe(1.5);
    expect(nextZoomStep(1, -1)).toBe(0.75);
  });

  it('fits the bleed box into the viewport', () => {
    const document = createSampleHangTagDocument();
    const bleed = getBleedBox(document.dimensions);
    const viewport = fitBox(bleed, { width: 1000, height: 800 }, 'FIT_PAGE', 50);
    const topLeft = pointToScreen(viewport, { x: bleed.x, y: bleed.y });
    const bottomRight = pointToScreen(viewport, {
      x: bleed.x + bleed.width,
      y: bleed.y + bleed.height,
    });
    expect(bottomRight.y - topLeft.y).toBeCloseTo(700, 6);
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(500, 6);
  });

  it('uses documented physical nudge and duplicate distances', () => {
    expect(nudgeDistancePt('mm', false)).toBeCloseTo(mmToPt(0.25), 10);
    expect(nudgeDistancePt('mm', true)).toBeCloseTo(mmToPt(1), 10);
    expect(nudgeDistancePt('in', false)).toBeCloseTo(inToPt(0.01), 10);
    expect(nudgeDistancePt('pt', true)).toBe(10);
    expect(duplicateOffsetPt('mm')).toBeCloseTo(mmToPt(2), 10);
  });
});

describe('tool objects', () => {
  it('creates valid objects with fresh ids in the centre of the artboard', () => {
    let document = createSampleHangTagDocument();
    const tools: ToolType[] = [
      'text',
      'rectangle',
      'ellipse',
      'line',
      'barcode',
      'qrCode',
      'image',
    ];
    const created = tools.map((tool) => createToolObject(tool, document));
    expect(new Set(created.map((o) => o.id)).size).toBe(tools.length);
    document = addObjects(document, 'page-front', created);
    expect(validateDesignDocument(document).errors).toEqual([]);
    for (const object of created) {
      expect(object.x + object.width / 2).toBeCloseTo(document.dimensions.width / 2, 3);
    }
  });

  it('fits images inside the safe area using the asset aspect ratio and rates resolution', () => {
    const document = createSampleHangTagDocument();
    const image = createToolObject('image', document, {
      asset: {
        id: '0192f0a0-5b1e-7c3d-8a4f-000000000001',
        filename: 'wide.png',
        widthPx: 2000,
        heightPx: 500,
      },
    });
    expect(image.width / image.height).toBeCloseTo(4, 3);
    expect(image.width).toBeLessThanOrEqual(document.dimensions.width);
    if (image.type !== 'image') throw new Error('expected image');
    const report = rateImageResolution(image, {
      widthPx: 2000,
      heightPx: 500,
      mimeType: 'image/png',
    });
    expect(report?.rating).toBe('GOOD');
    expect(
      rateImageResolution(image, { widthPx: 100, heightPx: 25, mimeType: 'image/png' })?.rating,
    ).toBe('LOW');
    expect(
      rateImageResolution(image, { widthPx: null, heightPx: null, mimeType: 'image/svg+xml' }),
    ).toBeNull();
  });
});
