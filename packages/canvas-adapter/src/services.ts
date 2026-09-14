import type { BarcodeEncoder } from '@smarttag/barcode-core';
import type { TextLayoutEngine } from '@smarttag/rendering-core';

/**
 * Font state of a text object's controlled font file:
 * - UNASSIGNED: the text has no fontAssetId (e.g. migrated schema v1 text)
 * - UNKNOWN: the id is not in the organization's font registry
 * - LOADING / LOADED / FAILED: browser loading of the exact font file
 * Anything but LOADED is shown as an explicit warning — never silently replaced.
 */
export type FontLoadStatus = 'UNASSIGNED' | 'UNKNOWN' | 'LOADING' | 'LOADED' | 'FAILED';

export interface FontProvider {
  status(fontAssetId: string | null): FontLoadStatus;
  /** CSS family name under which the exact font file is registered; null unless LOADED. */
  cssFamily(fontAssetId: string | null): string | null;
}

export type ImageLoadStatus = 'LOADING' | 'LOADED' | 'FAILED';

export interface ImageEntry {
  readonly status: ImageLoadStatus;
  readonly image: CanvasImageSource | null;
  /** Intrinsic size used for fit and crop. */
  readonly width: number;
  readonly height: number;
}

export interface ImageProvider {
  get(assetId: string): ImageEntry;
}

/** Everything the canvas needs to draw canonical artwork. Injected by the application. */
export interface RenderServices {
  readonly textLayout: TextLayoutEngine;
  /** null renders symbols as labelled placeholders. */
  readonly barcodeEncoder: BarcodeEncoder | null;
  readonly fonts: FontProvider;
  readonly images: ImageProvider;
}

/** Services without browser resources (tests, server-side tooling). */
export const NULL_FONT_PROVIDER: FontProvider = {
  status: (fontAssetId) => (fontAssetId === null ? 'UNASSIGNED' : 'UNKNOWN'),
  cssFamily: () => null,
};

export const NULL_IMAGE_PROVIDER: ImageProvider = {
  get: () => ({ status: 'FAILED', image: null, width: 0, height: 0 }),
};
