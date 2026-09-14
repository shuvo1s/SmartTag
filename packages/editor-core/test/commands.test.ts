import {
  ELEMENT_ID_PATTERN,
  getRotatedBounds,
  validateDesignDocument,
  type ArtworkObject,
  type DesignDocument,
} from '@smarttag/document-schema';
import { computeDocumentHash, createRectangleObject, mmToPt } from '@smarttag/document-utils';
import { createSampleHangTagDocument } from '@smarttag/document-utils/fixtures';
import { describe, expect, it } from 'vitest';
import {
  DocumentSettingsError,
  EditorCommandError,
  addObjects,
  alignObjects,
  deleteObjects,
  distributeObjects,
  duplicateObjects,
  findPage,
  moveObjectToLayerIndex,
  moveObjects,
  paintOrder,
  pasteObjects,
  renameObject,
  reorderObjects,
  setObjectFrames,
  setObjectsLocked,
  setObjectsVisible,
  updateDimensions,
  updateObject,
} from '../src';

const FRONT = 'page-front';
const object = (document: DesignDocument, id: string, pageId = FRONT): ArtworkObject =>
  findPage(document, pageId).objects.find((candidate) => candidate.id === id)!;

function expectValid(document: DesignDocument) {
  const result = validateDesignDocument(document);
  expect(result.errors).toEqual([]);
}

describe('frame commands', () => {
  it('normalizes only the values that change and keeps untouched values bit-identical', () => {
    const document = createSampleHangTagDocument();
    const before = object(document, 'front-product-name');
    const next = setObjectFrames(document, FRONT, [
      { id: 'front-product-name', x: before.x + 0.1 + 0.2, y: before.y },
    ]);
    const after = object(next, 'front-product-name');
    expect(after.x).toBe(Number((before.x + 0.3).toFixed(4)));
    expect(after.y).toBe(before.y); // same value → original full-precision number kept
    expect(after.width).toBe(before.width);
    // other objects keep identity (structural sharing)
    expect(object(next, 'front-band')).toBe(object(document, 'front-band'));
    expectValid(next);
  });

  it('returns the same document when nothing changes (no phantom history entries)', () => {
    const document = createSampleHangTagDocument();
    const current = object(document, 'front-price');
    expect(
      setObjectFrames(document, FRONT, [
        { id: 'front-price', x: current.x + 1e-9, rotation: current.rotation + 360 },
      ]),
    ).toBe(document);
  });

  it('never moves, resizes or rotates locked objects', () => {
    const locked = setObjectsLocked(createSampleHangTagDocument(), FRONT, ['front-logo'], true);
    expect(moveObjects(locked, FRONT, ['front-logo'], 10, 10)).toBe(locked);
    expect(() => updateObject(locked, FRONT, 'front-logo', { width: 20 })).toThrow(
      EditorCommandError,
    );
    // non-geometry properties remain editable
    expect(
      object(updateObject(locked, FRONT, 'front-logo', { opacity: 0.5 }), 'front-logo').opacity,
    ).toBe(0.5);
  });

  it('keeps dependent properties valid after resizing', () => {
    let document = createSampleHangTagDocument();
    document = addObjects(document, FRONT, [
      createRectangleObject({
        id: 'rounded',
        x: 20,
        y: 20,
        width: 40,
        height: 40,
        zIndex: 0,
        cornerRadius: 18,
      }),
    ]);
    document = setObjectFrames(document, FRONT, [{ id: 'rounded', height: 10 }]);
    expect(object(document, 'rounded')).toMatchObject({ height: 10, cornerRadius: 5 });

    const barcode = object(document, 'front-barcode');
    document = setObjectFrames(document, FRONT, [
      { id: 'front-barcode', height: barcode.height / 2 },
    ]);
    const resized = object(document, 'front-barcode');
    expect(resized.type === 'barcode' && resized.barHeight).toBeCloseTo(
      barcode.type === 'barcode' ? barcode.barHeight / 2 : 0,
      3,
    );
    expectValid(document);
  });

  it('validates property edits with the canonical schema', () => {
    const document = createSampleHangTagDocument();
    expect(() => updateObject(document, FRONT, 'front-size', { fontSize: -2 })).toThrow(/fontSize/);
    expect(() => updateObject(document, FRONT, 'front-size', { type: 'image' })).toThrow();
    // lowering the size below SHRINK_TO_FIT's minimum lowers the minimum too
    const shrunk = updateObject(document, FRONT, 'front-product-name', { fontSize: 5 });
    const text = object(shrunk, 'front-product-name');
    expect(text.type === 'text' && text.overflow).toEqual({
      mode: 'SHRINK_TO_FIT',
      minFontSize: 5,
    });
    expectValid(shrunk);
  });
});

describe('insert, duplicate, paste and delete', () => {
  it('duplicates with new stable ids, an offset, copied bindings, above everything', async () => {
    const document = createSampleHangTagDocument();
    const offset = mmToPt(2);
    const { document: next, insertedIds } = duplicateObjects(
      document,
      FRONT,
      ['front-price'],
      offset,
    );
    expect(insertedIds).toHaveLength(1);
    const [copyId] = insertedIds;
    expect(copyId).not.toBe('front-price');
    expect(copyId).toMatch(ELEMENT_ID_PATTERN);
    const original = object(next, 'front-price');
    const copy = object(next, copyId!);
    expect(copy.x).toBeCloseTo(original.x + offset, 4);
    expect(copy.type === 'text' && copy.bindings).toEqual(
      original.type === 'text' && original.bindings,
    );
    expect(paintOrder(findPage(next, FRONT)).at(-1)?.id).toBe(copyId);
    expectValid(next);
    // the source document is untouched
    expect(await computeDocumentHash(document)).toBe(
      await computeDocumentHash(createSampleHangTagDocument()),
    );
  });

  it('pastes clipboard copies onto another page with fresh ids every time', () => {
    const document = createSampleHangTagDocument();
    const clipboard = [object(document, 'front-logo'), object(document, 'front-barcode')];
    const first = pasteObjects(document, 'page-back', clipboard, 0);
    const second = pasteObjects(first.document, 'page-back', clipboard, 0);
    expect(new Set([...first.insertedIds, ...second.insertedIds]).size).toBe(4);
    expect(findPage(second.document, 'page-back').objects).toHaveLength(8 + 4);
    expectValid(second.document);
  });

  it('refuses duplicate ids and skips locked objects when deleting', () => {
    const document = createSampleHangTagDocument();
    expect(() => addObjects(document, FRONT, [object(document, 'front-band')])).toThrow(
      /already exists/,
    );
    const locked = setObjectsLocked(document, FRONT, ['front-band'], true);
    const result = deleteObjects(locked, FRONT, ['front-band', 'front-divider']);
    expect(result.deletedIds).toEqual(['front-divider']);
    expect(result.skippedLockedIds).toEqual(['front-band']);
    expect(findPage(result.document, FRONT).objects.map((o) => o.id)).not.toContain(
      'front-divider',
    );
  });
});

describe('layer order', () => {
  const ids = (document: DesignDocument) => paintOrder(findPage(document, FRONT)).map((o) => o.id);

  it('maps order deterministically to dense zIndex values and array order', () => {
    const document = createSampleHangTagDocument();
    const front = reorderObjects(document, FRONT, ['front-band'], 'FRONT');
    const page = findPage(front, FRONT);
    expect(ids(front).at(-1)).toBe('front-band');
    expect(page.objects.map((o) => o.zIndex)).toEqual(page.objects.map((_, index) => index));
    expect(page.objects.map((o) => o.id)).toEqual(ids(front));
    expectValid(front);

    const back = reorderObjects(front, FRONT, ['front-band'], 'BACK');
    expect(ids(back)).toEqual(ids(document));
    const forward = reorderObjects(document, FRONT, ['front-logo'], 'FORWARD');
    expect(ids(forward).indexOf('front-logo')).toBe(ids(document).indexOf('front-logo') + 1);
    const backward = reorderObjects(forward, FRONT, ['front-logo'], 'BACKWARD');
    expect(ids(backward)).toEqual(ids(document));
    const dragged = moveObjectToLayerIndex(document, FRONT, 'front-barcode', 0);
    expect(ids(dragged)[0]).toBe('front-barcode');
  });

  it('is a no-op when the order does not change', () => {
    const document = createSampleHangTagDocument();
    expect(reorderObjects(document, FRONT, ['front-barcode'], 'FRONT')).toBe(document);
  });
});

describe('alignment and distribution', () => {
  it('aligns the rotated bounds of several objects to their combined bounds', () => {
    let document = createSampleHangTagDocument();
    document = setObjectFrames(document, FRONT, [{ id: 'front-logo', rotation: 30 }]);
    const aligned = alignObjects(
      document,
      FRONT,
      ['front-logo', 'front-size', 'front-price'],
      'LEFT',
    );
    const lefts = ['front-logo', 'front-size', 'front-price'].map(
      (id) => getRotatedBounds(object(aligned, id)).x,
    );
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThan(0.001);
    expectValid(aligned);
  });

  it('aligns a single object to the page', () => {
    const document = createSampleHangTagDocument();
    const centered = alignObjects(document, FRONT, ['front-logo'], 'HCENTER');
    const logo = object(centered, 'front-logo');
    expect(logo.x + logo.width / 2).toBeCloseTo(document.dimensions.width / 2, 3);
  });

  it('distributes equal gaps between three or more objects and keeps the outer ones', () => {
    let document = createSampleHangTagDocument();
    document = addObjects(document, FRONT, [
      createRectangleObject({ id: 'a', x: 0, y: 0, width: 10, height: 10, zIndex: 0 }),
      createRectangleObject({ id: 'b', x: 13, y: 0, width: 20, height: 10, zIndex: 0 }),
      createRectangleObject({ id: 'c', x: 100, y: 0, width: 10, height: 10, zIndex: 0 }),
    ]);
    const next = distributeObjects(document, FRONT, ['c', 'a', 'b'], 'HORIZONTAL');
    expect(object(next, 'a').x).toBe(0);
    expect(object(next, 'c').x).toBe(100);
    expect(object(next, 'b').x).toBe(45); // gaps: (110 - 40) / 2 = 35
    expect(distributeObjects(document, FRONT, ['a', 'b'], 'HORIZONTAL')).toBe(document);
  });
});

describe('visibility, lock, names and page settings', () => {
  it('toggles visibility and lock and renames', () => {
    const document = createSampleHangTagDocument();
    const hidden = setObjectsVisible(document, FRONT, ['front-logo'], false);
    expect(object(hidden, 'front-logo').visible).toBe(false);
    expect(setObjectsVisible(hidden, FRONT, ['front-logo'], false)).toBe(hidden);
    expect(
      object(renameObject(document, FRONT, 'front-logo', '  Brand mark  '), 'front-logo').name,
    ).toBe('Brand mark');
  });

  it('changes dimensions without scaling artwork and derives orientation', () => {
    const document = createSampleHangTagDocument();
    const wider = updateDimensions(document, { width: mmToPt(100) });
    expect(wider.dimensions.orientation).toBe('LANDSCAPE');
    expect(findPage(wider, FRONT).objects).toBe(findPage(document, FRONT).objects);
    expect(wider.dimensions.width).toBe(Number(mmToPt(100).toFixed(4)));
  });

  it('refuses settings that make the document invalid', () => {
    const document = createSampleHangTagDocument();
    // the Ø4 mm punch hole sits 6 mm from the top edge; 20 mm width is fine, 3 mm height is not
    expect(() => updateDimensions(document, { height: mmToPt(3) })).toThrow(DocumentSettingsError);
    expect(() =>
      updateDimensions(document, { safeArea: { top: 200, right: 200, bottom: 200, left: 200 } }),
    ).toThrow(/safeArea/);
  });
});
