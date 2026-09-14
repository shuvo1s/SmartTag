import {
  getBleedBox,
  getMarginBox,
  getRotatedBounds,
  getSafeBox,
  getTrimBox,
  type DesignDocument,
  type Page,
  type Rect,
} from '@smarttag/document-schema';
import { isEffectivelyVisible } from './document-access';

export type SnapTargetKind =
  'PAGE_CENTER' | 'TRIM' | 'SAFE' | 'BLEED' | 'MARGIN' | 'OBJECT_EDGE' | 'OBJECT_CENTER';

export interface SnapLine {
  /** x for vertical lines, y for horizontal lines (trim-space points). */
  readonly position: number;
  readonly kind: SnapTargetKind;
}

export interface SnapTargets {
  readonly vertical: readonly SnapLine[];
  readonly horizontal: readonly SnapLine[];
  /** Extent used to draw guide lines across the work area. */
  readonly extent: Rect;
}

export interface SnapGuide {
  readonly orientation: 'VERTICAL' | 'HORIZONTAL';
  readonly position: number;
  readonly kind: SnapTargetKind;
}

export interface SnapResult {
  readonly dx: number;
  readonly dy: number;
  readonly guides: readonly SnapGuide[];
}

/**
 * Candidate lines for smart guides: page centre, trim/safe/bleed/margin edges and the edges and
 * centres of other visible objects. Guides are editor overlays only — never artwork.
 */
export function buildSnapTargets(
  document: DesignDocument,
  page: Page,
  excludeIds: ReadonlySet<string>,
): SnapTargets {
  const { dimensions } = document;
  const vertical: SnapLine[] = [];
  const horizontal: SnapLine[] = [];
  const addBox = (box: Rect, kind: SnapTargetKind) => {
    vertical.push({ position: box.x, kind }, { position: box.x + box.width, kind });
    horizontal.push({ position: box.y, kind }, { position: box.y + box.height, kind });
  };
  const trim = getTrimBox(dimensions);
  vertical.push({ position: trim.width / 2, kind: 'PAGE_CENTER' });
  horizontal.push({ position: trim.height / 2, kind: 'PAGE_CENTER' });
  addBox(trim, 'TRIM');
  addBox(getSafeBox(dimensions), 'SAFE');
  addBox(getBleedBox(dimensions), 'BLEED');
  addBox(getMarginBox(dimensions), 'MARGIN');

  for (const object of page.objects) {
    if (excludeIds.has(object.id) || !isEffectivelyVisible(page, object)) continue;
    const bounds = getRotatedBounds(object);
    addBox(bounds, 'OBJECT_EDGE');
    vertical.push({ position: bounds.x + bounds.width / 2, kind: 'OBJECT_CENTER' });
    horizontal.push({ position: bounds.y + bounds.height / 2, kind: 'OBJECT_CENTER' });
  }
  return { vertical, horizontal, extent: getBleedBox(dimensions) };
}

const KIND_PRIORITY: Readonly<Record<SnapTargetKind, number>> = {
  PAGE_CENTER: 0,
  TRIM: 1,
  SAFE: 2,
  OBJECT_EDGE: 3,
  OBJECT_CENTER: 3,
  BLEED: 4,
  MARGIN: 5,
};

function snapAxis(
  candidates: readonly number[],
  lines: readonly SnapLine[],
  tolerance: number,
): { delta: number; lines: SnapLine[] } | null {
  let best: { delta: number; line: SnapLine } | null = null;
  for (const candidate of candidates) {
    for (const line of lines) {
      const delta = line.position - candidate;
      if (Math.abs(delta) > tolerance) continue;
      if (
        !best ||
        Math.abs(delta) < Math.abs(best.delta) - 1e-9 ||
        (Math.abs(Math.abs(delta) - Math.abs(best.delta)) <= 1e-9 &&
          KIND_PRIORITY[line.kind] < KIND_PRIORITY[best.line.kind])
      ) {
        best = { delta, line };
      }
    }
  }
  if (!best) return null;
  const { delta } = best;
  // Show every line that the snapped edges now touch.
  const matched = lines.filter((line) =>
    candidates.some((candidate) => Math.abs(line.position - (candidate + delta)) <= 1e-6),
  );
  return { delta, lines: matched };
}

/**
 * Snaps a moving bounding box (left/centre/right, top/middle/bottom) to the nearest targets.
 * `tolerance` is in points; callers derive it from a fixed screen distance divided by the zoom so
 * snapping feels the same at every zoom level.
 */
export function snapMovingBounds(
  bounds: Rect,
  targets: SnapTargets,
  tolerance: number,
): SnapResult {
  const xs = [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width];
  const ys = [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height];
  const x = snapAxis(xs, targets.vertical, tolerance);
  const y = snapAxis(ys, targets.horizontal, tolerance);
  const guides: SnapGuide[] = [];
  const seen = new Set<string>();
  for (const line of x?.lines ?? []) {
    const key = `V${line.position.toFixed(4)}`;
    if (!seen.has(key))
      guides.push({ orientation: 'VERTICAL', position: line.position, kind: line.kind });
    seen.add(key);
  }
  for (const line of y?.lines ?? []) {
    const key = `H${line.position.toFixed(4)}`;
    if (!seen.has(key))
      guides.push({ orientation: 'HORIZONTAL', position: line.position, kind: line.kind });
    seen.add(key);
  }
  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, guides };
}

/** Screen distance within which snapping engages. */
export const SNAP_TOLERANCE_PX = 6;
