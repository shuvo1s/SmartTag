import type {
  BarcodeObject,
  EllipseObject,
  ImageObject,
  LineObject,
  QrCodeObject,
  RectangleObject,
  TextObject,
} from '@smarttag/document-schema';
import { createElementId } from '../ids';
import { BLACK, DEFAULT_FONT_FAMILY, WHITE, solidStroke, staticBinding } from './primitives';

/**
 * Factories that produce complete, canonical artwork objects with explicit defaults.
 * Canvas adapters (Phase 2) and importers use these instead of hand-assembling objects,
 * so every object always carries every required key.
 */

interface FrameInit {
  id?: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  groupId?: string | null;
}

type Overrides<T, K extends keyof T> = Partial<Omit<T, K | 'type' | 'bindings'>> & {
  bindings?: Partial<T extends { bindings: infer B } ? B : never>;
};

type BaseKeys = keyof FrameInit;

function base(init: FrameInit, prefix: string) {
  return {
    id: init.id ?? createElementId(prefix),
    name: init.name ?? '',
    x: init.x,
    y: init.y,
    width: init.width,
    height: init.height,
    rotation: init.rotation ?? 0,
    opacity: init.opacity ?? 1,
    visible: init.visible ?? true,
    locked: init.locked ?? false,
    zIndex: init.zIndex,
    groupId: init.groupId ?? null,
    metadata: {},
  };
}

export function createTextObject(init: FrameInit & Overrides<TextObject, BaseKeys>): TextObject {
  return {
    ...base(init, 'txt'),
    type: 'text',
    content: init.content ?? '',
    fontFamily: init.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontSize: init.fontSize ?? 10,
    fontWeight: init.fontWeight ?? 400,
    fontStyle: init.fontStyle ?? 'NORMAL',
    textAlign: init.textAlign ?? 'START',
    verticalAlign: init.verticalAlign ?? 'TOP',
    lineHeight: init.lineHeight ?? 1.2,
    letterSpacing: init.letterSpacing ?? 0,
    textColor: init.textColor ?? BLACK,
    direction: init.direction ?? 'AUTO',
    language: init.language ?? null,
    overflow: init.overflow ?? { mode: 'VISIBLE' },
    metadata: init.metadata ?? {},
    bindings: {
      content: init.bindings?.content ?? staticBinding(),
      visible: init.bindings?.visible ?? staticBinding(),
    },
  };
}

export function createImageObject(init: FrameInit & Overrides<ImageObject, BaseKeys>): ImageObject {
  return {
    ...base(init, 'img'),
    type: 'image',
    assetId: init.assetId ?? null,
    fitMode: init.fitMode ?? 'CONTAIN',
    crop: init.crop ?? null,
    preserveAspectRatio: init.preserveAspectRatio ?? true,
    metadata: init.metadata ?? {},
    bindings: {
      assetId: init.bindings?.assetId ?? staticBinding(),
      visible: init.bindings?.visible ?? staticBinding(),
    },
  };
}

export function createRectangleObject(
  init: FrameInit & Overrides<RectangleObject, BaseKeys>,
): RectangleObject {
  return {
    ...base(init, 'rect'),
    type: 'rectangle',
    fill: init.fill === undefined ? WHITE : init.fill,
    stroke: init.stroke ?? null,
    cornerRadius: init.cornerRadius ?? 0,
    metadata: init.metadata ?? {},
    bindings: { visible: init.bindings?.visible ?? staticBinding() },
  };
}

export function createEllipseObject(init: FrameInit & Overrides<EllipseObject, BaseKeys>): EllipseObject {
  return {
    ...base(init, 'ell'),
    type: 'ellipse',
    fill: init.fill === undefined ? WHITE : init.fill,
    stroke: init.stroke ?? null,
    metadata: init.metadata ?? {},
    bindings: { visible: init.bindings?.visible ?? staticBinding() },
  };
}

export function createLineObject(init: FrameInit & Overrides<LineObject, BaseKeys>): LineObject {
  return {
    ...base(init, 'line'),
    type: 'line',
    stroke: init.stroke ?? solidStroke(BLACK, 0.5),
    metadata: init.metadata ?? {},
    bindings: { visible: init.bindings?.visible ?? staticBinding() },
  };
}

export function createBarcodeObject(init: FrameInit & Overrides<BarcodeObject, BaseKeys>): BarcodeObject {
  return {
    ...base(init, 'bc'),
    type: 'barcode',
    symbology: init.symbology ?? 'CODE128',
    value: init.value ?? '',
    showHumanReadableText: init.showHumanReadableText ?? true,
    quietZone: init.quietZone ?? 10,
    barHeight: init.barHeight ?? init.height,
    foregroundColor: init.foregroundColor ?? BLACK,
    backgroundColor: init.backgroundColor === undefined ? WHITE : init.backgroundColor,
    metadata: init.metadata ?? {},
    bindings: {
      value: init.bindings?.value ?? staticBinding(),
      visible: init.bindings?.visible ?? staticBinding(),
    },
  };
}

export function createQrCodeObject(init: FrameInit & Overrides<QrCodeObject, BaseKeys>): QrCodeObject {
  return {
    ...base(init, 'qr'),
    type: 'qrCode',
    value: init.value ?? '',
    errorCorrection: init.errorCorrection ?? 'M',
    foregroundColor: init.foregroundColor ?? BLACK,
    backgroundColor: init.backgroundColor === undefined ? WHITE : init.backgroundColor,
    quietZone: init.quietZone ?? 4,
    metadata: init.metadata ?? {},
    bindings: {
      value: init.bindings?.value ?? staticBinding(),
      visible: init.bindings?.visible ?? staticBinding(),
    },
  };
}
