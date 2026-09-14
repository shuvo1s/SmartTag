import type { BarcodeSymbology, QrCodeObject } from '@smarttag/document-schema';

/**
 * Library-agnostic encoder contract. Concrete adapters (e.g. bwip-js, zxing) implement this in the
 * rendering phase; the document model and renderers depend only on these module patterns, so the
 * underlying library can be replaced without touching stored designs.
 */
export interface LinearBarcodePattern {
  readonly kind: 'LINEAR';
  readonly symbology: BarcodeSymbology;
  /** Encoded data including any check digit. */
  readonly encodedValue: string;
  /** Bar (true) / space (false) per module, excluding quiet zones. */
  readonly modules: readonly boolean[];
  readonly humanReadableText: string;
}

export interface MatrixBarcodePattern {
  readonly kind: 'MATRIX';
  readonly symbology: 'QR';
  readonly errorCorrection: QrCodeObject['errorCorrection'];
  /** Modules per side, excluding the quiet zone. */
  readonly size: number;
  /** Row-major dark (true) / light (false) modules. */
  readonly modules: readonly boolean[];
}

export interface BarcodeEncoder {
  readonly name: string;
  readonly version: string;
  supportsLinear(symbology: BarcodeSymbology): boolean;
  encodeLinear(symbology: BarcodeSymbology, value: string): LinearBarcodePattern;
  encodeQr(value: string, errorCorrection: QrCodeObject['errorCorrection']): MatrixBarcodePattern;
}
