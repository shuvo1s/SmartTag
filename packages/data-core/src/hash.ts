import { SHA256_HEX_PATTERN, hashCanonicalJson } from '@smarttag/document-utils';
import type { NormalizedDataRecord } from './validate-record';

export const RESOLVED_INPUT_HASH_SCHEME = 'smarttag-resolved-input-v1' as const;

/** How a resolved-input hash was produced; recorded next to future production outputs. */
export const RESOLVED_INPUT_HASH_METHOD =
  `SHA-256/RFC8785-JCS/${RESOLVED_INPUT_HASH_SCHEME}` as const;

/**
 * Identity of one resolved piece of artwork input:
 *
 *   SHA-256( canonical JSON { scheme, templateVersionHash, record } )
 *
 * `record` must be a normalized record (`validateDataRecord(...).normalizedRecord`), so the same
 * logical data — regardless of key order, number formatting ("39.95" vs 39.95) or defaults supplied
 * explicitly — always gives the same hash on every platform. Combined later with a renderer
 * version this identifies a reproducible VDP output. Nothing here depends on test data being
 * stored with the template: the template hash is an input, never an output.
 */
export async function computeResolvedInputHash(
  templateVersionHash: string,
  normalizedRecord: NormalizedDataRecord,
): Promise<string> {
  if (!SHA256_HEX_PATTERN.test(templateVersionHash)) {
    throw new RangeError('templateVersionHash must be a lower-case SHA-256 hex digest');
  }
  return hashCanonicalJson({
    scheme: RESOLVED_INPUT_HASH_SCHEME,
    templateVersionHash,
    record: normalizedRecord,
  });
}
