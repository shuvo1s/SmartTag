import { describe, expect, it } from 'vitest';
import {
  ARTWORK_OBJECT_TYPES,
  ArtworkObjectSchema,
  OBJECT_BINDABLE_PROPERTIES,
  getBleedBox,
  getRotatedBounds,
  getSafeBox,
  getTrimBox,
  isFieldTypeCompatible,
  rectsIntersect,
  type DocumentDimensions,
} from '../src';
import { minimalDocument } from './fixtures';

const dimensions = minimalDocument().dimensions as DocumentDimensions;

describe('document boxes', () => {
  it('derives trim, bleed and safe boxes in trim space', () => {
    const trim = getTrimBox(dimensions);
    const bleed = getBleedBox(dimensions);
    const safe = getSafeBox(dimensions);
    const threeMm = (3 * 72) / 25.4;

    expect(trim).toEqual({ x: 0, y: 0, width: dimensions.width, height: dimensions.height });
    expect(bleed.x).toBeCloseTo(-threeMm, 10);
    expect(bleed.width).toBeCloseTo(dimensions.width + 2 * threeMm, 10);
    expect(safe.y).toBeCloseTo(threeMm, 10);
    expect(safe.height).toBeCloseTo(dimensions.height - 2 * threeMm, 10);
  });
});

describe('getRotatedBounds', () => {
  it('returns the frame unchanged without rotation', () => {
    expect(getRotatedBounds({ x: 1, y: 2, width: 30, height: 10, rotation: 0 })).toEqual({
      x: 1,
      y: 2,
      width: 30,
      height: 10,
    });
  });

  it('swaps extents about the centre for a 90° rotation', () => {
    const bounds = getRotatedBounds({ x: 0, y: 0, width: 30, height: 10, rotation: 90 });
    expect(bounds.x).toBeCloseTo(10, 10);
    expect(bounds.y).toBeCloseTo(-10, 10);
    expect(bounds.width).toBeCloseTo(10, 10);
    expect(bounds.height).toBeCloseTo(30, 10);
  });

  it('grows the bounding box for a 45° rotation', () => {
    const bounds = getRotatedBounds({ x: 0, y: 0, width: 10, height: 10, rotation: 45 });
    expect(bounds.width).toBeCloseTo(Math.SQRT2 * 10, 10);
  });

  it('detects intersections', () => {
    expect(
      rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 5, height: 5 }),
    ).toBe(true);
    expect(
      rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 }),
    ).toBe(false);
  });
});

describe('binding model', () => {
  it('declares bindable properties for every artwork object type', () => {
    expect(Object.keys(OBJECT_BINDABLE_PROPERTIES).sort()).toEqual(
      [...ARTWORK_OBJECT_TYPES].sort(),
    );
    for (const properties of Object.values(OBJECT_BINDABLE_PROPERTIES)) {
      expect(properties).toHaveProperty('visible', 'VISIBILITY');
    }
  });

  it('matches the union members of the artwork object schema', () => {
    const unionTypes = ArtworkObjectSchema.options.map((option) => option.shape.type.value).sort();
    expect(unionTypes).toEqual([...ARTWORK_OBJECT_TYPES].sort());
  });

  it('enforces field-type compatibility per property kind', () => {
    expect(isFieldTypeCompatible('TEXT', 'decimal')).toBe(true);
    expect(isFieldTypeCompatible('TEXT', 'image')).toBe(false);
    expect(isFieldTypeCompatible('SYMBOL_DATA', 'url')).toBe(true);
    expect(isFieldTypeCompatible('IMAGE_ASSET', 'string')).toBe(false);
    expect(isFieldTypeCompatible('VISIBILITY', 'boolean')).toBe(true);
    expect(isFieldTypeCompatible('VISIBILITY', 'string')).toBe(false);
  });
});
