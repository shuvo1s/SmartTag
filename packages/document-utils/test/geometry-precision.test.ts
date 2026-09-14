import { describe, expect, it } from 'vitest';
import {
  LENGTH_EPSILON_PT,
  lengthsEqual,
  mmToPt,
  normalizeLength,
  normalizeOpacity,
  normalizeRotation,
  ptToMm,
  rotationsEqual,
} from '../src';

describe('canonical geometry precision', () => {
  it('removes floating-point noise while keeping 0.0001 pt resolution', () => {
    expect(normalizeLength(17.000000000000231)).toBe(17);
    expect(normalizeLength(0.1 + 0.2)).toBe(0.3);
    expect(normalizeLength(mmToPt(8))).toBe(22.6772);
    expect(normalizeLength(-0.00001)).toBe(0);
    expect(Object.is(normalizeLength(-0.00001), -0)).toBe(false);
    // 0.0001 pt is 0.0000353 mm: display in mm with 2 decimals is unaffected
    expect(ptToMm(normalizeLength(mmToPt(8))).toFixed(2)).toBe('8.00');
  });

  it('is idempotent, so repeated open/save cycles cannot drift', () => {
    let value = mmToPt(12.345);
    for (let cycle = 0; cycle < 1_000; cycle += 1) {
      value = normalizeLength(value + 0) * 1;
    }
    expect(value).toBe(normalizeLength(mmToPt(12.345)));
  });

  it('keeps repeated nudges exact instead of accumulating error', () => {
    const step = mmToPt(0.25);
    let x = normalizeLength(mmToPt(5));
    for (let i = 0; i < 400; i += 1) {
      x = normalizeLength(x + step);
    }
    expect(Math.abs(x - mmToPt(105))).toBeLessThan(400 * LENGTH_EPSILON_PT);
    expect(String(x)).toMatch(/^\d+(\.\d{1,4})?$/);
  });

  it('normalizes rotations into [0, 360)', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(720.5)).toBe(0.5);
    expect(normalizeRotation(359.99999)).toBe(0);
    expect(normalizeRotation(45.000000000001)).toBe(45);
    expect(rotationsEqual(359.99999, 0)).toBe(true);
    expect(rotationsEqual(10, 10.001)).toBe(false);
  });

  it('clamps and rounds opacity', () => {
    expect(normalizeOpacity(1.0000001)).toBe(1);
    expect(normalizeOpacity(-0.2)).toBe(0);
    expect(normalizeOpacity(0.33333333)).toBe(0.3333);
  });

  it('compares lengths within half the rounding unit', () => {
    expect(lengthsEqual(10, 10 + LENGTH_EPSILON_PT / 2)).toBe(true);
    expect(lengthsEqual(10, 10.0001)).toBe(false);
  });
});
