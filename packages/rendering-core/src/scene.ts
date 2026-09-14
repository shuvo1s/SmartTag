import type {
  BarcodeValueIssue,
  LinearSymbolGeometry,
  MatrixSymbolGeometry,
} from '@smarttag/barcode-core';
import type {
  ArtworkObjectType,
  BarcodeSymbology,
  ImageCrop,
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
  /** Controlled font file; renderers resolve it to the exact loaded font. */
  readonly fontAssetId: string | null;
  readonly fontFamily: string;
  /** Size actually used (after SHRINK_TO_FIT). */
  readonly fontSize: number;
  readonly requestedFontSize: number;
  readonly fontWeight: number;
  readonly fontStyle: 'normal' | 'italic';
  readonly letterSpacing: number;
  readonly fill: string;
  readonly clip: boolean;
  /** Text does not fit its frame (reported, never silently truncated). */
  readonly overflow: boolean;
  readonly missingGlyphs: readonly string[];
  readonly metricsSource: 'FONT' | 'APPROXIMATE';
}

export interface ImageSceneNode extends SceneNodeBase {
  readonly kind: 'image';
  readonly assetId: string | null;
  readonly fit: 'contain' | 'cover' | 'stretch';
  readonly crop: ImageCrop | null;
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

/**
 * How a symbol was produced. Anything but ENCODED renders as a clearly labelled placeholder —
 * never as fake, scannable-looking bars.
 * - NO_ENCODER: the renderer was built without a BarcodeEncoder
 * - NOT_ENABLED: the symbology is valid but its preview is not enabled yet
 * - INVALID_VALUE: central validation (barcode-core) rejected the value
 */
export type SymbolStatus =
  'ENCODED' | 'NO_ENCODER' | 'NOT_ENABLED' | 'INVALID_VALUE' | 'ENCODER_ERROR';

interface SymbolNodeState<G> {
  readonly symbolStatus: SymbolStatus;
  /** Geometry relative to the frame's top-left corner; null unless ENCODED. */
  readonly symbol: G | null;
  readonly symbolIssues: readonly BarcodeValueIssue[];
  readonly symbolMessage: string | null;
}

export interface BarcodeSceneNode extends SceneNodeBase, SymbolNodeState<LinearSymbolGeometry> {
  readonly kind: 'barcode';
  readonly symbology: BarcodeSymbology;
  readonly value: string;
  readonly showHumanReadableText: boolean;
  readonly barHeight: number;
  readonly quietZone: number;
  readonly foreground: string;
  readonly background: string | null;
}

export interface QrCodeSceneNode extends SceneNodeBase, SymbolNodeState<MatrixSymbolGeometry> {
  readonly kind: 'qrCode';
  readonly value: string;
  readonly errorCorrection: QrCodeObject['errorCorrection'];
  readonly quietZone: number;
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
