import type { UnicodeRange } from '@smarttag/document-utils';
import type { FontMetrics, TextMeasurer, TextRunStyle } from '@smarttag/rendering-core';
import type { FontLoadStatus, FontProvider, ImageEntry, ImageProvider } from './services';

/** Registry entry of a controlled font file (subset of the API's FontFaceDto). */
export interface RegisteredFontFace {
  readonly assetId: string;
  readonly familyName: string;
  readonly weight: number;
  readonly style: 'NORMAL' | 'ITALIC';
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly unicodeRanges: readonly UnicodeRange[];
}

type Listener = () => void;

/**
 * Loads the EXACT font files referenced by documents into the browser (docs/typography.md):
 *
 *   font asset → fetch bytes → FontFace (unique family "st-font-<assetId>") → document.fonts
 *
 * Each asset gets its own family name, so a document can never pick up a same-named font installed
 * on the user's computer, and weight/style descriptors match the file so the browser never
 * synthesizes bold or italic. Missing or failed fonts are reported, never substituted.
 */
export class BrowserFontRegistry implements FontProvider {
  private readonly faces = new Map<string, RegisteredFontFace>();
  private readonly statuses = new Map<string, FontLoadStatus>();
  private readonly pending = new Map<string, Promise<FontLoadStatus>>();
  private readonly listeners = new Set<Listener>();

  constructor(
    faces: readonly RegisteredFontFace[],
    private readonly fontUrl: (assetId: string) => string,
    private readonly fontSet: FontFaceSet | null = typeof document === 'undefined'
      ? null
      : document.fonts,
  ) {
    for (const face of faces) this.faces.set(face.assetId, face);
  }

  static familyName(assetId: string): string {
    return `st-font-${assetId}`;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listFaces(): RegisteredFontFace[] {
    return [...this.faces.values()];
  }

  getFace(assetId: string | null): RegisteredFontFace | null {
    return assetId ? (this.faces.get(assetId) ?? null) : null;
  }

  status(fontAssetId: string | null): FontLoadStatus {
    if (fontAssetId === null) return 'UNASSIGNED';
    if (!this.faces.has(fontAssetId)) return 'UNKNOWN';
    return this.statuses.get(fontAssetId) ?? 'LOADING';
  }

  cssFamily(fontAssetId: string | null): string | null {
    return fontAssetId && this.statuses.get(fontAssetId) === 'LOADED'
      ? BrowserFontRegistry.familyName(fontAssetId)
      : null;
  }

  metrics(fontAssetId: string | null): FontMetrics | null {
    const face = this.getFace(fontAssetId);
    return face
      ? {
          unitsPerEm: face.unitsPerEm,
          ascender: face.ascender,
          descender: face.descender,
          lineGap: face.lineGap,
          unicodeRanges: face.unicodeRanges,
        }
      : null;
  }

  load(assetId: string): Promise<FontLoadStatus> {
    const face = this.faces.get(assetId);
    if (!face) return Promise.resolve('UNKNOWN');
    const current = this.statuses.get(assetId);
    if (current === 'LOADED' || current === 'FAILED') return Promise.resolve(current);
    const existing = this.pending.get(assetId);
    if (existing) return existing;

    const promise = (async (): Promise<FontLoadStatus> => {
      if (!this.fontSet || typeof FontFace === 'undefined') {
        this.statuses.set(assetId, 'FAILED');
        return 'FAILED';
      }
      try {
        const fontFace = new FontFace(
          BrowserFontRegistry.familyName(assetId),
          `url("${this.fontUrl(assetId)}")`,
          { weight: String(face.weight), style: face.style === 'ITALIC' ? 'italic' : 'normal' },
        );
        await fontFace.load();
        this.fontSet.add(fontFace);
        this.statuses.set(assetId, 'LOADED');
        return 'LOADED';
      } catch {
        this.statuses.set(assetId, 'FAILED');
        return 'FAILED';
      } finally {
        this.pending.delete(assetId);
        for (const listener of [...this.listeners]) listener();
      }
    })();
    this.pending.set(assetId, promise);
    return promise;
  }

  loadAll(assetIds: Iterable<string>): Promise<FontLoadStatus[]> {
    return Promise.all([...new Set(assetIds)].map((id) => this.load(id)));
  }
}

/**
 * The browser TextMeasurer: canvas `measureText` with the exact loaded font file. This is the only
 * place in the editor that measures text; layout logic lives in rendering-core's engine.
 * Measures at a 100 px reference size to avoid small-size quantization, then scales.
 */
export function createCanvasTextMeasurer(fonts: FontProvider): TextMeasurer {
  const REFERENCE_SIZE = 100;
  const cache = new Map<string, number>();
  let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

  const getContext = () => {
    if (context) return context;
    if (typeof OffscreenCanvas !== 'undefined') {
      context = new OffscreenCanvas(1, 1).getContext('2d');
    } else if (typeof document !== 'undefined') {
      context = document.createElement('canvas').getContext('2d');
    }
    return context;
  };

  return {
    id: 'browser-canvas-v1',
    measureLine(text: string, style: TextRunStyle): number {
      const family = fonts.cssFamily(style.fontAssetId);
      const fontKey = `${style.fontStyle}|${style.fontWeight}|${family ?? 'sans-serif'}|${style.direction}`;
      const key = `${fontKey}|${text}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached * style.fontSize;
      const ctx = getContext();
      if (!ctx) return text.length * 0.55 * style.fontSize;
      ctx.font = `${style.fontStyle === 'ITALIC' ? 'italic' : 'normal'} ${style.fontWeight} ${REFERENCE_SIZE}px ${family ? `"${family}"` : 'sans-serif'}`;
      ctx.direction = style.direction;
      if ('letterSpacing' in ctx) (ctx as { letterSpacing: string }).letterSpacing = '0px';
      const width = ctx.measureText(text).width / REFERENCE_SIZE;
      if (cache.size > 20_000) cache.clear();
      cache.set(key, width);
      return width * style.fontSize;
    },
  };
}

/**
 * Loads image assets as HTMLImageElement from the same-origin content endpoint. SVG assets are
 * loaded as images (no script execution) after server-side sanitization.
 */
export class BrowserImageCache implements ImageProvider {
  private readonly entries = new Map<string, ImageEntry>();
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly imageUrl: (assetId: string) => string,
    private readonly knownSizes: (
      assetId: string,
    ) => { width: number; height: number } | null = () => null,
  ) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(assetId: string): ImageEntry {
    const existing = this.entries.get(assetId);
    if (existing) return existing;
    const loading: ImageEntry = { status: 'LOADING', image: null, width: 0, height: 0 };
    this.entries.set(assetId, loading);
    if (typeof Image === 'undefined') {
      this.entries.set(assetId, { ...loading, status: 'FAILED' });
      return loading;
    }
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const known = this.knownSizes(assetId);
      const width = image.naturalWidth || known?.width || 0;
      const height = image.naturalHeight || known?.height || 0;
      this.entries.set(assetId, {
        status: width > 0 && height > 0 ? 'LOADED' : 'FAILED',
        image,
        width,
        height,
      });
      this.notify();
    };
    image.onerror = () => {
      this.entries.set(assetId, { status: 'FAILED', image: null, width: 0, height: 0 });
      this.notify();
    };
    image.src = this.imageUrl(assetId);
    return loading;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
