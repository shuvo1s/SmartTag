import {
  getBleedBox,
  getMarginBox,
  getSafeBox,
  getTrimBox,
  type ArtworkObject,
  type DesignDocument,
  type DielineFeature,
  type Page,
  type PrintSettings,
} from '@smarttag/document-schema';
import { collectBoundProperties } from '@smarttag/document-utils';
import { colorToCss, strokeToScene } from './color';
import type { PageScene, SceneDielineFeature, SceneNode } from './scene';
import { layoutTextLines, resolveTextDirection } from './text-layout';

export interface BuildSceneOptions {
  /** Include objects whose `visible` flag (or group) is false. Useful for editor-like previews. */
  readonly includeHidden?: boolean;
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
      toSceneNode(object, boundObjectIds.has(object.id)),
    ),
  };
}

function visibleObjectsInPaintOrder(page: Page, includeHidden: boolean): ArtworkObject[] {
  const hiddenGroups = new Set(
    page.groups.filter((group) => !group.visible).map((group) => group.id),
  );
  return page.objects
    .map((object, index) => ({ object, index }))
    .filter(
      ({ object }) =>
        includeHidden ||
        (object.visible && (object.groupId === null || !hiddenGroups.has(object.groupId))),
    )
    .sort((a, b) => a.object.zIndex - b.object.zIndex || a.index - b.index)
    .map(({ object }) => object);
}

function toSceneNode(object: ArtworkObject, dataBound: boolean): SceneNode {
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
      const direction = resolveTextDirection(object);
      return {
        ...base,
        kind: 'text',
        ...layoutTextLines(object, direction),
        direction,
        language: object.language,
        fontFamily: object.fontFamily,
        fontSize: object.fontSize,
        fontWeight: object.fontWeight,
        fontStyle: object.fontStyle === 'ITALIC' ? 'italic' : 'normal',
        letterSpacing: object.letterSpacing,
        fill: colorToCss(object.textColor),
        clip: object.overflow.mode !== 'VISIBLE',
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
        foreground: colorToCss(object.foregroundColor),
        background: object.backgroundColor ? colorToCss(object.backgroundColor) : null,
      };
    case 'qrCode':
      return {
        ...base,
        kind: 'qrCode',
        value: object.value,
        errorCorrection: object.errorCorrection,
        foreground: colorToCss(object.foregroundColor),
        background: object.backgroundColor ? colorToCss(object.backgroundColor) : null,
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
