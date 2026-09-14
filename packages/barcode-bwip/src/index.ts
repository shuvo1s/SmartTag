/**
 * @smarttag/barcode-bwip
 *
 * Implements the library-agnostic `BarcodeEncoder` contract from `@smarttag/barcode-core` with
 * bwip-js (Barcode Writer in Pure PostScript). Applications inject the encoder; editors,
 * renderers and stored documents never reference bwip-js directly, so it can be replaced.
 */
import type {
  BarcodeEncoder,
  LinearBarcodePattern,
  MatrixBarcodePattern,
} from '@smarttag/barcode-core';
import type { BarcodeSymbology, QrCodeObject } from '@smarttag/document-schema';
import bwipjs from 'bwip-js';

const BCID: Readonly<Record<BarcodeSymbology, string>> = {
  CODE128: 'code128',
  EAN13: 'ean13',
  EAN8: 'ean8',
  UPCA: 'upca',
  UPCE: 'upce',
  CODE39: 'code39',
  ITF14: 'itf14',
  GS1_128: 'gs1-128',
};

interface LinearRaw {
  readonly sbs: readonly number[];
  readonly bhs: readonly number[];
}

interface MatrixRaw {
  readonly pixs: readonly number[];
  readonly pixx: number;
  readonly pixy: number;
}

export function createBwipBarcodeEncoder(): BarcodeEncoder {
  return {
    name: 'bwip-js',
    version: String(bwipjs.BWIPJS_VERSION).split(' ')[0] ?? 'unknown',

    supportsLinear(symbology: BarcodeSymbology): boolean {
      return symbology in BCID;
    },

    encodeLinear(symbology: BarcodeSymbology, value: string): LinearBarcodePattern {
      // includetext makes bwip-js report guard-bar heights; the text itself is laid out by
      // barcode-core, not by bwip-js.
      const [raw] = bwipjs.raw({
        bcid: BCID[symbology],
        text: value,
        includetext: true,
      }) as unknown as LinearRaw[];
      if (!raw || !Array.isArray(raw.sbs)) {
        throw new Error(`bwip-js returned no linear encoding for ${symbology}`);
      }
      const modules: boolean[] = [];
      const guardModules: boolean[] = [];
      raw.sbs.forEach((width, index) => {
        const bar = index % 2 === 0;
        // bhs holds one height per bar; guard bars are taller than the nominal 1.0.
        const guard = bar && (raw.bhs[index / 2] ?? 1) > 1.0001;
        for (let module = 0; module < width; module += 1) {
          modules.push(bar);
          guardModules.push(guard);
        }
      });
      return {
        kind: 'LINEAR',
        symbology,
        encodedValue: value,
        modules,
        guardModules,
        humanReadableText: value,
      };
    },

    encodeQr(
      value: string,
      errorCorrection: QrCodeObject['errorCorrection'],
    ): MatrixBarcodePattern {
      const [raw] = bwipjs.raw({
        bcid: 'qrcode',
        // bwip-js encodes the JavaScript string as UTF-8 bytes (byte mode), verified by decoding.
        text: value,
        eclevel: errorCorrection,
      } as unknown as Parameters<typeof bwipjs.raw>[0]) as unknown as MatrixRaw[];
      if (!raw || !Array.isArray(raw.pixs) || raw.pixx !== raw.pixy) {
        throw new Error('bwip-js returned no QR encoding');
      }
      return {
        kind: 'MATRIX',
        symbology: 'QR',
        errorCorrection,
        size: raw.pixx,
        modules: raw.pixs.map((pixel) => pixel === 1),
      };
    },
  };
}
