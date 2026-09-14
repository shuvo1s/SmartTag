import type { ArtworkObject, Page } from '@smarttag/document-schema';
import { applyFrameChange, paintOrder, type FrameChange } from '@smarttag/editor-core';
import { util, type FabricObject } from 'fabric';

/**
 * Canonical ⇄ Fabric geometry (docs/editor.md#round-trip-integrity).
 *
 * One Fabric unit is one PDF point in trim space, so no unit conversion ever happens in the
 * scene. Canonical frames (x, y = top-left of the unrotated frame; rotation clockwise about the
 * centre) map to Fabric objects with a CENTRE origin, unit scale and no skew:
 *
 *   left = x + width / 2    top = y + height / 2    angle = rotation
 *
 * Zoom and pan are applied only through the canvas viewport transform and never reach these
 * values. Reading back decomposes the full transform matrix (including an active selection) and
 * reconciles it with the canonical object: values within half the rounding unit keep their exact
 * stored numbers, changed values are normalized.
 */
export function fabricTransformFor(object: ArtworkObject) {
  return {
    originX: 'center' as const,
    originY: 'center' as const,
    left: object.x + object.width / 2,
    top: object.y + object.height / 2,
    width: object.width,
    height: object.height,
    angle: object.rotation,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    flipX: false,
    flipY: false,
  };
}

export interface MeasuredFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  /** True when the transform contains skew or mirroring, which the canonical model cannot represent. */
  readonly unsupported: boolean;
}

const SKEW_EPSILON = 1e-6;

/** Absolute frame of a Fabric object in trim-space points (works inside active selections). */
export function measureFabricFrame(fabricObject: FabricObject): MeasuredFrame {
  const decomposed = util.qrDecompose(fabricObject.calcTransformMatrix());
  const width = fabricObject.width * Math.abs(decomposed.scaleX);
  const height = fabricObject.height * Math.abs(decomposed.scaleY);
  return {
    x: decomposed.translateX - width / 2,
    y: decomposed.translateY - height / 2,
    width,
    height,
    rotation: decomposed.angle,
    unsupported:
      Math.abs(decomposed.skewX) > SKEW_EPSILON ||
      Math.abs(decomposed.skewY) > SKEW_EPSILON ||
      decomposed.scaleX < 0 ||
      decomposed.scaleY < 0,
  };
}

export function toFrameChange(id: string, measured: MeasuredFrame): FrameChange {
  return {
    id,
    x: measured.x,
    y: measured.y,
    width: measured.width,
    height: measured.height,
    rotation: measured.rotation,
  };
}

/**
 * Fabric → canonical for one object: the canonical snapshot the Fabric object was created from,
 * with geometry read back from the Fabric transform using the editor precision rules.
 */
export function reconcileObject(canonical: ArtworkObject, measured: MeasuredFrame): ArtworkObject {
  if (measured.unsupported) {
    return canonical;
  }
  const { id: _id, ...change } = toFrameChange(canonical.id, measured);
  return applyFrameChange(canonical, change);
}

/**
 * Fabric → canonical for a page: objects in canvas stacking order. When the stacking order is the
 * canonical paint order, zIndex values and array order are preserved exactly; otherwise the page
 * is renumbered densely (the same rule as editor reorder commands).
 */
export function reconcilePage(page: Page, canvasObjects: readonly ArtworkObject[]): Page {
  const byId = new Map(canvasObjects.map((object) => [object.id, object]));
  const canonicalOrder = paintOrder(page).map((object) => object.id);
  const canvasOrder = canvasObjects.map((object) => object.id);
  const sameOrder =
    canonicalOrder.length === canvasOrder.length &&
    canonicalOrder.every((id, index) => id === canvasOrder[index]);

  if (sameOrder) {
    let changed = false;
    const objects = page.objects.map((object) => {
      const next = byId.get(object.id) ?? object;
      if (next !== object) changed = true;
      return next;
    });
    return changed ? { ...page, objects } : page;
  }
  return {
    ...page,
    objects: canvasObjects.map((object, index) =>
      object.zIndex === index ? object : { ...object, zIndex: index },
    ),
  };
}
