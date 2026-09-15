import type { ArtworkObject } from '@smarttag/document-schema';
import { FabricObject, Point, util } from 'fabric';
import {
  drawArtwork,
  drawDataHiddenGhost,
  drawDataIssueMarker,
  type ArtworkIssue,
  type DataIssueSeverity,
} from './draw';
import { fabricTransformFor, measureFabricFrame, reconcileObject } from './geometry';
import type { RenderServices } from './services';

/**
 * How an object is shown in Data Preview. Editor-only: the canonical object stays the source of
 * geometry, selection and every command; only drawing uses the resolved copy.
 */
export interface ArtworkDataDisplay {
  /** The object with data-bound properties resolved (same id and geometry as the canonical one). */
  readonly object: ArtworkObject | null;
  /** The record hides the object (visibility binding resolved to false). */
  readonly hidden: boolean;
  /** Worst data issue of the object, drawn as an editor-only marker. */
  readonly issue: DataIssueSeverity | null;
}

export const NO_DATA_DISPLAY: ArtworkDataDisplay = Object.freeze({
  object: null,
  hidden: false,
  issue: null,
});

export interface ArtworkObjectState {
  /** Object or its group is locked. */
  readonly locked: boolean;
  /** Object and its group are visible. */
  readonly visible: boolean;
  readonly readOnly: boolean;
}

const SELECTION_COLOR = '#2186EB';
/** Screen distance within which a click hits a thin line. */
const LINE_HIT_TOLERANCE_PX = 6;

/**
 * Fabric representation of ONE canonical artwork object. It holds the canonical snapshot it was
 * created from and draws exclusively from canonical data; Fabric only provides transforms,
 * selection, controls and hit-testing. It is never serialized — `readCanonical()` produces the
 * canonical object again (docs/editor.md#canvas-architecture).
 */
export class ArtworkFabricObject extends FabricObject {
  static override type = 'smarttag-artwork';

  canonical: ArtworkObject;
  /** The canonical object translated to the origin; cached so text layouts are memoized. */
  private local: ArtworkObject;
  private services: RenderServices;
  state: ArtworkObjectState;
  showIssues = true;
  lastIssues: readonly ArtworkIssue[] = [];
  /** Data Preview display state; NO_DATA_DISPLAY shows the template values. */
  dataDisplay: ArtworkDataDisplay = NO_DATA_DISPLAY;
  /** The resolved object translated to the origin (cached per resolved snapshot). */
  private displayLocal: ArtworkObject | null = null;
  private displaySource: ArtworkObject | null = null;

  constructor(canonical: ArtworkObject, services: RenderServices, state: ArtworkObjectState) {
    super({
      strokeWidth: 0,
      objectCaching: false,
      noScaleCache: true,
      lockSkewingX: true,
      lockSkewingY: true,
      lockScalingFlip: true,
      centeredRotation: true,
      borderColor: SELECTION_COLOR,
      cornerColor: '#FFFFFF',
      cornerStrokeColor: SELECTION_COLOR,
      cornerStyle: 'circle',
      transparentCorners: false,
      cornerSize: 9,
      borderScaleFactor: 1.5,
      padding: 0,
    });
    this.canonical = canonical;
    this.local = { ...canonical, x: 0, y: 0 };
    this.services = services;
    this.state = state;
    this.applyCanonical(canonical, state);
  }

  get objectId(): string {
    return this.canonical.id;
  }

  setServices(services: RenderServices): void {
    this.services = services;
  }

  /** Canonical → Fabric: transform, interaction constraints and visibility. */
  applyCanonical(canonical: ArtworkObject, state: ArtworkObjectState): void {
    this.canonical = canonical;
    this.local = { ...canonical, x: 0, y: 0 };
    this.state = state;
    this.updateDisplayLocal();
    const interactive = !state.locked && !state.readOnly;
    this.set({
      ...fabricTransformFor(canonical),
      visible: state.visible,
      // Locked and hidden objects cannot be hit on the canvas (select them from Layers).
      evented: state.visible && !state.locked,
      selectable: state.visible,
      lockMovementX: !interactive,
      lockMovementY: !interactive,
      lockRotation: !interactive,
      lockScalingX: !interactive,
      lockScalingY: !interactive || canonical.type === 'line',
      hasControls: interactive,
      hoverCursor: interactive ? 'move' : 'default',
    });
    this.setControlsVisibility(controlVisibility(canonical));
    this.setCoords();
  }

  /**
   * Shows resolved data instead of the template values (or template values again with
   * NO_DATA_DISPLAY). Returns true when the drawing changes.
   */
  setDataDisplay(display: ArtworkDataDisplay): boolean {
    const current = this.dataDisplay;
    if (
      current.object === display.object &&
      current.hidden === display.hidden &&
      current.issue === display.issue
    ) {
      return false;
    }
    this.dataDisplay = display;
    this.updateDisplayLocal();
    return true;
  }

  /**
   * A resolved copy is only drawn while its geometry equals the canonical object. Between a
   * canonical change and the next preview update the template values are drawn instead, so a
   * stale resolved copy can never draw at an outdated size.
   */
  private updateDisplayLocal(): void {
    const resolved = this.dataDisplay.object;
    const canonical = this.canonical;
    const matches =
      resolved !== null &&
      resolved.id === canonical.id &&
      resolved.type === canonical.type &&
      resolved.width === canonical.width &&
      resolved.height === canonical.height &&
      resolved.rotation === canonical.rotation;
    if (!matches) {
      this.displayLocal = null;
    } else if (this.displayLocal === null || this.displaySource !== resolved) {
      this.displayLocal = { ...resolved, x: 0, y: 0 };
    }
    this.displaySource = matches ? resolved : null;
  }

  /** Fabric → canonical: the snapshot with geometry read back from the current transform. */
  readCanonical(): ArtworkObject {
    return reconcileObject(this.canonical, measureFabricFrame(this));
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    const scaleX = this.scaleX || 1;
    const scaleY = this.scaleY || 1;
    const width = this.width * scaleX;
    const height = this.height * scaleY;
    // During a resize gesture draw at the new size (text reflows, symbols re-lay out) instead of
    // stretching the old rendering.
    // Data Preview draws the resolved copy; its geometry always equals the canonical object's.
    const source = this.displayLocal ?? this.local;
    const object =
      scaleX === 1 && scaleY === 1
        ? source
        : {
            ...source,
            width,
            height: this.canonical.type === 'line' ? this.canonical.height : height,
          };
    // The viewport transform scale (Fabric "zoom") maps points to CSS pixels.
    const pixelsPerPoint = this.canvas?.getZoom() ?? 1;
    ctx.save();
    ctx.scale(1 / scaleX, 1 / scaleY);
    ctx.translate(-width / 2, -object.height / 2);
    const pointsPerPixel = 1 / pixelsPerPoint;
    if (this.dataDisplay.hidden) {
      drawDataHiddenGhost(ctx, width, object.height, pointsPerPixel);
      this.lastIssues = [];
    } else {
      const result = drawArtwork(ctx, object, this.services, {
        pointsPerPixel,
        showIssues: this.showIssues,
      });
      this.lastIssues = result.issues;
    }
    if (this.showIssues && this.dataDisplay.issue) {
      drawDataIssueMarker(ctx, width, object.height, pointsPerPixel, this.dataDisplay.issue);
    }
    ctx.restore();
  }

  /** Thin lines are hard to hit; accept clicks within a constant screen distance. */
  override containsPoint(point: Point): boolean {
    if (this.canonical.type !== 'line') {
      return super.containsPoint(point);
    }
    const local = point.transform(util.invertTransform(this.calcTransformMatrix()));
    const tolerance = LINE_HIT_TOLERANCE_PX / (this.canvas?.getZoom() ?? 1);
    const scale = Math.abs(this.scaleX) || 1;
    return (
      Math.abs(local.x) * scale <= (this.width * scale) / 2 + tolerance &&
      Math.abs(local.y) <= tolerance + this.canonical.stroke.width / 2
    );
  }
}

/** No skew handles anywhere; lines resize along their length; square symbols and aspect-locked images use corners. */
function controlVisibility(object: ArtworkObject): Record<string, boolean> {
  if (object.type === 'line') {
    return {
      tl: false,
      tr: false,
      bl: false,
      br: false,
      mt: false,
      mb: false,
      ml: true,
      mr: true,
      mtr: true,
    };
  }
  if (object.type === 'qrCode' || (object.type === 'image' && object.preserveAspectRatio)) {
    return {
      tl: true,
      tr: true,
      bl: true,
      br: true,
      mt: false,
      mb: false,
      ml: false,
      mr: false,
      mtr: true,
    };
  }
  return {
    tl: true,
    tr: true,
    bl: true,
    br: true,
    mt: true,
    mb: true,
    ml: true,
    mr: true,
    mtr: true,
  };
}

/** Pure helper for tests and tooling: create the Fabric object for a canonical object. */
export function createArtworkFabricObject(
  canonical: ArtworkObject,
  services: RenderServices,
  state: ArtworkObjectState = {
    locked: canonical.locked,
    visible: canonical.visible,
    readOnly: false,
  },
): ArtworkFabricObject {
  return new ArtworkFabricObject(canonical, services, state);
}

export { Point };
