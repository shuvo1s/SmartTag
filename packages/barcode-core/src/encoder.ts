import type { BarcodeSymbology, QrCodeObject } from '@smarttag/document-schema';

/**
 * Library-agnostic encoder contract. Concrete adapters (today `@smarttag/barcode-bwip`) implement
 * it; editors and renderers depend only on these module patterns, so the underlying library can be
 * replaced without touching stored designs or rendering code.
 */
export interface LinearBarcodePattern {
  readonly kind: 'LINEAR';
  readonly symbology: BarcodeSymbology;
  /** Encoded data including any check digit. */
  readonly encodedValue: string;
  /** Bar (true) / space (false) per module, excluding quiet zones. */
  readonly modules: readonly boolean[];
  /**
   * Same length as `modules`: true for bar modules of guard patterns that extend into the
   * human-readable text area (EAN/UPC start, centre and end guards).
   */
  readonly guardModules: readonly boolean[];
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
  /** Library name and version, recorded with rendered output for reproducibility. */
  readonly name: string;
  readonly version: string;
  supportsLinear(symbology: BarcodeSymbology): boolean;
  /** Encodes a value that already passed `validateBarcodeValue`. Throws on library failure. */
  encodeLinear(symbology: BarcodeSymbology, value: string): LinearBarcodePattern;
  encodeQr(value: string, errorCorrection: QrCodeObject['errorCorrection']): MatrixBarcodePattern;
}
