import type { ImageCrop, ImageObject } from '@smarttag/document-schema';

export interface PlacementRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ImagePlacement {
  /** Visible part of the source image, in source pixels. */
  readonly source: PlacementRect;
  /** Where that part is drawn, in points relative to the frame's top-left corner. */
  readonly destination: PlacementRect;
  /** COVER draws beyond the frame; the result must be clipped to the frame. */
  readonly clip: boolean;
}

/**
 * Fit and crop geometry shared by every renderer (canvas editor, SVG preview, future PDF), so an
 * image is framed identically everywhere.
 *
 * - crop: fractions (0–1) of the source selecting the visible part (null = whole image)
 * - CONTAIN: scale the visible part to fit inside the frame, centred (letterboxed)
 * - COVER: scale to fill the frame, centred, clipped
 * - STRETCH: distort to the frame
 */
export function computeImagePlacement(
  frame: { readonly width: number; readonly height: number },
  sourceSize: { readonly width: number; readonly height: number },
  fitMode: ImageObject['fitMode'],
  crop: ImageCrop | null,
): ImagePlacement {
  const visible = crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const source: PlacementRect = {
    x: visible.x * sourceSize.width,
    y: visible.y * sourceSize.height,
    width: visible.width * sourceSize.width,
    height: visible.height * sourceSize.height,
  };
  if (fitMode === 'STRETCH' || source.width <= 0 || source.height <= 0) {
    return {
      source,
      destination: { x: 0, y: 0, width: frame.width, height: frame.height },
      clip: false,
    };
  }
  const scaleX = frame.width / source.width;
  const scaleY = frame.height / source.height;
  const scale = fitMode === 'CONTAIN' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    source,
    destination: { x: (frame.width - width) / 2, y: (frame.height - height) / 2, width, height },
    clip: fitMode === 'COVER',
  };
}
