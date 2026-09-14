import { ELEMENT_ID_PATTERN } from '@smarttag/document-schema';
import { getWebCrypto } from './platform';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
// Largest multiple of 62 below 256 — bytes above it are rejected to avoid modulo bias.
const UNBIASED_BYTE_LIMIT = 248;

/** Random, URL-safe element id such as `txt_3fK9aQ2mZr1x`. */
export function createElementId(prefix = 'el', length = 12): string {
  if (!/^[a-z]{1,8}$/.test(prefix)) {
    throw new RangeError('Element id prefix must be 1–8 lowercase letters');
  }
  const crypto = getWebCrypto();
  let suffix = '';
  while (suffix.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte < UNBIASED_BYTE_LIMIT && suffix.length < length) {
        suffix += ALPHABET[byte % ALPHABET.length];
      }
    }
  }
  const id = `${prefix}_${suffix}`;
  if (!ELEMENT_ID_PATTERN.test(id)) {
    throw new RangeError(`Generated element id "${id}" is invalid`);
  }
  return id;
}

export function createDocumentId(): string {
  return getWebCrypto().randomUUID();
}
