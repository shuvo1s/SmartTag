import type {
  ArtworkObjectType,
  BarcodeSymbology,
  PageSide,
  QrCodeObject,
  Rect,
} from '@smarttag/document-schema';

/**
 * A PageScene is a flat, renderer-agnostic display list derived from one page of a canonical
 * document. All layout decisions that must be identical across output targets (z-order, visibility,
 * text line placement, mirroring of dieline features, color fallbacks) are made while building the
 * scene. Serializers (SVG today; PDF/PNG later) only translate primitives — they never interpret
 * the document model. Units are points in trim space.
 */
export interface PageScene {
  readonly documentId: string;
  readonly pageId: string;
  readonly pageName: string;
  readonly side: PageSide;
  readonly boxes: SceneBoxes;
  /** CSS color filling the bleed box, or null for unprinted substrate. */
  readonly background: string | null;
  readonly trimCornerRadius: number;
  readonly dieline: readonly SceneDielineFeature[];
  readonly nodes: readonly SceneNode[];
}

export interface SceneBoxes {
  readonly trim: Rect;
  readonly bleed: Rect;
  readonly safe: Rect;
  readonly margin: Rect;
}

export type SceneDielineFeature =
  | {
      readonly id: string;
      readonly kind: 'PUNCH_HOLE';
      readonly cx: number;
      readonly cy: number;
      readonly radius: number;
    }
  | {
      readonly id: string;
      readonly kind: 'SLOT_HOLE';
      readonly cx: number;
      readonly cy: number;
      readonly width: number;
      readonly height: number;
      readonly rotation: number;
    }
  | {
      readonly id: string;
      readonly kind: 'FOLD_LINE' | 'PERFORATION';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly dash: readonly number[];
    };

export interface SceneStroke {
  readonly color: string;
  readonly width: number;
  readonly dash: readonly number[];
  readonly lineCap: 'butt' | 'round' | 'square';
  readonly lineJoin: 'miter' | 'round' | 'bevel';
}

interface SceneNodeBase {
  readonly id: string;
  readonly name: string;
  readonly objectType: ArtworkObjectType;
  readonly frame: Rect;
  /** Clockwise degrees about the frame centre. */
  readonly rotation: number;
  readonly opacity: number;
  /** True when at least one property is bound to a data field (useful for preview highlighting). */
  readonly dataBound: boolean;
}

export interface SceneTextLine {
  readonly text: string;
  readonly x: number;
  /** Alphabetic baseline. */
  readonly y: number;
}

export interface TextSceneNode extends SceneNodeBase {
  readonly kind: 'text';
  readonly lines: readonly SceneTextLine[];
  readonly anchor: 'start' | 'middle' | 'end';
  readonly direction: 'ltr' | 'rtl';
  readonly language: string | null;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly fontStyle: 'normal' | 'italic';
  readonly letterSpacing: number;
  readonly fill: string;
  readonly clip: boolean;
}

export interface ImageSceneNode extends SceneNodeBase {
  readonly kind: 'image';
  readonly assetId: string | null;
  readonly fit: 'contain' | 'cover' | 'stretch';
}

export interface RectangleSceneNode extends SceneNodeBase {
  readonly kind: 'rectangle';
  readonly fill: string | null;
  readonly stroke: SceneStroke | null;
  readonly cornerRadius: number;
}

export interface EllipseSceneNode extends SceneNodeBase {
  readonly kind: 'ellipse';
  readonly fill: string | null;
  readonly stroke: SceneStroke | null;
}

export interface LineSceneNode extends SceneNodeBase {
  readonly kind: 'line';
  readonly stroke: SceneStroke;
}

/** Phase 1 renders symbols as clearly-labelled placeholders — never as fake, scannable-looking bars. */
export interface BarcodeSceneNode extends SceneNodeBase {
  readonly kind: 'barcode';
  readonly symbology: BarcodeSymbology;
  readonly value: string;
  readonly showHumanReadableText: boolean;
  readonly barHeight: number;
  readonly foreground: string;
  readonly background: string | null;
}

export interface QrCodeSceneNode extends SceneNodeBase {
  readonly kind: 'qrCode';
  readonly value: string;
  readonly errorCorrection: QrCodeObject['errorCorrection'];
  readonly foreground: string;
  readonly background: string | null;
}

export type SceneNode =
  | TextSceneNode
  | ImageSceneNode
  | RectangleSceneNode
  | EllipseSceneNode
  | LineSceneNode
  | BarcodeSceneNode
  | QrCodeSceneNode;
