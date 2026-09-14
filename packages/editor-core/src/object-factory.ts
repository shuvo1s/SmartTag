import {
  getSafeBox,
  getTrimBox,
  type ArtworkObject,
  type DesignDocument,
  type Rect,
} from '@smarttag/document-schema';
import {
  BLACK,
  computeEffectiveResolution,
  createBarcodeObject,
  createEllipseObject,
  createImageObject,
  createLineObject,
  createQrCodeObject,
  createRectangleObject,
  createTextObject,
  mmToPt,
  normalizeLength,
  rgb,
  solidStroke,
} from '@smarttag/document-utils';
import { newObjectId } from './commands';

export type ToolType =
  'text' | 'image' | 'logo' | 'rectangle' | 'ellipse' | 'line' | 'barcode' | 'qrCode';

/** A registered font face chosen for new text (subset of the registry entry). */
export interface FontChoice {
  readonly assetId: string;
  readonly familyName: string;
  readonly weight: number;
  readonly style: 'NORMAL' | 'ITALIC';
}

export interface ImageAssetChoice {
  readonly id: string;
  readonly filename: string;
  readonly widthPx: number | null;
  readonly heightPx: number | null;
}

const mm = (value: number) => normalizeLength(mmToPt(value));

function centeredFrame(document: DesignDocument, width: number, height: number): Rect {
  const trim = getTrimBox(document.dimensions);
  return {
    x: normalizeLength(trim.width / 2 - width / 2),
    y: normalizeLength(trim.height / 2 - height / 2),
    width,
    height,
  };
}

/** Largest size with the source aspect ratio that fits the box (scaled by `fraction`). */
function fitInside(box: Rect, aspect: number, fraction: number): { width: number; height: number } {
  const maxWidth = box.width * fraction;
  const maxHeight = box.height * fraction;
  const width = Math.min(maxWidth, maxHeight * aspect);
  return { width: normalizeLength(width), height: normalizeLength(width / aspect) };
}

/**
 * New objects for the left toolbar. Every object gets a fresh stable id and appears in the centre
 * of the active artboard, sized for a small label; images fit inside the safe area.
 * zIndex is assigned by `addObjects`.
 */
export function createToolObject(
  tool: ToolType,
  document: DesignDocument,
  options: { readonly font?: FontChoice | null; readonly asset?: ImageAssetChoice | null } = {},
): ArtworkObject {
  const common = { zIndex: 0 };
  switch (tool) {
    case 'text': {
      const frame = centeredFrame(document, mm(30), mm(8));
      const font = options.font ?? null;
      return createTextObject({
        ...common,
        ...frame,
        id: newObjectId('text'),
        name: 'Text',
        content: 'Text',
        fontSize: 10,
        fontAssetId: font?.assetId ?? null,
        fontFamily: font?.familyName ?? 'Noto Sans',
        fontWeight: font?.weight ?? 400,
        fontStyle: font?.style ?? 'NORMAL',
        textColor: rgb('#1F2933'),
        wrap: 'WORD',
        verticalAlign: 'TOP',
      });
    }
    case 'image':
    case 'logo': {
      const asset = options.asset ?? null;
      const safe = getSafeBox(document.dimensions);
      const aspect =
        asset?.widthPx && asset.heightPx && asset.heightPx > 0 ? asset.widthPx / asset.heightPx : 1;
      const size = fitInside(safe, aspect, tool === 'logo' ? 0.5 : 0.6);
      return createImageObject({
        ...common,
        ...centeredFrame(document, size.width, size.height),
        id: newObjectId('image'),
        name: tool === 'logo' ? 'Logo' : (asset?.filename ?? 'Image'),
        assetId: asset?.id ?? null,
        fitMode: 'CONTAIN',
        preserveAspectRatio: true,
      });
    }
    case 'rectangle':
      return createRectangleObject({
        ...common,
        ...centeredFrame(document, mm(20), mm(12)),
        id: newObjectId('rectangle'),
        name: 'Rectangle',
        fill: rgb('#D9E2EC'),
        stroke: null,
        cornerRadius: 0,
      });
    case 'ellipse':
      return createEllipseObject({
        ...common,
        ...centeredFrame(document, mm(16), mm(16)),
        id: newObjectId('ellipse'),
        name: 'Ellipse',
        fill: rgb('#D9E2EC'),
        stroke: null,
      });
    case 'line':
      return createLineObject({
        ...common,
        ...centeredFrame(document, mm(30), 0),
        id: newObjectId('line'),
        name: 'Line',
        stroke: solidStroke(BLACK, 0.5),
      });
    case 'barcode':
      return createBarcodeObject({
        ...common,
        ...centeredFrame(document, mm(36), mm(23)),
        id: newObjectId('barcode'),
        name: 'Barcode',
        symbology: 'EAN13',
        value: '4006381333931',
        barHeight: mm(19),
        quietZone: 11,
        showHumanReadableText: true,
      });
    case 'qrCode':
      return createQrCodeObject({
        ...common,
        ...centeredFrame(document, mm(20), mm(20)),
        id: newObjectId('qrCode'),
        name: 'QR code',
        value: 'https://example.com',
        errorCorrection: 'M',
        quietZone: 4,
      });
  }
}

export type ResolutionRating = 'GOOD' | 'WARNING' | 'LOW';

/**
 * Provisional effective-resolution thresholds (docs/editor.md); production preflight will make
 * them configurable per customer and output process.
 */
export const RESOLUTION_THRESHOLDS = { good: 300, warning: 150 } as const;

export interface ResolutionReport {
  readonly effectivePpi: number;
  readonly rating: ResolutionRating;
}

export function rateImageResolution(
  object: Extract<ArtworkObject, { type: 'image' }>,
  asset: { widthPx: number | null; heightPx: number | null; mimeType: string },
): ResolutionReport | null {
  if (asset.mimeType === 'image/svg+xml' || !asset.widthPx || !asset.heightPx) {
    return null;
  }
  const { effectivePpi } = computeEffectiveResolution(
    { widthPx: asset.widthPx, heightPx: asset.heightPx },
    object,
  );
  const rating: ResolutionRating =
    effectivePpi >= RESOLUTION_THRESHOLDS.good
      ? 'GOOD'
      : effectivePpi >= RESOLUTION_THRESHOLDS.warning
        ? 'WARNING'
        : 'LOW';
  return { effectivePpi, rating };
}
