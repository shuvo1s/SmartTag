import { roundTo } from './units';

/**
 * Canonical geometry normalization (see docs/coordinate-system.md#precision).
 *
 * Interactive editing derives geometry from floating-point transforms (zoom, drag deltas, rotation
 * matrices). Without normalization, values such as 17.000000000000231 appear and repeated
 * open/save cycles drift. Every value that an editing operation CHANGES is therefore rounded to a
 * fixed number of decimals; values an operation does not change are kept bit-for-bit.
 *
 * Lengths: 4 decimals of a point = 0.0001 pt ≈ 0.035 µm. That is two orders of magnitude finer
 * than the best platesetters (≈ 6 µm at 4 000 dpi), so no commercially meaningful accuracy is
 * lost, and it matches the SVG serializer's output precision.
 * Rotation: 4 decimals of a degree; over a 1 m edge the rounding error is below 2 µm.
 */
export const LENGTH_PRECISION_DECIMALS = 4;
export const ROTATION_PRECISION_DECIMALS = 4;
export const OPACITY_PRECISION_DECIMALS = 4;

/**
 * Two lengths closer than this are considered equal (half the rounding unit). Adapters use it to
 * recognise "unchanged" geometry and keep the original stored value instead of a recomputed one.
 */
export const LENGTH_EPSILON_PT = 0.5 * 10 ** -LENGTH_PRECISION_DECIMALS;
export const ROTATION_EPSILON_DEG = 0.5 * 10 ** -ROTATION_PRECISION_DECIMALS;

function withoutNegativeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/** Rounds a length in points to canonical precision. */
export function normalizeLength(pt: number): number {
  return withoutNegativeZero(roundTo(pt, LENGTH_PRECISION_DECIMALS));
}

/** Normalizes a rotation to canonical precision within [0, 360). */
export function normalizeRotation(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360;
  const rounded = roundTo(wrapped, ROTATION_PRECISION_DECIMALS);
  return withoutNegativeZero(rounded >= 360 ? rounded - 360 : rounded);
}

/** Rounds and clamps an opacity to [0, 1]. */
export function normalizeOpacity(opacity: number): number {
  return withoutNegativeZero(
    Math.min(1, Math.max(0, roundTo(opacity, OPACITY_PRECISION_DECIMALS))),
  );
}

export function lengthsEqual(a: number, b: number, epsilon = LENGTH_EPSILON_PT): boolean {
  return Math.abs(a - b) <= epsilon;
}

/** Compares rotations on the circle (359.99999 equals 0). */
export function rotationsEqual(a: number, b: number, epsilon = ROTATION_EPSILON_DEG): boolean {
  const difference = Math.abs(((((a - b) % 360) + 540) % 360) - 180);
  return difference <= epsilon;
}
