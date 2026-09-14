import type { DocumentDimensions } from './dimensions';
import type { Insets } from './primitives';

/** Axis-aligned rectangle in trim-space points (origin = trim top-left, +y down). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Frame extends Rect {
  /** Clockwise degrees about the frame centre. */
  readonly rotation: number;
}

/** Geometric tolerance for comparisons in points (~0.0035 mm). */
export const GEOMETRY_EPSILON_PT = 0.01;

export function getTrimBox(dimensions: Pick<DocumentDimensions, 'width' | 'height'>): Rect {
  return { x: 0, y: 0, width: dimensions.width, height: dimensions.height };
}

export function expandRect(rect: Rect, insets: Insets): Rect {
  return {
    x: rect.x - insets.left,
    y: rect.y - insets.top,
    width: rect.width + insets.left + insets.right,
    height: rect.height + insets.top + insets.bottom,
  };
}

export function insetRect(rect: Rect, insets: Insets): Rect {
  return {
    x: rect.x + insets.left,
    y: rect.y + insets.top,
    width: rect.width - insets.left - insets.right,
    height: rect.height - insets.top - insets.bottom,
  };
}

export function getBleedBox(dimensions: DocumentDimensions): Rect {
  return expandRect(getTrimBox(dimensions), dimensions.bleed);
}

export function getSafeBox(dimensions: DocumentDimensions): Rect {
  return insetRect(getTrimBox(dimensions), dimensions.safeArea);
}

export function getMarginBox(dimensions: DocumentDimensions): Rect {
  return insetRect(getTrimBox(dimensions), dimensions.margins);
}

/** Axis-aligned bounding box of a frame after rotation about its centre. */
export function getRotatedBounds(frame: Frame): Rect {
  if (frame.rotation === 0) {
    return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
  }
  const radians = (frame.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = frame.width * cos + frame.height * sin;
  const height = frame.width * sin + frame.height * cos;
  const centerX = frame.x + frame.width / 2;
  const centerY = frame.y + frame.height / 2;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function rectContainsRect(outer: Rect, inner: Rect, epsilon = GEOMETRY_EPSILON_PT): boolean {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.height <= outer.y + outer.height + epsilon
  );
}

export function rectContainsPoint(
  rect: Rect,
  point: { x: number; y: number },
  epsilon = GEOMETRY_EPSILON_PT,
): boolean {
  return (
    point.x >= rect.x - epsilon &&
    point.y >= rect.y - epsilon &&
    point.x <= rect.x + rect.width + epsilon &&
    point.y <= rect.y + rect.height + epsilon
  );
}
