import { POINTS_PER_INCH, type MeasurementUnit } from '@smarttag/document-schema';

export { POINTS_PER_INCH };
export const MM_PER_INCH = 25.4;
export const CM_PER_INCH = 2.54;

/** CSS reference pixels per point (CSS defines 96 px per inch). Screen rendering only. */
export const CSS_PIXELS_PER_POINT = 96 / POINTS_PER_INCH;

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, received ${String(value)}`);
  }
}

// Conversions divide by the unit-per-inch constant first and then multiply by 72. This keeps
// whole-inch values exact (25.4 mm → exactly 72 pt) and makes round trips stable.

export function mmToPt(mm: number): number {
  assertFinite(mm, 'mm');
  return (mm / MM_PER_INCH) * POINTS_PER_INCH;
}

export function cmToPt(cm: number): number {
  assertFinite(cm, 'cm');
  return (cm / CM_PER_INCH) * POINTS_PER_INCH;
}

export function inToPt(inches: number): number {
  assertFinite(inches, 'inches');
  return inches * POINTS_PER_INCH;
}

export function ptToMm(pt: number): number {
  assertFinite(pt, 'pt');
  return (pt / POINTS_PER_INCH) * MM_PER_INCH;
}

export function ptToCm(pt: number): number {
  assertFinite(pt, 'pt');
  return (pt / POINTS_PER_INCH) * CM_PER_INCH;
}

export function ptToIn(pt: number): number {
  assertFinite(pt, 'pt');
  return pt / POINTS_PER_INCH;
}

export function toPoints(value: number, unit: MeasurementUnit): number {
  switch (unit) {
    case 'mm':
      return mmToPt(value);
    case 'cm':
      return cmToPt(value);
    case 'in':
      return inToPt(value);
    case 'pt':
      assertFinite(value, 'pt');
      return value;
  }
}

export function fromPoints(pt: number, unit: MeasurementUnit): number {
  switch (unit) {
    case 'mm':
      return ptToMm(pt);
    case 'cm':
      return ptToCm(pt);
    case 'in':
      return ptToIn(pt);
    case 'pt':
      assertFinite(pt, 'pt');
      return pt;
  }
}

/** Converts points to screen pixels for a given device-independent zoom factor. */
export function ptToCssPx(pt: number, zoom = 1): number {
  assertFinite(pt, 'pt');
  return pt * CSS_PIXELS_PER_POINT * zoom;
}

/** Rounds half away from zero to `decimals` places, avoiding the classic 1.005 → 1.00 error. */
export function roundTo(value: number, decimals: number): number {
  assertFinite(value, 'value');
  const factor = 10 ** decimals;
  return Math.sign(value) * (Math.round((Math.abs(value) * factor) * (1 + Number.EPSILON)) / factor);
}

/** Sensible display precision per unit (≈0.01 mm resolution). */
export const DISPLAY_PRECISION: Readonly<Record<MeasurementUnit, number>> = {
  mm: 2,
  cm: 3,
  in: 3,
  pt: 2,
};

export const UNIT_LABELS: Readonly<Record<MeasurementUnit, string>> = {
  mm: 'mm',
  cm: 'cm',
  in: 'in',
  pt: 'pt',
};

/** Formats a canonical point length for display, e.g. `formatLength(141.73, 'mm')` → "50 mm". */
export function formatLength(pt: number, unit: MeasurementUnit, decimals = DISPLAY_PRECISION[unit]): string {
  const value = roundTo(fromPoints(pt, unit), decimals);
  return `${Number(value.toFixed(decimals)).toString()} ${UNIT_LABELS[unit]}`;
}
