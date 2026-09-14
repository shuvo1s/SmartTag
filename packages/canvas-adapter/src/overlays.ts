import type { Rect } from '@smarttag/document-schema';
import type { SnapGuide } from '@smarttag/editor-core';
import type { PageGuides } from '@smarttag/rendering-core';

/**
 * Non-printing editor overlays, drawn directly on the canvas context in `before:render` /
 * `after:render`. They are not Fabric objects: they cannot be selected, moved, deleted or
 * serialized, so production geometry can never turn into artwork by accident.
 */

export interface GuideVisibility {
  readonly bleed: boolean;
  readonly trim: boolean;
  readonly safe: boolean;
  readonly margins: boolean;
  readonly dieline: boolean;
}

export const GUIDE_COLORS = {
  pasteboard: '#DDE3EA',
  bleed: '#E12D39',
  trim: '#1F2933',
  safe: '#2F8132',
  margins: '#2186EB',
  dieline: '#C21DA8',
  snap: '#F7249A',
  placement: '#F08C00',
} as const;

type Matrix = readonly [number, number, number, number, number, number];

function withViewport(ctx: CanvasRenderingContext2D, vpt: Matrix, draw: () => void): void {
  ctx.save();
  ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
  draw();
  ctx.restore();
}

function roundedRectPath(ctx: CanvasRenderingContext2D, rect: Rect, radius: number): void {
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  ctx.beginPath();
  if (r === 0) {
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    return;
  }
  const { x, y, width, height } = rect;
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Pasteboard behind the sheet, and the printed sheet (bleed box) with the page background. */
export function drawPasteboard(
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number },
  vpt: Matrix,
  guides: PageGuides,
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = GUIDE_COLORS.pasteboard;
  ctx.fillRect(0, 0, size.width * 4, size.height * 4);
  ctx.restore();
  const zoom = vpt[0];
  withViewport(ctx, vpt, () => {
    const { bleed } = guides.boxes;
    ctx.shadowColor = 'rgba(15, 23, 42, 0.18)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = guides.background ?? '#FFFFFF';
    ctx.fillRect(bleed.x, bleed.y, bleed.width, bleed.height);
    ctx.shadowColor = 'transparent';
    void zoom;
  });
}

export function drawGuides(
  ctx: CanvasRenderingContext2D,
  vpt: Matrix,
  guides: PageGuides,
  visibility: GuideVisibility,
): void {
  const px = 1 / vpt[0];
  withViewport(ctx, vpt, () => {
    const { boxes } = guides;
    const strokeBox = (rect: Rect, color: string, dash: number[], width = 1, radius = 0) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width * px;
      ctx.setLineDash(dash.map((value) => value * px));
      roundedRectPath(ctx, rect, radius);
      ctx.stroke();
    };
    if (visibility.bleed) strokeBox(boxes.bleed, GUIDE_COLORS.bleed, [5, 4]);
    if (visibility.margins) strokeBox(boxes.margin, GUIDE_COLORS.margins, [1, 3]);
    if (visibility.safe) strokeBox(boxes.safe, GUIDE_COLORS.safe, [6, 3]);
    if (visibility.trim)
      strokeBox(boxes.trim, GUIDE_COLORS.trim, [], 1.25, guides.trimCornerRadius);

    if (!visibility.dieline) return;
    ctx.setLineDash([]);
    for (const feature of guides.dieline) {
      ctx.strokeStyle = GUIDE_COLORS.dieline;
      ctx.lineWidth = 1.25 * px;
      switch (feature.kind) {
        case 'PUNCH_HOLE':
          // Show the hole as a knock-out so it reads as "no material here".
          ctx.beginPath();
          ctx.arc(feature.cx, feature.cy, feature.radius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(221, 227, 234, 0.85)';
          ctx.fill();
          ctx.stroke();
          break;
        case 'SLOT_HOLE':
          ctx.save();
          ctx.translate(feature.cx, feature.cy);
          ctx.rotate((feature.rotation * Math.PI) / 180);
          roundedRectPath(
            ctx,
            {
              x: -feature.width / 2,
              y: -feature.height / 2,
              width: feature.width,
              height: feature.height,
            },
            Math.min(feature.width, feature.height) / 2,
          );
          ctx.fillStyle = 'rgba(221, 227, 234, 0.85)';
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          break;
        case 'FOLD_LINE':
        case 'PERFORATION':
          ctx.setLineDash(feature.dash.map((value) => value));
          ctx.beginPath();
          ctx.moveTo(feature.x1, feature.y1);
          ctx.lineTo(feature.x2, feature.y2);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
      }
    }
  });
}

export function drawSnapGuides(
  ctx: CanvasRenderingContext2D,
  vpt: Matrix,
  snapGuides: readonly SnapGuide[],
  extent: Rect,
): void {
  if (snapGuides.length === 0) return;
  const px = 1 / vpt[0];
  const margin = 40 * px;
  withViewport(ctx, vpt, () => {
    ctx.strokeStyle = GUIDE_COLORS.snap;
    ctx.lineWidth = px;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const guide of snapGuides) {
      if (guide.orientation === 'VERTICAL') {
        ctx.moveTo(guide.position, extent.y - margin);
        ctx.lineTo(guide.position, extent.y + extent.height + margin);
      } else {
        ctx.moveTo(extent.x - margin, guide.position);
        ctx.lineTo(extent.x + extent.width + margin, guide.position);
      }
    }
    ctx.stroke();
  });
}

/** Orange outline around objects outside the useful production area. */
export function drawPlacementWarnings(
  ctx: CanvasRenderingContext2D,
  vpt: Matrix,
  frames: readonly { x: number; y: number; width: number; height: number; rotation: number }[],
): void {
  if (frames.length === 0) return;
  const px = 1 / vpt[0];
  withViewport(ctx, vpt, () => {
    ctx.strokeStyle = GUIDE_COLORS.placement;
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([3 * px, 2 * px]);
    for (const frame of frames) {
      ctx.save();
      ctx.translate(frame.x + frame.width / 2, frame.y + frame.height / 2);
      ctx.rotate((frame.rotation * Math.PI) / 180);
      ctx.strokeRect(-frame.width / 2, -frame.height / 2, frame.width, Math.max(frame.height, px));
      ctx.restore();
    }
  });
}
