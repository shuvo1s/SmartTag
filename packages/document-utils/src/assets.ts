import type { DesignDocument, ImageCrop, ImageObject } from '@smarttag/document-schema';
import { POINTS_PER_INCH } from '@smarttag/document-schema';

export interface AssetReferencesByKind {
  /** Static image sources and image-field default values. */
  readonly imageAssetIds: readonly string[];
  /** Controlled font files of text objects. */
  readonly fontAssetIds: readonly string[];
}

/** Asset ids a document depends on, grouped by the kind of asset each reference requires. */
export function collectAssetReferencesByKind(document: DesignDocument): AssetReferencesByKind {
  const images = new Set<string>();
  const fonts = new Set<string>();
  for (const page of document.pages) {
    for (const object of page.objects) {
      if (object.type === 'image' && object.assetId !== null) {
        images.add(object.assetId);
      } else if (object.type === 'text' && object.fontAssetId !== null) {
        fonts.add(object.fontAssetId);
      }
    }
  }
  for (const field of document.dataSchema.fields) {
    if (field.type === 'image' && field.defaultValue !== null) {
      images.add(field.defaultValue);
    }
  }
  return { imageAssetIds: [...images].sort(), fontAssetIds: [...fonts].sort() };
}

/**
 * Every asset id a document depends on (images, image-field defaults and fonts), sorted.
 * Used to verify, at save time, that referenced assets exist and belong to the same organization.
 */
export function collectAssetReferences(document: DesignDocument): string[] {
  const { imageAssetIds, fontAssetIds } = collectAssetReferencesByKind(document);
  return [...new Set([...imageAssetIds, ...fontAssetIds])].sort();
}

export interface SourcePixelSize {
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface EffectiveResolution {
  /** Source pixels per printed inch along each axis. */
  readonly horizontalPpi: number;
  readonly verticalPpi: number;
  /** The lower of the two — what print preflight compares against its threshold (e.g. 300 ppi). */
  readonly effectivePpi: number;
}

type Placement = Pick<ImageObject, 'width' | 'height' | 'fitMode'> & {
  readonly crop: ImageCrop | null;
};

/**
 * Effective print resolution of a placed raster image, from the asset's pixel dimensions and the
 * physical (point) size at which the visible part of the image is printed.
 */
export function computeEffectiveResolution(
  source: SourcePixelSize,
  placement: Placement,
): EffectiveResolution {
  if (
    source.widthPx <= 0 ||
    source.heightPx <= 0 ||
    placement.width <= 0 ||
    placement.height <= 0
  ) {
    throw new RangeError('Source pixel size and placement size must be positive');
  }
  const crop = placement.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const visibleWidthPx = source.widthPx * crop.width;
  const visibleHeightPx = source.heightPx * crop.height;

  let printedWidthPt: number;
  let printedHeightPt: number;
  switch (placement.fitMode) {
    case 'STRETCH':
      printedWidthPt = placement.width;
      printedHeightPt = placement.height;
      break;
    case 'CONTAIN':
    case 'COVER': {
      const scaleX = placement.width / visibleWidthPx;
      const scaleY = placement.height / visibleHeightPx;
      const scale =
        placement.fitMode === 'CONTAIN' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
      printedWidthPt = visibleWidthPx * scale;
      printedHeightPt = visibleHeightPx * scale;
      break;
    }
  }

  const horizontalPpi = visibleWidthPx / (printedWidthPt / POINTS_PER_INCH);
  const verticalPpi = visibleHeightPx / (printedHeightPt / POINTS_PER_INCH);
  return { horizontalPpi, verticalPpi, effectivePpi: Math.min(horizontalPpi, verticalPpi) };
}
