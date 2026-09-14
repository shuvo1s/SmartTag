import type { SymbolRect, SymbolText } from '@smarttag/barcode-core';
import type { Rect } from '@smarttag/document-schema';
import { computeImagePlacement } from '../image-placement';
import type {
  BarcodeSceneNode,
  ImageSceneNode,
  PageScene,
  QrCodeSceneNode,
  SceneDielineFeature,
  SceneNode,
  SceneStroke,
  TextSceneNode,
} from '../scene';
import { attrs, cssFontFamily, escapeXml, fmt, isSafeImageUrl } from './xml';

export interface SvgGuideOptions {
  readonly bleed: boolean;
  readonly trim: boolean;
  readonly safe: boolean;
  readonly margins: boolean;
  readonly dieline: boolean;
}

export interface SvgRenderOptions {
  /** Non-printing guide overlays. Defaults: all on. */
  readonly guides?: Partial<SvgGuideOptions>;
  /**
   * BLEED shows the full printed sheet area; TRIM masks artwork to the finished shape
   * (rounded corners, punch holes) to preview the cut piece.
   */
  readonly finish?: 'BLEED' | 'TRIM';
  /** Physical size attributes. 'mm' lets browsers and viewers display true size. */
  readonly sizeUnit?: 'mm' | 'pt' | 'none';
  /** Maps asset ids to fetchable URLs. Unresolvable or unsafe URLs render a placeholder. */
  readonly resolveAssetUrl?: (assetId: string) => string | null;
  /** Intrinsic pixel size of an image asset; needed to apply crops exactly. */
  readonly resolveAssetSize?: (assetId: string) => { width: number; height: number } | null;
  /**
   * Maps a text node to the CSS family name of its exact loaded font file (browser previews).
   * When it returns null the document's family name is used.
   */
  readonly resolveFontFamily?: (node: TextSceneNode) => string | null;
  /** Outline data-bound objects (preview aid). */
  readonly highlightDataBound?: boolean;
  /** Outline overflowing text, missing glyphs and unencodable symbols (non-printing). */
  readonly showIssues?: boolean;
  /** Prefix for generated element ids; must be unique when several SVGs share a DOM. */
  readonly idPrefix?: string;
}

const GUIDE_COLORS = {
  bleed: '#E12D39',
  trim: '#1F2933',
  safe: '#2F8132',
  margins: '#2186EB',
  dieline: '#C21DA8',
  placeholder: '#7B8794',
  dataBound: '#F0B429',
  issue: '#D64545',
} as const;

const PT_PER_MM = 72 / 25.4;
/** Human-readable barcode text is not yet a controlled font (see docs/typography.md). */
const SYMBOL_TEXT_FONT = "'OCR-B', 'Noto Sans Mono', monospace";

/**
 * Serializes a PageScene to a standalone SVG document string.
 * Output is deterministic: identical scenes and options yield byte-identical SVG.
 */
export function renderSceneToSvg(scene: PageScene, options: SvgRenderOptions = {}): string {
  const guides: SvgGuideOptions = {
    bleed: true,
    trim: true,
    safe: true,
    margins: true,
    dieline: true,
    ...options.guides,
  };
  const prefix = sanitizeId(options.idPrefix ?? `st-${scene.pageId}`);
  const { bleed } = scene.boxes;
  const defs: string[] = [hatchPattern(prefix)];
  const sizeUnit = options.sizeUnit ?? 'mm';

  const sizeAttrs =
    sizeUnit === 'none'
      ? {}
      : sizeUnit === 'mm'
        ? {
            width: `${fmt(bleed.width / PT_PER_MM)}mm`,
            height: `${fmt(bleed.height / PT_PER_MM)}mm`,
          }
        : { width: `${fmt(bleed.width)}pt`, height: `${fmt(bleed.height)}pt` };

  let artworkMask: string | null = null;
  if (options.finish === 'TRIM') {
    artworkMask = `${prefix}-finish`;
    defs.push(finishMask(artworkMask, scene));
  }

  const artwork: string[] = [];
  if (scene.background) {
    artwork.push(`<rect${attrs({ ...rectAttrs(bleed), fill: scene.background })}/>`);
  }
  scene.nodes.forEach((node, index) => {
    artwork.push(renderNode(node, `${prefix}-n${index}`, defs, prefix, options));
  });

  const guideLayer = renderGuides(scene, guides);

  return [
    `<svg${attrs({
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `${fmt(bleed.x)} ${fmt(bleed.y)} ${fmt(bleed.width)} ${fmt(bleed.height)}`,
      ...sizeAttrs,
      'data-document-id': scene.documentId,
      'data-page-id': scene.pageId,
      'data-page-side': scene.side,
    })}>`,
    `<defs>${defs.join('')}</defs>`,
    `<g${attrs({ 'data-layer': 'artwork', mask: artworkMask ? `url(#${artworkMask})` : null })}>${artwork.join('')}</g>`,
    guideLayer,
    '</svg>',
  ].join('');
}

function renderNode(
  node: SceneNode,
  nodeId: string,
  defs: string[],
  prefix: string,
  options: SvgRenderOptions,
): string {
  const { frame } = node;
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const group = attrs({
    'data-object-id': node.id,
    'data-object-type': node.objectType,
    'data-bound': node.dataBound ? 'true' : null,
    transform: node.rotation !== 0 ? `rotate(${fmt(node.rotation)} ${fmt(cx)} ${fmt(cy)})` : null,
    opacity: node.opacity < 1 ? node.opacity : null,
  });

  let body: string;
  let issue = false;
  switch (node.kind) {
    case 'text':
      body = renderText(node, nodeId, defs, options);
      issue = node.overflow || node.missingGlyphs.length > 0 || usesSubstituteFont(node, options);
      break;
    case 'image':
      body = renderImage(node, nodeId, defs, prefix, options);
      break;
    case 'rectangle':
      body = `<rect${attrs({
        ...rectAttrs(frame),
        rx: node.cornerRadius > 0 ? node.cornerRadius : null,
        fill: node.fill ?? 'none',
        ...strokeAttrs(node.stroke),
      })}/>`;
      break;
    case 'ellipse':
      body = `<ellipse${attrs({ cx, cy, rx: frame.width / 2, ry: frame.height / 2, fill: node.fill ?? 'none', ...strokeAttrs(node.stroke) })}/>`;
      break;
    case 'line':
      body = `<line${attrs({ x1: frame.x, y1: cy, x2: frame.x + frame.width, y2: cy, ...strokeAttrs(node.stroke) })}/>`;
      break;
    case 'barcode':
      body = renderBarcode(node, prefix);
      issue = node.symbolStatus !== 'ENCODED' && node.symbolStatus !== 'NO_ENCODER';
      break;
    case 'qrCode':
      body = renderQrCode(node, prefix);
      issue = node.symbolStatus !== 'ENCODED' && node.symbolStatus !== 'NO_ENCODER';
      break;
  }

  const highlights: string[] = [];
  if (options.highlightDataBound && node.dataBound) {
    highlights.push(
      `<rect${attrs({
        ...rectAttrs(frame),
        fill: 'none',
        stroke: GUIDE_COLORS.dataBound,
        'stroke-width': 1,
        'stroke-dasharray': '3 2',
        'vector-effect': 'non-scaling-stroke',
        'data-highlight': 'bound',
      })}/>`,
    );
  }
  if (options.showIssues && issue) {
    highlights.push(
      `<rect${attrs({
        ...rectAttrs(frame),
        fill: 'none',
        stroke: GUIDE_COLORS.issue,
        'stroke-width': 1.5,
        'stroke-dasharray': '4 2',
        'vector-effect': 'non-scaling-stroke',
        'data-highlight': 'issue',
      })}/>`,
    );
  }
  return `<g${group}>${body}${highlights.join('')}</g>`;
}

function renderText(
  node: TextSceneNode,
  nodeId: string,
  defs: string[],
  options: SvgRenderOptions,
): string {
  let clip: string | null = null;
  if (node.clip) {
    clip = `${nodeId}-clip`;
    defs.push(`<clipPath${attrs({ id: clip })}><rect${attrs(rectAttrs(node.frame))}/></clipPath>`);
  }
  const spans = node.lines
    .map((line) => `<tspan${attrs({ x: line.x, y: line.y })}>${escapeXml(line.text)}</tspan>`)
    .join('');
  const controlledFamily = options.resolveFontFamily?.(node) ?? null;
  return `<text${attrs({
    'font-family': controlledFamily
      ? `'${controlledFamily.replace(/["'\\;{}<>]/g, '')}'`
      : cssFontFamily(node.fontFamily),
    'font-size': node.fontSize,
    'font-weight': node.fontWeight,
    'font-style': node.fontStyle === 'italic' ? 'italic' : null,
    'letter-spacing': node.letterSpacing !== 0 ? node.letterSpacing : null,
    fill: node.fill,
    'text-anchor': node.anchor,
    direction: node.direction === 'rtl' ? 'rtl' : null,
    'xml:space': 'preserve',
    'xml:lang': node.language,
    'clip-path': clip ? `url(#${clip})` : null,
    'data-overflow': node.overflow ? 'true' : null,
    // Not drawn with the exact controlled font file: the browser picks a substitute.
    'data-font-substitute': controlledFamily ? null : 'true',
  })}>${spans}</text>`;
}

/**
 * True when controlled fonts are available to this render (a resolver was supplied) but this text
 * has none loaded — unassigned, unknown, failed or still loading. Reported as an issue, never hidden.
 */
function usesSubstituteFont(node: TextSceneNode, options: SvgRenderOptions): boolean {
  return options.resolveFontFamily !== undefined && options.resolveFontFamily(node) === null;
}

function renderImage(
  node: ImageSceneNode,
  nodeId: string,
  defs: string[],
  prefix: string,
  options: SvgRenderOptions,
): string {
  const url =
    node.assetId && options.resolveAssetUrl ? options.resolveAssetUrl(node.assetId) : null;
  if (!url || !isSafeImageUrl(url)) {
    return placeholderBox(node.frame, prefix, [node.assetId ? 'IMAGE' : 'NO IMAGE']);
  }
  const size = node.assetId ? (options.resolveAssetSize?.(node.assetId) ?? null) : null;
  const clipId = `${nodeId}-clip`;
  const clipDef = `<clipPath${attrs({ id: clipId })}><rect${attrs(rectAttrs(node.frame))}/></clipPath>`;

  if (size && size.width > 0 && size.height > 0) {
    // Exact placement (fit + crop) shared with the canvas editor.
    const fit = node.fit === 'contain' ? 'CONTAIN' : node.fit === 'cover' ? 'COVER' : 'STRETCH';
    const placement = computeImagePlacement(node.frame, size, fit, node.crop);
    const { source, destination } = placement;
    const needsClip = placement.clip || node.crop !== null;
    if (needsClip) defs.push(clipDef);
    return `<g${attrs({ 'clip-path': needsClip ? `url(#${clipId})` : null })}><svg${attrs({
      x: node.frame.x + destination.x,
      y: node.frame.y + destination.y,
      width: destination.width,
      height: destination.height,
      viewBox: `${fmt(source.x)} ${fmt(source.y)} ${fmt(source.width)} ${fmt(source.height)}`,
      preserveAspectRatio: 'none',
      overflow: 'hidden',
    })}><image${attrs({ href: url, x: 0, y: 0, width: size.width, height: size.height, preserveAspectRatio: 'none' })}/></svg></g>`;
  }

  if (node.fit === 'cover') {
    defs.push(clipDef);
  }
  return `<image${attrs({
    href: url,
    ...rectAttrs(node.frame),
    preserveAspectRatio:
      node.fit === 'contain' ? 'xMidYMid meet' : node.fit === 'cover' ? 'xMidYMid slice' : 'none',
    'clip-path': node.fit === 'cover' ? `url(#${clipId})` : null,
  })}/>`;
}

/** Axis-aligned rectangles as one compact path (bars and QR module runs). */
function rectsToPath(rects: readonly SymbolRect[], originX: number, originY: number): string {
  return rects
    .map(
      (r) =>
        `M${fmt(originX + r.x)} ${fmt(originY + r.y)}h${fmt(r.width)}v${fmt(r.height)}h${fmt(-r.width)}Z`,
    )
    .join('');
}

function renderSymbolTexts(texts: readonly SymbolText[], frame: Rect, fill: string): string {
  return texts
    .map(
      (text) =>
        `<text${attrs({
          x: frame.x + text.x,
          y: frame.y + text.y,
          'font-family': SYMBOL_TEXT_FONT,
          'font-size': text.fontSize,
          'text-anchor': text.anchor,
          fill,
        })}>${escapeXml(text.text)}</text>`,
    )
    .join('');
}

function renderBarcode(node: BarcodeSceneNode, prefix: string): string {
  const background = node.background
    ? `<rect${attrs({ ...rectAttrs(node.frame), fill: node.background })}/>`
    : '';
  if (node.symbol) {
    return `${background}<path${attrs({
      d: rectsToPath(node.symbol.bars, node.frame.x, node.frame.y),
      fill: node.foreground,
      'shape-rendering': 'crispEdges',
      'data-symbol': 'bars',
    })}/>${renderSymbolTexts(node.symbol.texts, node.frame, node.foreground)}`;
  }
  return `${background}${placeholderBox(node.frame, prefix, symbolLabels(node, node.symbology))}`;
}

function renderQrCode(node: QrCodeSceneNode, prefix: string): string {
  if (node.symbol) {
    const { bounds } = node.symbol;
    const background = node.background
      ? `<rect${attrs({
          x: node.frame.x + bounds.x,
          y: node.frame.y + bounds.y,
          width: bounds.width,
          height: bounds.height,
          fill: node.background,
        })}/>`
      : '';
    return `${background}<path${attrs({
      d: rectsToPath(node.symbol.runs, node.frame.x, node.frame.y),
      fill: node.foreground,
      'shape-rendering': 'crispEdges',
      'data-symbol': 'modules',
    })}/>`;
  }
  const background = node.background
    ? `<rect${attrs({ ...rectAttrs(node.frame), fill: node.background })}/>`
    : '';
  return `${background}${placeholderBox(node.frame, prefix, symbolLabels(node, `QR · ${node.errorCorrection}`))}`;
}

function symbolLabels(node: BarcodeSceneNode | QrCodeSceneNode, title: string): string[] {
  const value = node.value || '(no value)';
  switch (node.symbolStatus) {
    case 'INVALID_VALUE':
      return [title, value, `invalid: ${node.symbolMessage ?? ''}`];
    case 'NOT_ENABLED':
      return [title, value, 'preview not enabled'];
    case 'ENCODER_ERROR':
      return [title, value, 'encoding failed'];
    case 'NO_ENCODER':
    case 'ENCODED':
      return [title, value, 'placeholder'];
  }
}

/** A hatched, labelled box that cannot be mistaken for real, scannable artwork. */
function placeholderBox(frame: Rect, prefix: string, labels: readonly string[]): string {
  const fontSize = Math.max(
    2.5,
    Math.min(7, frame.height / (labels.length * 1.6), frame.width / 12),
  );
  const cx = frame.x + frame.width / 2;
  const firstBaseline =
    frame.y + frame.height / 2 - ((labels.length - 1) * fontSize * 1.25) / 2 + fontSize * 0.35;
  const text = labels
    .map(
      (label, index) =>
        `<text${attrs({
          x: cx,
          y: firstBaseline + index * fontSize * 1.25,
          'font-family': cssFontFamily('Noto Sans'),
          'font-size': fontSize,
          'font-weight': index === 0 ? 700 : 400,
          'text-anchor': 'middle',
          fill: '#3E4C59',
        })}>${escapeXml(truncate(label, 40))}</text>`,
    )
    .join('');
  return (
    `<rect${attrs({
      ...rectAttrs(frame),
      fill: `url(#${prefix}-hatch)`,
      stroke: GUIDE_COLORS.placeholder,
      'stroke-width': 0.5,
      'stroke-dasharray': '2 1',
      'data-placeholder': 'true',
    })}/>` + text
  );
}

function renderGuides(scene: PageScene, guides: SvgGuideOptions): string {
  const common = { fill: 'none', 'vector-effect': 'non-scaling-stroke' } as const;
  const parts: string[] = [];
  const { boxes } = scene;
  if (guides.bleed) {
    parts.push(
      `<rect${attrs({ ...rectAttrs(boxes.bleed), ...common, stroke: GUIDE_COLORS.bleed, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'data-guide': 'bleed' })}/>`,
    );
  }
  if (guides.margins) {
    parts.push(
      `<rect${attrs({ ...rectAttrs(boxes.margin), ...common, stroke: GUIDE_COLORS.margins, 'stroke-width': 1, 'stroke-dasharray': '1 3', 'data-guide': 'margins' })}/>`,
    );
  }
  if (guides.safe) {
    parts.push(
      `<rect${attrs({ ...rectAttrs(boxes.safe), ...common, stroke: GUIDE_COLORS.safe, 'stroke-width': 1, 'stroke-dasharray': '6 3', 'data-guide': 'safe' })}/>`,
    );
  }
  if (guides.trim) {
    parts.push(
      `<rect${attrs({ ...rectAttrs(boxes.trim), rx: scene.trimCornerRadius > 0 ? scene.trimCornerRadius : null, ...common, stroke: GUIDE_COLORS.trim, 'stroke-width': 1.25, 'data-guide': 'trim' })}/>`,
    );
  }
  if (guides.dieline) {
    for (const feature of scene.dieline) {
      parts.push(renderDielineFeature(feature, common));
    }
  }
  return `<g${attrs({ 'data-layer': 'guides', 'pointer-events': 'none' })}>${parts.join('')}</g>`;
}

function renderDielineFeature(
  feature: SceneDielineFeature,
  common: Record<string, string>,
): string {
  const stroke = {
    ...common,
    stroke: GUIDE_COLORS.dieline,
    'stroke-width': 1,
    'data-guide': 'dieline',
    'data-feature-id': feature.id,
  };
  switch (feature.kind) {
    case 'PUNCH_HOLE':
      return `<circle${attrs({ cx: feature.cx, cy: feature.cy, r: feature.radius, ...stroke })}/>`;
    case 'SLOT_HOLE':
      return `<rect${attrs({
        x: feature.cx - feature.width / 2,
        y: feature.cy - feature.height / 2,
        width: feature.width,
        height: feature.height,
        rx: Math.min(feature.width, feature.height) / 2,
        transform:
          feature.rotation !== 0
            ? `rotate(${fmt(feature.rotation)} ${fmt(feature.cx)} ${fmt(feature.cy)})`
            : null,
        ...stroke,
      })}/>`;
    case 'FOLD_LINE':
    case 'PERFORATION':
      return `<line${attrs({ x1: feature.x1, y1: feature.y1, x2: feature.x2, y2: feature.y2, 'stroke-dasharray': feature.dash.map(fmt).join(' '), ...stroke })}/>`;
  }
}

function finishMask(id: string, scene: PageScene): string {
  const cutouts = scene.dieline
    .map((feature) => {
      switch (feature.kind) {
        case 'PUNCH_HOLE':
          return `<circle${attrs({ cx: feature.cx, cy: feature.cy, r: feature.radius, fill: 'black' })}/>`;
        case 'SLOT_HOLE':
          return `<rect${attrs({
            x: feature.cx - feature.width / 2,
            y: feature.cy - feature.height / 2,
            width: feature.width,
            height: feature.height,
            rx: Math.min(feature.width, feature.height) / 2,
            transform:
              feature.rotation !== 0
                ? `rotate(${fmt(feature.rotation)} ${fmt(feature.cx)} ${fmt(feature.cy)})`
                : null,
            fill: 'black',
          })}/>`;
        case 'FOLD_LINE':
        case 'PERFORATION':
          return '';
      }
    })
    .join('');
  return `<mask${attrs({ id, maskUnits: 'userSpaceOnUse', ...rectAttrs(scene.boxes.bleed) })}><rect${attrs(
    {
      ...rectAttrs(scene.boxes.trim),
      rx: scene.trimCornerRadius > 0 ? scene.trimCornerRadius : null,
      fill: 'white',
    },
  )}/>${cutouts}</mask>`;
}

function hatchPattern(prefix: string): string {
  return `<pattern${attrs({ id: `${prefix}-hatch`, patternUnits: 'userSpaceOnUse', width: 4, height: 4 })}><rect${attrs(
    {
      width: 4,
      height: 4,
      fill: '#F5F7FA',
    },
  )}/><path${attrs({ d: 'M0 4L4 0', stroke: '#CBD2D9', 'stroke-width': 0.6 })}/></pattern>`;
}

function rectAttrs(rect: Rect) {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function strokeAttrs(stroke: SceneStroke | null) {
  if (!stroke) {
    return { stroke: 'none' };
  }
  return {
    stroke: stroke.color,
    'stroke-width': stroke.width,
    'stroke-dasharray': stroke.dash.length > 0 ? stroke.dash.map(fmt).join(' ') : null,
    'stroke-linecap': stroke.lineCap !== 'butt' ? stroke.lineCap : null,
    'stroke-linejoin': stroke.lineJoin !== 'miter' ? stroke.lineJoin : null,
  };
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

function truncate(value: string, max: number): string {
  const chars = [...value];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : value;
}
