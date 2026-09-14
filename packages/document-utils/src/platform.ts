/**
 * Minimal, structurally-typed access to Web Platform APIs that exist in every supported runtime
 * (Node.js 24+, modern browsers, workers). Keeps this package free of Node-only imports so it can
 * be bundled for the browser, and free of DOM lib typings so it cannot accidentally use the DOM.
 */
interface WebCryptoLike {
  readonly subtle: {
    digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
  };
  getRandomValues<T extends Uint8Array>(array: T): T;
  randomUUID(): string;
}

interface TextEncoderLike {
  encode(input: string): Uint8Array;
}

const platform = globalThis as unknown as {
  crypto?: WebCryptoLike;
  TextEncoder?: new () => TextEncoderLike;
};

export function getWebCrypto(): WebCryptoLike {
  const crypto = platform.crypto;
  if (!crypto?.subtle) {
    throw new Error('The Web Crypto API is not available in this runtime');
  }
  return crypto;
}

export function encodeUtf8(input: string): Uint8Array {
  if (!platform.TextEncoder) {
    throw new Error('TextEncoder is not available in this runtime');
  }
  return new platform.TextEncoder().encode(input);
}
