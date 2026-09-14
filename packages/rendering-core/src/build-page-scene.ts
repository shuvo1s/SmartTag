import {
  encodeBarcodeObject,
  encodeQrCodeObject,
  layoutLinearSymbol,
  layoutMatrixSymbol,
  type BarcodeEncoder,
} from '@smarttag/barcode-core';
import {
  getBleedBox,
  getMarginBox,
  getSafeBox,
  getTrimBox,
  type ArtworkObject,
  type BarcodeObject,
  type DesignDocument,
  type DielineFeature,
  type Page,
  type PrintSettings,
  type QrCodeObject,
} from '@smarttag/document-schema';
import { collectBoundProperties } from '@smarttag/document-utils';
import { colorToCss, strokeToScene } from './color';
import type {
  BarcodeSceneNode,
  PageScene,
  QrCodeSceneNode,
  SceneDielineFeature,
  SceneNode,
} from './scene';
import { layoutTextApproximately, type TextLayoutEngine } from './text-layout';

export interface BuildSceneOptions {
  /** Include objects whose `visible` flag (or group) is false. Useful for editor-like previews. */
  readonly includeHidden?: boolean;
  /**
   * Text layout engine. Browsers pass an engine that measures with the exact loaded font files;
   * without one, a deterministic approximation is used (tests, server previews).
   */
  readonly textLayout?: TextLayoutEngine;
  /** Barcode/QR encoder. Without one, symbols render as labelled placeholders. */
  readonly barcodeEncoder?: BarcodeEncoder;
}

export class PageNotFoundError extends Error {
  constructor(readonly pageId: string) {
    super(`Page "${pageId}" does not exist in the document`);
    this.name = 'PageNotFoundError';
  }
}

/**
 * Builds the display list for one page. The document must already be validated
 * (and, for production output, have its data bindings resolved).
 */
export function buildPageScene(
  document: DesignDocument,
  pageId: string,
  options: BuildSceneOptions = {},
): PageScene {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    throw new PageNotFoundError(pageId);
  }
  const { dimensions } = document;
  const boundObjectIds = new Set(
    collectBoundProperties(document)
      .filter((bound) => bound.pageId === page.id)
      .map((bound) => bound.objectId),
  );

  return {
    documentId: document.documentId,
    pageId: page.id,
    pageName: page.name,
    side: page.side,
    boxes: {
      trim: getTrimBox(dimensions),
      bleed: getBleedBox(dimensions),
      safe: getSafeBox(dimensions),
      margin: getMarginBox(dimensions),
    },
    background: page.background ? colorToCss(page.background) : null,
    trimCornerRadius: dimensions.dieline.trimShape.cornerRadius,
    dieline: dimensions.dieline.features.map((feature) =>
      toSceneFeature(feature, page, dimensions, document.printSettings),
    ),
    nodes: visibleObjectsInPaintOrder(page, options.includeHidden ?? false).map((object) =>
      toSceneNode(object, boundObjectIds.has(object.id), options),
    ),
  };
}

export type PageGuides = Pick<
  PageScene,
  'pageId' | 'side' | 'boxes' | 'background' | 'trimCornerRadius' | 'dieline'
>;

/**
 * Non-printing production geometry of a page (boxes and mirrored dieline features) without
 * building artwork nodes. Editor overlays use it so guides match the canonical renderer exactly.
 */
export function buildPageGuides(document: DesignDocument, pageId: string): PageGuides {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    throw new PageNotFoundError(pageId);
  }
  const { dimensions } = document;
  return {
    pageId: page.id,
    side: page.side,
    boxes: {
      trim: getTrimBox(dimensions),
      bleed: getBleedBox(dimensions),
      safe: getSafeBox(dimensions),
      margin: getMarginBox(dimensions),
    },
    background: page.background ? colorToCss(page.background) : null,
    trimCornerRadius: dimensions.dieline.trimShape.cornerRadius,
    dieline: dimensions.dieline.features.map((feature) =>
      toSceneFeature(feature, page, dimensions, document.printSettings),
    ),
  };
}

/** Paint order: ascending zIndex, then document array order. */
export function objectsInPaintOrder(page: Page): ArtworkObject[] {
  return page.objects
    .map((object, index) => ({ object, index }))
    .sort((a, b) => a.object.zIndex - b.object.zIndex || a.index - b.index)
    .map(({ object }) => object);
}

/** Effective visibility: the object and its group (if any) must both be visible. */
export function isObjectEffectivelyVisible(page: Page, object: ArtworkObject): boolean {
  if (!object.visible) return false;
  if (object.groupId === null) return true;
  return page.groups.find((group) => group.id === object.groupId)?.visible ?? true;
}

function visibleObjectsInPaintOrder(page: Page, includeHidden: boolean): ArtworkObject[] {
  return objectsInPaintOrder(page).filter(
    (object) => includeHidden || isObjectEffectivelyVisible(page, object),
  );
}

function toSceneNode(
  object: ArtworkObject,
  dataBound: boolean,
  options: BuildSceneOptions,
): SceneNode {
  const base = {
    id: object.id,
    name: object.name,
    objectType: object.type,
    frame: { x: object.x, y: object.y, width: object.width, height: object.height },
    rotation: object.rotation,
    opacity: object.opacity,
    dataBound,
  };

  switch (object.type) {
    case 'text': {
      const layout = options.textLayout?.layout(object) ?? layoutTextApproximately(object);
      return {
        ...base,
        kind: 'text',
        lines: layout.lines.map(({ text, x, y }) => ({ text, x, y })),
        anchor: layout.anchor,
        direction: layout.direction,
        language: object.language,
        fontAssetId: object.fontAssetId,
        fontFamily: object.fontFamily,
        fontSize: layout.fontSize,
        requestedFontSize: object.fontSize,
        fontWeight: object.fontWeight,
        fontStyle: object.fontStyle === 'ITALIC' ? 'italic' : 'normal',
        letterSpacing: object.letterSpacing,
        fill: colorToCss(object.textColor),
        clip: object.overflow.mode !== 'VISIBLE',
        overflow: layout.overflow,
        missingGlyphs: layout.missingGlyphs,
        metricsSource: layout.metricsSource,
      };
    }
    case 'image':
      return {
        ...base,
        kind: 'image',
        assetId: object.assetId,
        fit:
          object.fitMode === 'CONTAIN'
            ? 'contain'
            : object.fitMode === 'COVER'
              ? 'cover'
              : 'stretch',
        crop: object.crop,
      };
    case 'rectangle':
      return {
        ...base,
        kind: 'rectangle',
        fill: object.fill ? colorToCss(object.fill) : null,
        stroke: object.stroke ? strokeToScene(object.stroke) : null,
        cornerRadius: object.cornerRadius,
      };
    case 'ellipse':
      return {
        ...base,
        kind: 'ellipse',
        fill: object.fill ? colorToCss(object.fill) : null,
        stroke: object.stroke ? strokeToScene(object.stroke) : null,
      };
    case 'line':
      return { ...base, kind: 'line', stroke: strokeToScene(object.stroke) };
    case 'barcode':
      return {
        ...base,
        kind: 'barcode',
        symbology: object.symbology,
        value: object.value,
        showHumanReadableText: object.showHumanReadableText,
        barHeight: object.barHeight,
        quietZone: object.quietZone,
        foreground: colorToCss(object.foregroundColor),
        background: object.backgroundColor ? colorToCss(object.backgroundColor) : null,
        ...barcodeSymbol(object, options.barcodeEncoder),
      };
    case 'qrCode':
      return {
        ...base,
        kind: 'qrCode',
        value: object.value,
        errorCorrection: object.errorCorrection,
        quietZone: object.quietZone,
        foreground: colorToCss(object.foregroundColor),
        background: object.backgroundColor ? colorToCss(object.backgroundColor) : null,
        ...qrSymbol(object, options.barcodeEncoder),
      };
  }
}

type SymbolState<N extends BarcodeSceneNode | QrCodeSceneNode> = Pick<
  N,
  'symbolStatus' | 'symbol' | 'symbolIssues' | 'symbolMessage'
>;

const NO_ENCODER = {
  symbolStatus: 'NO_ENCODER',
  symbol: null,
  symbolIssues: [],
  symbolMessage: null,
} as const;

/** Symbol geometry for a barcode object; shared by the SVG preview and the editor canvas. */
export function barcodeSymbol(
  object: BarcodeObject,
  encoder: BarcodeEncoder | undefined,
): SymbolState<BarcodeSceneNode> {
  if (!encoder) return NO_ENCODER;
  const result = encodeBarcodeObject(encoder, object);
  switch (result.status) {
    case 'ENCODED':
      return {
        symbolStatus: 'ENCODED',
        symbol: layoutLinearSymbol(result.pattern, {
          width: object.width,
          height: object.height,
          quietZone: object.quietZone,
          barHeight: object.barHeight,
          showHumanReadableText: object.showHumanReadableText,
        }),
        symbolIssues: [],
        symbolMessage: null,
      };
    case 'INVALID_VALUE':
      return {
        symbolStatus: 'INVALID_VALUE',
        symbol: null,
        symbolIssues: result.issues,
        symbolMessage: result.issues[0]?.message ?? 'Invalid value',
      };
    case 'NOT_ENABLED':
    case 'ENCODER_ERROR':
      return {
        symbolStatus: result.status,
        symbol: null,
        symbolIssues: [],
        symbolMessage: result.message,
      };
  }
}

/** Symbol geometry for a QR code object; shared by the SVG preview and the editor canvas. */
export function qrSymbol(
  object: QrCodeObject,
  encoder: BarcodeEncoder | undefined,
): SymbolState<QrCodeSceneNode> {
  if (!encoder) return NO_ENCODER;
  const result = encodeQrCodeObject(encoder, object);
  switch (result.status) {
    case 'ENCODED':
      return {
        symbolStatus: 'ENCODED',
        symbol: layoutMatrixSymbol(result.pattern, {
          width: object.width,
          height: object.height,
          quietZone: object.quietZone,
        }),
        symbolIssues: [],
        symbolMessage: null,
      };
    case 'INVALID_VALUE':
      return {
        symbolStatus: 'INVALID_VALUE',
        symbol: null,
        symbolIssues: result.issues,
        symbolMessage: result.issues[0]?.message ?? 'Invalid value',
      };
    case 'NOT_ENABLED':
    case 'ENCODER_ERROR':
      return {
        symbolStatus: result.status,
        symbol: null,
        symbolIssues: [],
        symbolMessage: result.message,
      };
  }
}

/**
 * Dieline features are authored in FRONT-side coordinates. When the piece is turned over, a
 * feature appears mirrored: across the vertical axis for a HORIZONTAL flip, across the horizontal
 * axis for a VERTICAL flip.
 */
function toSceneFeature(
  feature: DielineFeature,
  page: Page,
  dimensions: DesignDocument['dimensions'],
  printSettings: PrintSettings,
): SceneDielineFeature {
  const mirrored = page.side === 'BACK';
  const horizontal = printSettings.backSideFlip === 'HORIZONTAL';
  const mx = (x: number) => (mirrored && horizontal ? dimensions.width - x : x);
  const my = (y: number) => (mirrored && !horizontal ? dimensions.height - y : y);
  const mr = (rotation: number) => (mirrored && rotation !== 0 ? 360 - rotation : rotation);

  switch (feature.type) {
    case 'PUNCH_HOLE':
      return {
        id: feature.id,
        kind: 'PUNCH_HOLE',
        cx: mx(feature.center.x),
        cy: my(feature.center.y),
        radius: feature.diameter / 2,
      };
    case 'SLOT_HOLE':
      return {
        id: feature.id,
        kind: 'SLOT_HOLE',
        cx: mx(feature.center.x),
        cy: my(feature.center.y),
        width: feature.width,
        height: feature.height,
        rotation: mr(feature.rotation),
      };
    case 'FOLD_LINE':
    case 'PERFORATION':
      return {
        id: feature.id,
        kind: feature.type,
        x1: mx(feature.start.x),
        y1: my(feature.start.y),
        x2: mx(feature.end.x),
        y2: my(feature.end.y),
        dash: feature.type === 'PERFORATION' ? [feature.cutLength, feature.gapLength] : [6, 3],
      };
  }
}

/** Builds scenes for every page, in document order. */
export function buildDocumentScenes(
  document: DesignDocument,
  options: BuildSceneOptions = {},
): PageScene[] {
  return document.pages.map((page) => buildPageScene(document, page.id, options));
}
