'use client';

import { createBwipBarcodeEncoder } from '@smarttag/barcode-bwip';
import type { BarcodeEncoder } from '@smarttag/barcode-core';
import {
  BrowserFontRegistry,
  BrowserImageCache,
  createCanvasTextMeasurer,
  type RenderServices,
} from '@smarttag/canvas-adapter';
import type { DesignDocument } from '@smarttag/document-schema';
import { collectAssetReferencesByKind } from '@smarttag/document-utils';
import { createTextLayoutEngine, type SvgRenderOptions } from '@smarttag/rendering-core';
import type { AssetDto, FontFaceDto } from '@smarttag/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '@/lib/api-client';

export const assetContentUrl = (assetId: string) => `/api/v1/assets/${assetId}/content`;

let sharedEncoder: BarcodeEncoder | null = null;

/** The application's barcode encoder (composition root: the only place bwip-js is chosen). */
export function barcodeEncoder(): BarcodeEncoder {
  sharedEncoder ??= createBwipBarcodeEncoder();
  return sharedEncoder;
}

export interface RenderingResources {
  readonly fonts: BrowserFontRegistry;
  readonly images: BrowserImageCache;
  readonly services: RenderServices;
}

/**
 * Browser rendering resources shared by the editor canvas and the canonical SVG preview: the
 * controlled font registry, one TextLayoutEngine measuring with the loaded font files, the image
 * cache and the barcode encoder.
 */
export function createRenderingResources(
  faces: readonly FontFaceDto[],
  assetSize: (assetId: string) => { width: number; height: number } | null = () => null,
): RenderingResources {
  const fonts = new BrowserFontRegistry(faces, assetContentUrl);
  const images = new BrowserImageCache(assetContentUrl, assetSize);
  const services: RenderServices = {
    textLayout: createTextLayoutEngine({
      measurer: createCanvasTextMeasurer(fonts),
      resolveFontMetrics: (assetId) => fonts.metrics(assetId),
    }),
    barcodeEncoder: barcodeEncoder(),
    fonts,
    images,
  };
  return { fonts, images, services };
}

export function fontKeys() {
  return ['fonts'] as const;
}

export function useFontRegistryQuery() {
  return useQuery({
    queryKey: fontKeys(),
    queryFn: ({ signal }) => apiRequest<FontFaceDto[]>('/fonts', { signal }),
    staleTime: 5 * 60_000,
  });
}

/**
 * Loads the fonts a document uses and re-renders when they arrive. Returns a counter that
 * changes whenever font or image state changes, so memoized renders can depend on it.
 */
export function useLoadedResources(
  resources: RenderingResources | null,
  document: DesignDocument | null,
): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!resources) return;
    const bump = () => {
      resources.services.textLayout.invalidate();
      setVersion((value) => value + 1);
    };
    const unsubscribeFonts = resources.fonts.subscribe(bump);
    const unsubscribeImages = resources.images.subscribe(bump);
    return () => {
      unsubscribeFonts();
      unsubscribeImages();
    };
  }, [resources]);
  useEffect(() => {
    if (!resources || !document) return;
    void resources.fonts.loadAll(collectAssetReferencesByKind(document).fontAssetIds);
  }, [resources, document]);
  return version;
}

/** SVG renderer options that use the exact loaded fonts and known image sizes. */
export function svgOptionsFor(
  resources: RenderingResources,
  assets: ReadonlyMap<string, Pick<AssetDto, 'widthPx' | 'heightPx'>>,
): Pick<SvgRenderOptions, 'resolveAssetUrl' | 'resolveAssetSize' | 'resolveFontFamily'> {
  return {
    resolveAssetUrl: assetContentUrl,
    resolveAssetSize: (assetId) => {
      const loaded = resources.images.get(assetId);
      if (loaded.status === 'LOADED') return { width: loaded.width, height: loaded.height };
      const asset = assets.get(assetId);
      return asset?.widthPx && asset.heightPx
        ? { width: asset.widthPx, height: asset.heightPx }
        : null;
    },
    resolveFontFamily: (node) => resources.fonts.cssFamily(node.fontAssetId),
  };
}

/** Memoized rendering resources for a font registry snapshot. */
export function useRenderingResources(
  faces: readonly FontFaceDto[] | undefined,
  assetSize?: (assetId: string) => { width: number; height: number } | null,
): RenderingResources | null {
  return useMemo(
    () => (faces ? createRenderingResources(faces, assetSize) : null),
    // assetSize is intentionally read once per registry snapshot
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [faces],
  );
}
