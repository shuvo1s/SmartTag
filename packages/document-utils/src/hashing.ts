import type { DesignDocument } from '@smarttag/document-schema';
import { CANONICALIZATION_SCHEME, canonicalizeJson } from './canonical-json';
import { encodeUtf8, getWebCrypto } from './platform';

export const DOCUMENT_HASH_ALGORITHM = 'SHA-256' as const;

/** Describes exactly how a document hash was produced; recorded alongside production outputs. */
export const DOCUMENT_HASH_METHOD = `${DOCUMENT_HASH_ALGORITHM}/${CANONICALIZATION_SCHEME}/UTF-8` as const;

export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? encodeUtf8(input) : input;
  const digest = await getWebCrypto().subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 (lower-case hex) of the canonical JSON form of any plain JSON value. */
export async function hashCanonicalJson(value: unknown): Promise<string> {
  return sha256Hex(canonicalizeJson(value));
}

/**
 * Deterministic content hash of a design document.
 *
 * Two documents have the same hash if and only if they are the same design, regardless of key
 * order or formatting. Combined later with a dataset hash and renderer version, this identifies a
 * reproducible production output: TemplateVersion + Dataset + RendererVersion.
 */
export async function computeDocumentHash(document: DesignDocument): Promise<string> {
  return hashCanonicalJson(document);
}
