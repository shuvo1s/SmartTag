import type { SymbolRect } from '@smarttag/barcode-core';
import type { ArtworkObject, Stroke } from '@smarttag/document-schema';
import {
  barcodeSymbol,
  colorToCss,
  computeImagePlacement,
  qrSymbol,
  type TextLayout,
} from '@smarttag/rendering-core';
import type { FontLoadStatus, RenderServices } from './services';

/**
 * Draws canonical artwork onto a 2D context whose origin is the object's frame top-left corner
 * and whose unit is one point. Uses the SAME layout, symbol geometry and image placement code as
 * the canonical SVG renderer, so canvas and preview can only differ in rasterization.
 */

export type ArtworkIssue =
  | 'TEXT_OVERFLOW'
  | 'MISSING_GLYPHS'
  | 'FONT_UNASSIGNED'
  | 'FONT_UNAVAILABLE'
  | 'FONT_LOADING'
  | 'SYMBOL_INVALID'
  | 'SYMBOL_NOT_ENABLED'
  | 'IMAGE_UNAVAILABLE';

export interface DrawResult {
  readonly issues: readonly ArtworkIssue[];
}

export interface DrawOptions {
  /** Points per screen pixel, to keep markers and hairlines a constant screen size. */
  readonly pointsPerPixel: number;
  /** Draw non-printing warning markers (editor mode; off in clean previews). */
  readonly showIssues: boolean;
}

const MARKER_COLOR = '#D64545';
const PLACEHOLDER_STROKE = '#7B8794';
const SYMBOL_TEXT_FONT = "'OCR-B', 'Noto Sans Mono', monospace";

export function drawArtwork(
  ctx: CanvasRenderingContext2D,
  object: ArtworkObject,
  services: RenderServices,
  options: DrawOptions,
): DrawResult {
  let issues: ArtworkIssue[] = [];
  ctx.save();
  ctx.globalAlpha *= object.opacity;
  switch (object.type) {
    case 'text':
      issues = drawText(ctx, object, services);
      break;
    case 'image':
      issues = drawImage(ctx, object, services, options);
      break;
    case 'rectangle':
      pathRoundedRect(ctx, object.width, object.height, object.cornerRadius);
      fillAndStroke(ctx, object.fill ? colorToCss(object.fill) : null, object.stroke);
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(
        object.width / 2,
        object.height / 2,
        object.width / 2,
        object.height / 2,
        0,
        0,
        Math.PI * 2,
      );
      fillAndStroke(ctx, object.fill ? colorToCss(object.fill) : null, object.stroke);
      break;
    case 'line':
      ctx.beginPath();
      ctx.moveTo(0, object.height / 2);
      ctx.lineTo(object.width, object.height / 2);
      fillAndStroke(ctx, null, object.stroke);
      break;
    case 'barcode':
      issues = drawBarcode(ctx, object, services, options);
      break;
    case 'qrCode':
      issues = drawQrCode(ctx, object, services, options);
      break;
  }
  ctx.restore();
  if (options.showIssues && issues.some((issue) => issue !== 'FONT_LOADING')) {
    drawIssueMarker(ctx, object.width, object.height, options.pointsPerPixel);
  }
  return { issues };
}

function applyStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  ctx.lineWidth = stroke.width;
  ctx.strokeStyle = colorToCss(stroke.color);
  ctx.setLineDash(stroke.dashPattern);
  ctx.lineCap =
    stroke.lineCap === 'BUTT' ? 'butt' : stroke.lineCap === 'ROUND' ? 'round' : 'square';
  ctx.lineJoin =
    stroke.lineJoin === 'MITER' ? 'miter' : stroke.lineJoin === 'ROUND' ? 'round' : 'bevel';
}

function fillAndStroke(ctx: CanvasRenderingContext2D, fill: string | null, stroke: Stroke | null) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    applyStroke(ctx, stroke);
    ctx.stroke();
  }
}

/** Rounded rectangle with the SVG `rx` semantics (radius clamped to half the shortest side). */
function pathRoundedRect(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  if (r === 0) {
    ctx.rect(0, 0, width, height);
    return;
  }
  ctx.moveTo(r, 0);
  ctx.lineTo(width - r, 0);
  ctx.arcTo(width, 0, width, r, r);
  ctx.lineTo(width, height - r);
  ctx.arcTo(width, height, width - r, height, r);
  ctx.lineTo(r, height);
  ctx.arcTo(0, height, 0, height - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
}

function fontIssue(status: FontLoadStatus): ArtworkIssue | null {
  switch (status) {
    case 'LOADED':
      return null;
    case 'LOADING':
      return 'FONT_LOADING';
    case 'UNASSIGNED':
      return 'FONT_UNASSIGNED';
    case 'UNKNOWN':
    case 'FAILED':
      return 'FONT_UNAVAILABLE';
  }
}

/** Text layout for a frame at the origin (the adapter passes a local copy of the object). */
function drawText(
  ctx: CanvasRenderingContext2D,
  object: Extract<ArtworkObject, { type: 'text' }>,
  services: RenderServices,
): ArtworkIssue[] {
  const issues: ArtworkIssue[] = [];
  const layout: TextLayout = services.textLayout.layout(object);
  const status = services.fonts.status(object.fontAssetId);
  const statusIssue = fontIssue(status);
  if (statusIssue) issues.push(statusIssue);
  if (layout.overflow) issues.push('TEXT_OVERFLOW');
  if (layout.missingGlyphs.length > 0) issues.push('MISSING_GLYPHS');

  const family = services.fonts.cssFamily(object.fontAssetId);
  // Without the exact font the text is still shown (so the design stays editable) but the
  // object carries a visible warning marker — it is never presented as the production font.
  const fontFamily = family ? `"${family}"` : 'sans-serif';
  ctx.font = `${object.fontStyle === 'ITALIC' ? 'italic' : 'normal'} ${object.fontWeight} ${layout.fontSize}px ${fontFamily}`;
  ctx.fillStyle = colorToCss(object.textColor);
  ctx.textBaseline = 'alphabetic';
  ctx.direction = layout.direction;
  ctx.textAlign = layout.anchor === 'middle' ? 'center' : layout.anchor;
  const spacing = ctx as unknown as { letterSpacing?: string };
  if ('letterSpacing' in ctx) {
    spacing.letterSpacing = `${object.letterSpacing}px`;
  }
  if (object.overflow.mode !== 'VISIBLE') {
    ctx.beginPath();
    ctx.rect(0, 0, object.width, object.height);
    ctx.clip();
  }
  for (const line of layout.lines) {
    ctx.fillText(line.text, line.x, line.y);
  }
  if ('letterSpacing' in ctx) {
    spacing.letterSpacing = '0px';
  }
  return issues;
}

function drawImage(
  ctx: CanvasRenderingContext2D,
  object: Extract<ArtworkObject, { type: 'image' }>,
  services: RenderServices,
  options: DrawOptions,
): ArtworkIssue[] {
  const entry = object.assetId ? services.images.get(object.assetId) : null;
  if (
    !entry ||
    entry.status !== 'LOADED' ||
    !entry.image ||
    entry.width <= 0 ||
    entry.height <= 0
  ) {
    drawPlaceholder(ctx, object.width, object.height, options, [
      !object.assetId ? 'NO IMAGE' : entry?.status === 'LOADING' ? 'LOADING…' : 'IMAGE UNAVAILABLE',
    ]);
    return entry?.status === 'LOADING' ? [] : ['IMAGE_UNAVAILABLE'];
  }
  const placement = computeImagePlacement(
    object,
    { width: entry.width, height: entry.height },
    object.fitMode,
    object.crop,
  );
  if (placement.clip || object.crop) {
    ctx.beginPath();
    ctx.rect(0, 0, object.width, object.height);
    ctx.clip();
  }
  const { source, destination } = placement;
  ctx.drawImage(
    entry.image,
    source.x,
    source.y,
    source.width,
    source.height,
    destination.x,
    destination.y,
    destination.width,
    destination.height,
  );
  return [];
}

function fillRects(ctx: CanvasRenderingContext2D, rects: readonly SymbolRect[]): void {
  ctx.beginPath();
  for (const rect of rects) {
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.fill();
}

function drawBarcode(
  ctx: CanvasRenderingContext2D,
  object: Extract<ArtworkObject, { type: 'barcode' }>,
  services: RenderServices,
  options: DrawOptions,
): ArtworkIssue[] {
  if (object.backgroundColor) {
    ctx.fillStyle = colorToCss(object.backgroundColor);
    ctx.fillRect(0, 0, object.width, object.height);
  }
  const state = barcodeSymbol(object, services.barcodeEncoder ?? undefined);
  if (!state.symbol) {
    const reason =
      state.symbolStatus === 'INVALID_VALUE'
        ? `invalid: ${state.symbolMessage ?? ''}`
        : state.symbolStatus === 'NOT_ENABLED'
          ? 'preview not enabled'
          : 'placeholder';
    drawPlaceholder(ctx, object.width, object.height, options, [
      object.symbology,
      object.value || '(no value)',
      reason,
    ]);
    return state.symbolStatus === 'INVALID_VALUE' || state.symbolStatus === 'ENCODER_ERROR'
      ? ['SYMBOL_INVALID']
      : state.symbolStatus === 'NOT_ENABLED'
        ? ['SYMBOL_NOT_ENABLED']
        : [];
  }
  ctx.fillStyle = colorToCss(object.foregroundColor);
  fillRects(ctx, state.symbol.bars);
  for (const text of state.symbol.texts) {
    ctx.font = `normal 400 ${text.fontSize}px ${SYMBOL_TEXT_FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.direction = 'ltr';
    ctx.textAlign =
      text.anchor === 'middle' ? 'center' : text.anchor === 'start' ? 'left' : 'right';
    ctx.fillText(text.text, text.x, text.y);
  }
  return [];
}

function drawQrCode(
  ctx: CanvasRenderingContext2D,
  object: Extract<ArtworkObject, { type: 'qrCode' }>,
  services: RenderServices,
  options: DrawOptions,
): ArtworkIssue[] {
  const state = qrSymbol(object, services.barcodeEncoder ?? undefined);
  if (!state.symbol) {
    if (object.backgroundColor) {
      ctx.fillStyle = colorToCss(object.backgroundColor);
      ctx.fillRect(0, 0, object.width, object.height);
    }
    const reason =
      state.symbolStatus === 'INVALID_VALUE'
        ? `invalid: ${state.symbolMessage ?? ''}`
        : 'placeholder';
    drawPlaceholder(ctx, object.width, object.height, options, [
      `QR · ${object.errorCorrection}`,
      object.value || '(no value)',
      reason,
    ]);
    return state.symbolStatus === 'INVALID_VALUE' || state.symbolStatus === 'ENCODER_ERROR'
      ? ['SYMBOL_INVALID']
      : [];
  }
  if (object.backgroundColor) {
    const { bounds } = state.symbol;
    ctx.fillStyle = colorToCss(object.backgroundColor);
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  }
  ctx.fillStyle = colorToCss(object.foregroundColor);
  fillRects(ctx, state.symbol.runs);
  return [];
}

/** Hatched, labelled box that cannot be mistaken for real artwork. */
function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: DrawOptions,
  labels: readonly string[],
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.fillStyle = '#F5F7FA';
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = '#CBD2D9';
  ctx.lineWidth = 0.6;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let offset = -height; offset < width + height; offset += 4) {
    ctx.moveTo(offset, height);
    ctx.lineTo(offset + height, 0);
  }
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = PLACEHOLDER_STROKE;
  ctx.lineWidth = options.pointsPerPixel;
  ctx.setLineDash([2 * options.pointsPerPixel, 2 * options.pointsPerPixel]);
  ctx.strokeRect(0, 0, width, height);
  const fontSize = Math.max(2.5, Math.min(7, height / (labels.length * 1.6), width / 12));
  ctx.fillStyle = '#3E4C59';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const first = height / 2 - ((labels.length - 1) * fontSize * 1.25) / 2 + fontSize * 0.35;
  labels.forEach((label, index) => {
    ctx.font = `normal ${index === 0 ? 700 : 400} ${fontSize}px sans-serif`;
    const text = [...label].length > 40 ? `${[...label].slice(0, 39).join('')}…` : label;
    ctx.fillText(text, width / 2, first + index * fontSize * 1.25);
  });
  ctx.restore();
}

/** Red dashed frame and a "!" badge at the top-right corner, constant in screen size. */
function drawIssueMarker(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  ppx: number,
) {
  ctx.save();
  ctx.strokeStyle = MARKER_COLOR;
  ctx.lineWidth = 1.5 * ppx;
  ctx.setLineDash([4 * ppx, 3 * ppx]);
  ctx.strokeRect(0, 0, width, height);
  const radius = 6 * ppx;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(width, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = MARKER_COLOR;
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `normal 700 ${9 * ppx}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', width, ppx * 0.5);
  ctx.restore();
}
