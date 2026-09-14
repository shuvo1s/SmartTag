import type { BarcodeObject, BarcodeSymbology, QrCodeObject } from '@smarttag/document-schema';
import type { BarcodeEncoder, LinearBarcodePattern, MatrixBarcodePattern } from './encoder';
import { SYMBOLOGY_SPECS } from './symbologies';
import { validateBarcodeValue, validateQrValue, type BarcodeValueIssue } from './validate';

/**
 * Symbologies rendered as real symbols in designer previews (Phase 2). Others remain valid in
 * documents and are preserved, but preview as clearly labelled placeholders until each is verified.
 */
export const PREVIEW_ENABLED_SYMBOLOGIES: readonly BarcodeSymbology[] = ['CODE128', 'EAN13'];

export function isPreviewEnabledSymbology(symbology: BarcodeSymbology): boolean {
  return PREVIEW_ENABLED_SYMBOLOGIES.includes(symbology);
}

export type SymbolEncodingResult<P> =
  | { readonly status: 'ENCODED'; readonly pattern: P }
  | { readonly status: 'INVALID_VALUE'; readonly issues: readonly BarcodeValueIssue[] }
  | { readonly status: 'NOT_ENABLED'; readonly message: string }
  | { readonly status: 'ENCODER_ERROR'; readonly message: string };

/**
 * The only way editors and renderers turn a barcode object into bars: central validation first
 * (never duplicated in UI code), then the injected encoder.
 */
export function encodeBarcodeObject(
  encoder: BarcodeEncoder,
  object: Pick<BarcodeObject, 'symbology' | 'value'>,
): SymbolEncodingResult<LinearBarcodePattern> {
  if (!isPreviewEnabledSymbology(object.symbology) || !encoder.supportsLinear(object.symbology)) {
    return {
      status: 'NOT_ENABLED',
      message: `${SYMBOLOGY_SPECS[object.symbology].displayName} preview is not enabled yet`,
    };
  }
  const validation = validateBarcodeValue(object.symbology, object.value);
  if (!validation.valid) {
    return { status: 'INVALID_VALUE', issues: validation.issues };
  }
  try {
    return {
      status: 'ENCODED',
      pattern: encoder.encodeLinear(object.symbology, validation.normalizedValue),
    };
  } catch (error) {
    return {
      status: 'ENCODER_ERROR',
      message: error instanceof Error ? error.message : 'Barcode could not be encoded',
    };
  }
}

export function encodeQrCodeObject(
  encoder: BarcodeEncoder,
  object: Pick<QrCodeObject, 'value' | 'errorCorrection'>,
): SymbolEncodingResult<MatrixBarcodePattern> {
  const validation = validateQrValue(object.value, object.errorCorrection);
  if (!validation.valid) {
    return { status: 'INVALID_VALUE', issues: validation.issues };
  }
  try {
    return {
      status: 'ENCODED',
      pattern: encoder.encodeQr(validation.normalizedValue, object.errorCorrection),
    };
  } catch (error) {
    return {
      status: 'ENCODER_ERROR',
      message: error instanceof Error ? error.message : 'QR code could not be encoded',
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Geometry. All coordinates are points relative to the object's frame top-left corner.
// ---------------------------------------------------------------------------------------------

export interface SymbolRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SymbolText {
  readonly text: string;
  readonly x: number;
  /** Alphabetic baseline. */
  readonly y: number;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly fontSize: number;
}

export interface LinearSymbolGeometry {
  readonly kind: 'LINEAR';
  /** X-dimension in points. */
  readonly moduleWidth: number;
  readonly bars: readonly SymbolRect[];
  readonly texts: readonly SymbolText[];
  /** True when human-readable text was requested but the frame leaves no room for it. */
  readonly textSuppressed: boolean;
}

export interface MatrixSymbolGeometry {
  readonly kind: 'MATRIX';
  readonly moduleSize: number;
  /** Dark modules merged into horizontal runs. */
  readonly runs: readonly SymbolRect[];
  /** The symbol square including its quiet zone (for the background fill). */
  readonly bounds: SymbolRect;
}

export interface LinearLayoutOptions {
  readonly width: number;
  readonly height: number;
  readonly quietZone: number;
  readonly barHeight: number;
  readonly showHumanReadableText: boolean;
}

/** Approximate OCR-B-like text proportions; human-readable text is a preview aid in Phase 2. */
const TEXT_ASCENT = 0.72;
const MIN_TEXT_SIZE_PT = 2;

export function layoutLinearSymbol(
  pattern: LinearBarcodePattern,
  options: LinearLayoutOptions,
): LinearSymbolGeometry {
  const { width, height, quietZone, showHumanReadableText } = options;
  const moduleCount = pattern.modules.length;
  const moduleWidth = width / (moduleCount + 2 * quietZone);
  const barHeight = Math.min(options.barHeight, height);
  const textArea = height - barHeight;
  const fontSize = Math.min(textArea / (TEXT_ASCENT + 0.18), moduleWidth * 9);
  const showText = showHumanReadableText && fontSize >= MIN_TEXT_SIZE_PT;
  const guardExtension = showText ? Math.min(moduleWidth * 5, textArea * 0.5) : 0;

  const bars: SymbolRect[] = [];
  let index = 0;
  while (index < moduleCount) {
    if (!pattern.modules[index]) {
      index += 1;
      continue;
    }
    const guard = pattern.guardModules[index] ?? false;
    let end = index + 1;
    while (
      end < moduleCount &&
      pattern.modules[end] &&
      (pattern.guardModules[end] ?? false) === guard
    ) {
      end += 1;
    }
    bars.push({
      x: (quietZone + index) * moduleWidth,
      y: 0,
      width: (end - index) * moduleWidth,
      height: barHeight + (guard ? guardExtension : 0),
    });
    index = end;
  }

  const texts: SymbolText[] = [];
  if (showText) {
    const baseline =
      barHeight + (textArea - fontSize * (TEXT_ASCENT + 0.18)) / 2 + fontSize * TEXT_ASCENT;
    const moduleX = (module: number) => (quietZone + module) * moduleWidth;
    const digits = pattern.humanReadableText;
    if (pattern.symbology === 'EAN13' && /^\d{13}$/.test(digits) && moduleCount === 95) {
      // GS1 layout: first digit in the left quiet zone, then two groups of six under each half.
      texts.push({
        text: digits.slice(0, 1),
        x: moduleX(-1),
        y: baseline,
        anchor: 'end',
        fontSize,
      });
      texts.push({
        text: digits.slice(1, 7),
        x: moduleX(3 + 21),
        y: baseline,
        anchor: 'middle',
        fontSize,
      });
      texts.push({
        text: digits.slice(7),
        x: moduleX(50 + 21),
        y: baseline,
        anchor: 'middle',
        fontSize,
      });
    } else {
      texts.push({ text: digits, x: width / 2, y: baseline, anchor: 'middle', fontSize });
    }
  }

  return {
    kind: 'LINEAR',
    moduleWidth,
    bars,
    texts,
    textSuppressed: showHumanReadableText && !showText,
  };
}

export function layoutMatrixSymbol(
  pattern: MatrixBarcodePattern,
  options: { readonly width: number; readonly height: number; readonly quietZone: number },
): MatrixSymbolGeometry {
  const span = pattern.size + 2 * options.quietZone;
  const side = Math.min(options.width, options.height);
  const moduleSize = side / span;
  const originX = (options.width - side) / 2;
  const originY = (options.height - side) / 2;
  const runs: SymbolRect[] = [];
  for (let row = 0; row < pattern.size; row += 1) {
    let column = 0;
    while (column < pattern.size) {
      if (!pattern.modules[row * pattern.size + column]) {
        column += 1;
        continue;
      }
      let end = column + 1;
      while (end < pattern.size && pattern.modules[row * pattern.size + end]) {
        end += 1;
      }
      runs.push({
        x: originX + (options.quietZone + column) * moduleSize,
        y: originY + (options.quietZone + row) * moduleSize,
        width: (end - column) * moduleSize,
        height: moduleSize,
      });
      column = end;
    }
  }
  return {
    kind: 'MATRIX',
    moduleSize,
    runs,
    bounds: { x: originX, y: originY, width: side, height: side },
  };
}
