import { parseDesignDocument, type DesignDocument } from '@smarttag/document-schema';
import { computeDocumentHash, lengthsEqual, normalizeLength } from '@smarttag/document-utils';
import {
  SAMPLE_HANG_TAG_V1_JSON,
  createSampleHangTagDocument,
} from '@smarttag/document-utils/fixtures';
import { findPage } from '@smarttag/editor-core';
import { ActiveSelection } from 'fabric';
import { describe, expect, it } from 'vitest';
import { createArtworkFabricObject, measureFabricFrame, type ArtworkFabricObject } from '../src';
import { everyObjectType, mountCanvas, testServices } from './helpers';

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

/** Canonical document with the canvas read-back of every page substituted in. */
function readBackDocument(document: DesignDocument): DesignDocument {
  const { store, canvas } = mountCanvas(document);
  const pages = document.pages.map((page) => {
    store.setActivePage(page.id);
    return canvas.readPage();
  });
  canvas.dispose();
  return { ...document, pages };
}

describe('Canonical → Fabric → Canonical, per object type', () => {
  const services = testServices();

  it.each(everyObjectType().map((object) => [object.type, object] as const))(
    '%s keeps id, type, geometry, rotation, opacity, visibility, lock, z-order, appearance and bindings',
    (_type, object) => {
      const fabricObject = createArtworkFabricObject(object, services, {
        locked: object.locked,
        visible: object.visible,
        readOnly: false,
      });
      // Fabric carries only transforms: centre origin, unit scale, no skew.
      expect(fabricObject).toMatchObject({
        originX: 'center',
        originY: 'center',
        width: object.width,
        height: object.height,
        angle: object.rotation,
        scaleX: 1,
        scaleY: 1,
        skewX: 0,
        skewY: 0,
        visible: object.visible,
        lockMovementX: object.locked,
      });
      const back = fabricObject.readCanonical();
      // Unchanged geometry returns the very same canonical object: no value can drift.
      expect(back).toBe(object);
      expect(JSON.stringify(back)).toBe(JSON.stringify(object));
    },
  );

  it('recomputed frames stay within half the rounding unit of the stored values', () => {
    for (const object of everyObjectType()) {
      const measured = measureFabricFrame(createArtworkFabricObject(object, services));
      expect(lengthsEqual(measured.x, object.x)).toBe(true);
      expect(lengthsEqual(measured.y, object.y)).toBe(true);
      expect(lengthsEqual(measured.width, object.width)).toBe(true);
      expect(lengthsEqual(measured.height, object.height)).toBe(true);
      expect(measured.unsupported).toBe(false);
    }
  });
});

describe('complete documents', () => {
  it('reads the sample hang tag back unchanged with an identical hash (front and back)', async () => {
    const document = createSampleHangTagDocument();
    const back = readBackDocument(document);
    back.pages.forEach((page, index) => expect(page).toBe(document.pages[index]));
    expect(await computeDocumentHash(back)).toBe(await computeDocumentHash(document));
  });

  it('keeps a migrated schema v1 document stable too', async () => {
    const parsed = parseDesignDocument(SAMPLE_HANG_TAG_V1_JSON);
    if (!parsed.valid) throw new Error('fixture invalid');
    const back = readBackDocument(parsed.document);
    expect(await computeDocumentHash(back)).toBe(await computeDocumentHash(parsed.document));
  });

  it('does not drift over repeated open → canvas → save cycles', async () => {
    const original = createSampleHangTagDocument();
    const hash = await computeDocumentHash(original);
    let document = original;
    for (let cycle = 0; cycle < 20; cycle += 1) {
      document = JSON.parse(JSON.stringify(readBackDocument(document))) as DesignDocument;
    }
    expect(await computeDocumentHash(document)).toBe(hash);
  });

  it('keeps every object type stable in a document context', async () => {
    const base = createSampleHangTagDocument();
    const document: DesignDocument = {
      ...base,
      pages: [
        {
          ...base.pages[0]!,
          groups: [{ id: 'grp-rt', name: 'Round trip', visible: true, locked: false }],
          objects: everyObjectType(),
        },
        base.pages[1]!,
      ],
    };
    expect(await computeDocumentHash(readBackDocument(document))).toBe(
      await computeDocumentHash(document),
    );
  });
});

describe('zoom and pan never change canonical geometry', () => {
  it('reads identical canonical pages at every zoom level and pan', async () => {
    const document = createSampleHangTagDocument();
    const { store, canvas } = mountCanvas(document);
    const hash = await computeDocumentHash(document);
    for (const [zoom, panX, panY] of [
      [0.1, 0, 0],
      [0.37, -120.5, 33.25],
      [1, 400, 400],
      [2.5, -900, -1200],
      [8, 13.7, -4000],
    ] as const) {
      canvas.setViewport({ zoom, panX, panY });
      canvas.fabric.renderAll();
      expect(canvas.fabric.getZoom()).toBeCloseTo(zoom * (96 / 72), 10);
      expect(canvas.readPage()).toBe(findPage(document, 'page-front'));
    }
    canvas.zoomTo(10_000);
    expect(canvas.getViewport().zoom).toBe(8);
    canvas.zoomTo(0);
    expect(canvas.getViewport().zoom).toBe(0.1);
    expect(store.getState().document).toBe(document);
    expect(store.getState().changeCount).toBe(0);
    expect(await computeDocumentHash(store.getState().document)).toBe(hash);
    canvas.dispose();
  });
});

describe('transforms read back into normalized canonical geometry', () => {
  const services = testServices();
  const [text, , rect, , line] = everyObjectType();

  it('move changes only x/y and normalizes them', () => {
    const fabricObject = createArtworkFabricObject(rect!, services);
    fabricObject.set({ left: fabricObject.left + 10.123456789, top: fabricObject.top - 0.000001 });
    const back = fabricObject.readCanonical();
    expect(back.x).toBe(normalizeLength(rect!.x + 10.123456789));
    expect(back.y).toBe(rect!.y); // below half the rounding unit: stored value kept
    expect(back.width).toBe(rect!.width);
    expect(back.rotation).toBe(rect!.rotation);
    expect(String(back.x).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });

  it('resize bakes scale into width/height (Fabric scale never reaches the document)', () => {
    const fabricObject = createArtworkFabricObject(rect!, services);
    fabricObject.set({ scaleX: 1.5 });
    const back = fabricObject.readCanonical();
    expect(back.width).toBe(normalizeLength(rect!.width * 1.5));
    expect(back.height).toBe(rect!.height);
    // resizing about the centre shifts x by half the growth
    expect(back.x).toBe(normalizeLength(rect!.x - (rect!.width * 0.5) / 2));
  });

  it('rotation is normalized to [0, 360) and keeps the frame', () => {
    const fabricObject = createArtworkFabricObject(text!, services);
    fabricObject.set({ angle: -26.66666666666 });
    const back = fabricObject.readCanonical();
    expect(back.rotation).toBe(333.3333);
    expect(back.x).toBe(text!.x);
    expect(back.width).toBe(text!.width);
  });

  it('lines keep a zero-height frame when stretched along their length', () => {
    const fabricObject = createArtworkFabricObject(line!, services);
    fabricObject.set({ scaleX: 0.5 });
    const back = fabricObject.readCanonical();
    expect(back.height).toBe(0);
    expect(back.width).toBe(normalizeLength(line!.width / 2));
  });

  it('reads absolute frames of objects inside a moved and rotated active selection', () => {
    const { store, canvas } = mountCanvas(createSampleHangTagDocument());
    const a = canvas.getFabricObject('front-size')!;
    const b = canvas.getFabricObject('front-price')!;
    const before = [a.readCanonical(), b.readCanonical()];
    const selection = new ActiveSelection([a, b], { canvas: canvas.fabric });
    canvas.fabric.setActiveObject(selection);
    selection.set({ left: selection.left + 5 });
    selection.setCoords();
    const moved = [a.readCanonical(), b.readCanonical()];
    moved.forEach((object, index) => {
      expect(object.x).toBe(normalizeLength(before[index]!.x + 5));
      expect(object.y).toBe(before[index]!.y);
      expect(object.rotation).toBe(0);
    });

    selection.set({ angle: 90 });
    selection.setCoords();
    const center = selection.getCenterPoint();
    const rotated = a.readCanonical();
    expect(rotated.rotation).toBe(90);
    const aCenter = { x: moved[0]!.x + moved[0]!.width / 2, y: moved[0]!.y + moved[0]!.height / 2 };
    // rotating (x, y) by 90° clockwise about the selection centre
    const expectedCx = center.x - (aCenter.y - center.y);
    const expectedCy = center.y + (aCenter.x - center.x);
    expect(rotated.x + rotated.width / 2).toBeCloseTo(expectedCx, 3);
    expect(rotated.y + rotated.height / 2).toBeCloseTo(expectedCy, 3);
    expect(store.getState().changeCount).toBe(0);
    canvas.dispose();
  });

  it('flags skew and mirroring as unsupported and leaves the canonical object untouched', () => {
    const fabricObject = createArtworkFabricObject(rect!, services);
    fabricObject.set({ skewX: 15 });
    expect(measureFabricFrame(fabricObject).unsupported).toBe(true);
    expect(fabricObject.readCanonical()).toBe(rect);
    const mirrored = createArtworkFabricObject(rect!, services);
    mirrored.set({ scaleX: -1 });
    expect(measureFabricFrame(mirrored).unsupported).toBe(true);
    // skew handles are locked on every object
    expect(
      fabricObject.lockSkewingX && fabricObject.lockSkewingY && fabricObject.lockScalingFlip,
    ).toBe(true);
  });
});

describe('gesture commits through the editor store', () => {
  it('commits one undoable command per finished gesture and resets Fabric scale', async () => {
    const { store, canvas } = mountCanvas(createSampleHangTagDocument());
    const target = canvas.getFabricObject('front-logo')!;
    const before = target.canonical;
    target.set({ left: target.left + 20, scaleX: 1.25 });
    canvas.fabric.fire('object:modified', { target, action: 'scale' });
    await flushMicrotasks();
    const after = findPage(store.getState().document, 'page-front').objects.find(
      (o) => o.id === 'front-logo',
    )!;
    expect(after.width).toBe(normalizeLength(before.width * 1.25));
    expect(store.getState()).toMatchObject({ canUndo: true, undoLabel: 'Resize', changeCount: 1 });
    const synced = canvas.getFabricObject('front-logo') as ArtworkFabricObject;
    expect(synced.scaleX).toBe(1);
    expect(synced.width).toBe(after.width);
    store.undo();
    expect(canvas.getFabricObject('front-logo')!.canonical).toBe(before);
    canvas.dispose();
  });

  it('never moves locked objects and snaps Fabric back when nothing canonical changed', async () => {
    const { store, canvas } = mountCanvas(createSampleHangTagDocument());
    store.apply('Lock', (document, pageId) => ({
      ...document,
      pages: document.pages.map((page) =>
        page.id !== pageId
          ? page
          : {
              ...page,
              objects: page.objects.map((o) =>
                o.id === 'front-band' ? { ...o, locked: true } : o,
              ),
            },
      ),
    }));
    const band = canvas.getFabricObject('front-band')!;
    expect(band).toMatchObject({ evented: false, lockMovementX: true, hasControls: false });
    const lockedDocument = store.getState().document;
    band.set({ left: band.left + 50 });
    canvas.fabric.fire('object:modified', { target: band, action: 'drag' });
    await flushMicrotasks();
    expect(store.getState().document).toBe(lockedDocument);
    expect(canvas.getFabricObject('front-band')!.left).toBe(
      band.canonical.x + band.canonical.width / 2,
    );
    canvas.dispose();
  });

  it('mirrors layer order, visibility and page switches from the store', () => {
    const { store, canvas } = mountCanvas(createSampleHangTagDocument());
    const ids = () => canvas.fabric.getObjects().map((o) => (o as ArtworkFabricObject).objectId);
    expect(ids()[0]).toBe('front-band');
    store.apply('Bring to front', (document, pageId) => {
      const page = findPage(document, pageId);
      const objects = [...page.objects.filter((o) => o.id !== 'front-band'), page.objects[0]!].map(
        (o, index) => ({ ...o, zIndex: index }),
      );
      return {
        ...document,
        pages: document.pages.map((p) => (p.id === pageId ? { ...p, objects } : p)),
      };
    });
    expect(ids().at(-1)).toBe('front-band');
    store.setActivePage('page-back');
    expect(ids()).toEqual(
      findPage(store.getState().document, 'page-back').objects.map((o) => o.id),
    );
    expect(ids()).not.toContain('front-band');
    canvas.dispose();
  });

  it('selects from the store and reports canvas selections back', () => {
    const { store, canvas } = mountCanvas(createSampleHangTagDocument());
    store.setSelection(['front-size', 'front-price']);
    expect(canvas.fabric.getActiveObject()).toBeInstanceOf(ActiveSelection);
    canvas.fabric.discardActiveObject();
    canvas.fabric.fire('selection:cleared', { deselected: [] });
    expect(store.getState().selection).toEqual([]);
    canvas.fabric.setActiveObject(canvas.getFabricObject('front-logo')!);
    canvas.fabric.fire('selection:created', { selected: [canvas.getFabricObject('front-logo')!] });
    expect(store.getState().selection).toEqual(['front-logo']);
    canvas.dispose();
  });
});
