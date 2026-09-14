import type { MeasurementUnit, Rect } from '@smarttag/document-schema';
import { CSS_PIXELS_PER_POINT, inToPt, mmToPt } from '@smarttag/document-utils';

/**
 * Viewport math: canonical points → screen pixels. Zoom and pan are UI state; changing them never
 * touches the document.
 *
 *   screen = point × zoom × CSS_PIXELS_PER_POINT + pan
 *
 * zoom 1 (100 %) shows the piece at physical size on a nominal 96 dpi screen.
 */
export interface Viewport {
  readonly zoom: number;
  /** Screen pixel position of the trim origin (0, 0). */
  readonly panX: number;
  readonly panY: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function viewportScale(zoom: number): number {
  return zoom * CSS_PIXELS_PER_POINT;
}

export function pointToScreen(viewport: Viewport, point: { x: number; y: number }) {
  const scale = viewportScale(viewport.zoom);
  return { x: point.x * scale + viewport.panX, y: point.y * scale + viewport.panY };
}

export function screenToPoint(viewport: Viewport, screen: { x: number; y: number }) {
  const scale = viewportScale(viewport.zoom);
  return { x: (screen.x - viewport.panX) / scale, y: (screen.y - viewport.panY) / scale };
}

/** Zooms keeping the document point under `anchor` (screen px) fixed. */
export function zoomAt(
  viewport: Viewport,
  nextZoom: number,
  anchor: { x: number; y: number },
): Viewport {
  const zoom = clampZoom(nextZoom);
  const point = screenToPoint(viewport, anchor);
  const scale = viewportScale(zoom);
  return { zoom, panX: anchor.x - point.x * scale, panY: anchor.y - point.y * scale };
}

export function nextZoomStep(zoom: number, direction: 1 | -1): number {
  if (direction > 0) {
    return ZOOM_STEPS.find((step) => step > zoom + 1e-6) ?? MAX_ZOOM;
  }
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-6) ?? MIN_ZOOM;
}

/** Centres `box` in the viewport; FIT_PAGE fits both axes, FIT_WIDTH fits the width only. */
export function fitBox(
  box: Rect,
  viewportSize: { width: number; height: number },
  mode: 'FIT_PAGE' | 'FIT_WIDTH',
  paddingPx = 48,
): Viewport {
  const availableWidth = Math.max(1, viewportSize.width - paddingPx * 2);
  const availableHeight = Math.max(1, viewportSize.height - paddingPx * 2);
  const scaleX = availableWidth / box.width;
  const scaleY = availableHeight / box.height;
  const scale = mode === 'FIT_WIDTH' ? scaleX : Math.min(scaleX, scaleY);
  const zoom = clampZoom(scale / CSS_PIXELS_PER_POINT);
  const actualScale = viewportScale(zoom);
  const panX = (viewportSize.width - box.width * actualScale) / 2 - box.x * actualScale;
  const panY =
    mode === 'FIT_WIDTH' && box.height * actualScale > availableHeight
      ? paddingPx - box.y * actualScale
      : (viewportSize.height - box.height * actualScale) / 2 - box.y * actualScale;
  return { zoom, panX, panY };
}

/** Wheel delta → multiplicative zoom factor (smooth for trackpads and wheels). */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-Math.max(-100, Math.min(100, deltaY)) * 0.0025);
}

/**
 * Keyboard nudge distances, physical and documented (docs/editor.md):
 * mm/cm documents: 0.25 mm and 1 mm; inch documents: 0.01 in and 0.1 in; pt documents: 1 pt and 10 pt.
 */
export function nudgeDistancePt(unit: MeasurementUnit, large: boolean): number {
  switch (unit) {
    case 'mm':
    case 'cm':
      return mmToPt(large ? 1 : 0.25);
    case 'in':
      return inToPt(large ? 0.1 : 0.01);
    case 'pt':
      return large ? 10 : 1;
  }
}

/** Offset applied to duplicates and pastes so the copy is visible (2 mm, or 1/16 in). */
export function duplicateOffsetPt(unit: MeasurementUnit): number {
  return unit === 'in' ? inToPt(1 / 16) : mmToPt(2);
}
