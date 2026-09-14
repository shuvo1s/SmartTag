import { describe, expect, it } from 'vitest';
import {
  CSS_PIXELS_PER_POINT,
  cmToPt,
  formatDimensions,
  formatLength,
  fromPoints,
  inToPt,
  mmToPt,
  ptToCm,
  ptToCssPx,
  ptToIn,
  ptToMm,
  roundTo,
  toPoints,
} from '../src';

describe('physical unit conversion (canonical unit: PDF point = 1/72 in)', () => {
  it('converts inches to points exactly', () => {
    expect(inToPt(1)).toBe(72);
    expect(inToPt(0.5)).toBe(36);
    expect(inToPt(8.5)).toBe(612); // US Letter width
  });

  it('converts millimetres to points', () => {
    expect(mmToPt(25.4)).toBe(72);
    expect(mmToPt(0)).toBe(0);
    expect(mmToPt(10)).toBeCloseTo(28.346456692913385, 12);
    expect(mmToPt(50)).toBeCloseTo(141.73228346456693, 12);
    expect(mmToPt(90)).toBeCloseTo(255.11811023622047, 12);
    expect(mmToPt(210)).toBeCloseTo(595.27559055118, 10); // A4 width
    expect(mmToPt(-3)).toBeCloseTo(-8.503937007874, 12);
  });

  it('converts centimetres to points', () => {
    expect(cmToPt(2.54)).toBe(72);
    expect(cmToPt(5)).toBeCloseTo(mmToPt(50), 12);
  });

  it('converts points to millimetres, centimetres and inches', () => {
    expect(ptToMm(72)).toBe(25.4);
    expect(ptToMm(141.73228346456693)).toBeCloseTo(50, 12);
    expect(ptToCm(72)).toBe(2.54);
    expect(ptToIn(72)).toBe(1);
    expect(ptToIn(612)).toBe(8.5);
  });

  it.each([0.1, 1, 3, 12.7, 50, 90, 297, 1234.5678])('round-trips %p mm within 1e-9 mm', (mm) => {
    expect(ptToMm(mmToPt(mm))).toBeCloseTo(mm, 9);
  });

  it('dispatches generic conversions by unit', () => {
    expect(toPoints(1, 'in')).toBe(72);
    expect(toPoints(72, 'pt')).toBe(72);
    expect(fromPoints(72, 'mm')).toBe(25.4);
    expect(fromPoints(toPoints(3.25, 'cm'), 'cm')).toBeCloseTo(3.25, 12);
  });

  it('rejects non-finite input rather than propagating NaN into geometry', () => {
    expect(() => mmToPt(Number.NaN)).toThrow(RangeError);
    expect(() => ptToMm(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => toPoints(Number.NaN, 'pt')).toThrow(RangeError);
  });

  it('keeps screen conversion separate from physical conversion', () => {
    expect(CSS_PIXELS_PER_POINT).toBeCloseTo(4 / 3, 12);
    expect(ptToCssPx(72)).toBe(96);
    expect(ptToCssPx(72, 2)).toBe(192);
  });

  it('rounds and formats for display without affecting stored values', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(formatLength(mmToPt(50), 'mm')).toBe('50 mm');
    expect(formatLength(mmToPt(3), 'mm')).toBe('3 mm');
    expect(formatLength(mmToPt(50), 'in')).toBe('1.969 in');
    expect(formatLength(36, 'pt')).toBe('36 pt');
    expect(formatDimensions(mmToPt(50), mmToPt(90), 'mm')).toBe('50 × 90 mm');
    expect(formatDimensions(144, 252, 'in')).toBe('2 × 3.5 in');
  });
});
