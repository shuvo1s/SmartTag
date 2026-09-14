import type { BarcodeSymbology } from '@smarttag/document-schema';

export type SymbologyCharset = 'DIGITS' | 'ASCII' | 'CODE39' | 'GS1_ELEMENT_STRING';

export type SymbologyLengths =
  | { readonly kind: 'FIXED'; readonly values: readonly number[] }
  | { readonly kind: 'RANGE'; readonly min: number; readonly max: number };

const fixed = (...values: number[]): SymbologyLengths => ({ kind: 'FIXED', values });
const range = (min: number, max: number): SymbologyLengths => ({ kind: 'RANGE', min, max });

export interface SymbologySpec {
  readonly symbology: BarcodeSymbology;
  readonly displayName: string;
  readonly charset: SymbologyCharset;
  /** Accepted input lengths. For GS1 mod-10 symbologies the longer fixed length includes the check digit. */
  readonly lengths: SymbologyLengths;
  readonly checkDigit: 'GS1_MOD10' | 'AUTOMATIC' | 'NONE';
  /** Recommended quiet zone per side, in modules (X-dimension). */
  readonly recommendedQuietZone: number;
  readonly isGs1: boolean;
}

export const SYMBOLOGY_SPECS: Readonly<Record<BarcodeSymbology, SymbologySpec>> = {
  CODE128: {
    symbology: 'CODE128',
    displayName: 'Code 128',
    charset: 'ASCII',
    lengths: range(1, 80),
    checkDigit: 'AUTOMATIC',
    recommendedQuietZone: 10,
    isGs1: false,
  },
  EAN13: {
    symbology: 'EAN13',
    displayName: 'EAN-13',
    charset: 'DIGITS',
    lengths: fixed(12, 13),
    checkDigit: 'GS1_MOD10',
    recommendedQuietZone: 11,
    isGs1: true,
  },
  EAN8: {
    symbology: 'EAN8',
    displayName: 'EAN-8',
    charset: 'DIGITS',
    lengths: fixed(7, 8),
    checkDigit: 'GS1_MOD10',
    recommendedQuietZone: 7,
    isGs1: true,
  },
  UPCA: {
    symbology: 'UPCA',
    displayName: 'UPC-A',
    charset: 'DIGITS',
    lengths: fixed(11, 12),
    checkDigit: 'GS1_MOD10',
    recommendedQuietZone: 9,
    isGs1: true,
  },
  UPCE: {
    symbology: 'UPCE',
    displayName: 'UPC-E',
    charset: 'DIGITS',
    lengths: fixed(7, 8),
    checkDigit: 'GS1_MOD10',
    recommendedQuietZone: 9,
    isGs1: true,
  },
  CODE39: {
    symbology: 'CODE39',
    displayName: 'Code 39',
    charset: 'CODE39',
    lengths: range(1, 43),
    checkDigit: 'NONE',
    recommendedQuietZone: 10,
    isGs1: false,
  },
  ITF14: {
    symbology: 'ITF14',
    displayName: 'ITF-14',
    charset: 'DIGITS',
    lengths: fixed(13, 14),
    checkDigit: 'GS1_MOD10',
    recommendedQuietZone: 10,
    isGs1: true,
  },
  GS1_128: {
    symbology: 'GS1_128',
    displayName: 'GS1-128',
    charset: 'GS1_ELEMENT_STRING',
    lengths: range(4, 48),
    checkDigit: 'AUTOMATIC',
    recommendedQuietZone: 10,
    isGs1: true,
  },
};
