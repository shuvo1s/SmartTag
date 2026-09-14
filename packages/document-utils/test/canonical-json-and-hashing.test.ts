import { describe, expect, it } from 'vitest';
import { createSampleHangTagDocument } from '../src/fixtures';
import {
  CanonicalJsonError,
  SHA256_HEX_PATTERN,
  canonicalizeJson,
  computeDocumentHash,
  hashCanonicalJson,
  sha256Hex,
} from '../src';

/** Rebuilds a JSON value with object keys inserted in reverse order, recursively. */
function reverseKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeyOrder);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([key, member]) => [key, reverseKeyOrder(member)]),
    );
  }
  return value;
}

describe('canonicalizeJson', () => {
  it('sorts object keys recursively and removes whitespace', () => {
    expect(canonicalizeJson({ b: 1, a: { d: [3, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
  });

  it('is independent of key insertion order', () => {
    const doc = createSampleHangTagDocument();
    expect(canonicalizeJson(reverseKeyOrder(doc))).toBe(canonicalizeJson(doc));
    expect(canonicalizeJson(JSON.parse(JSON.stringify(doc, null, 2)))).toBe(canonicalizeJson(doc));
  });

  it('preserves array order (arrays are semantically ordered)', () => {
    expect(canonicalizeJson([2, 1])).not.toBe(canonicalizeJson([1, 2]));
  });

  it('matches the RFC 8785 §3.2.2 reference example', () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
        '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
        '"literals":[null,true,false]}',
    ) as unknown;
    expect(canonicalizeJson(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts keys by UTF-16 code units, as RFC 8785 requires', () => {
    expect(canonicalizeJson({ '€': 1, '\r': 2, 'ö': 3, '1': 4, a: 5, '😀': 6, 'ﬂ': 7 })).toBe(
      '{"\\r":2,"1":4,"a":5,"ö":3,"€":1,"😀":6,"ﬂ":7}',
    );
  });

  it('normalises negative zero and keeps Unicode text verbatim', () => {
    expect(canonicalizeJson({ n: -0, t: 'বাংলাদেশে তৈরি' })).toBe('{"n":0,"t":"বাংলাদেশে তৈরি"}');
  });

  it.each([
    ['NaN', { value: Number.NaN }],
    ['Infinity', { value: Number.POSITIVE_INFINITY }],
    ['undefined member', { value: undefined }],
    ['undefined array item', [1, undefined]],
    ['Date instance', { value: new Date(0) }],
    ['Map instance', { value: new Map() }],
    ['bigint', { value: 1n }],
    ['function', { value: () => 1 }],
    ['lone surrogate', { value: '\ud800' }],
  ])('rejects non-canonical input: %s', (_label, input) => {
    expect(() => canonicalizeJson(input)).toThrow(CanonicalJsonError);
  });

  it('rejects circular structures', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalizeJson(cyclic)).toThrow(/Circular/);
  });

  it('allows the same object to appear in sibling positions (not a cycle)', () => {
    const shared = { a: 1 };
    expect(canonicalizeJson({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
  });
});

describe('SHA-256 hashing', () => {
  it('matches the FIPS 180-2 test vectors', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes UTF-8 bytes of non-ASCII text', async () => {
    expect(await sha256Hex('€')).toBe(await sha256Hex(new Uint8Array([0xe2, 0x82, 0xac])));
  });

  it('produces a stable, pinned hash for a known JSON value', async () => {
    // Guards against accidental changes to the canonicalization scheme. Changing this value means
    // every stored document hash in every environment changes — that requires a formal migration.
    // Reference digest computed independently with Node's crypto.createHash('sha256').
    expect(await hashCanonicalJson({ z: [1, 2.5, 'x'], a: { width: 141.73228346456693, unit: 'pt' } })).toBe(
      'a1ac77d9457cf48f5344e1b53a7893493fbd54ac3be72b62132d2fed21c1d387',
    );
  });
});

describe('computeDocumentHash', () => {
  it('returns lower-case hex SHA-256', async () => {
    expect(await computeDocumentHash(createSampleHangTagDocument())).toMatch(SHA256_HEX_PATTERN);
  });

  it('is deterministic for the same design regardless of key order', async () => {
    const doc = createSampleHangTagDocument();
    const reordered = reverseKeyOrder(doc) as typeof doc;
    expect(await computeDocumentHash(reordered)).toBe(await computeDocumentHash(doc));
    expect(await computeDocumentHash(createSampleHangTagDocument())).toBe(await computeDocumentHash(doc));
  });

  it('changes when any design property changes', async () => {
    const original = createSampleHangTagDocument();
    const moved = createSampleHangTagDocument();
    const target = moved.pages[0]!.objects[1]!;
    moved.pages[0]!.objects[1] = { ...target, x: target.x + 0.01 };
    expect(await computeDocumentHash(moved)).not.toBe(await computeDocumentHash(original));
  });
});
