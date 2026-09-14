import {
  getBleedBox,
  type ArtworkObject,
  type DesignDocument,
  type Page,
} from '@smarttag/document-schema';
import {
  SNAP_TOLERANCE_PX,
  buildSnapTargets,
  clampZoom,
  findPage,
  fitBox,
  isEffectivelyLocked,
  isEffectivelyVisible,
  nextZoomStep,
  paintOrder,
  placementWarning,
  setObjectFrames,
  snapMovingBounds,
  viewportScale,
  wheelZoomFactor,
  zoomAt,
  type EditorState,
  type EditorStore,
  type FrameChange,
  type SnapGuide,
  type SnapTargets,
  type Viewport,
} from '@smarttag/editor-core';
import { buildPageGuides, type PageGuides } from '@smarttag/rendering-core';
import { ActiveSelection, Canvas, type FabricObject, type TPointerEventInfo } from 'fabric';
import { ArtworkFabricObject, type ArtworkObjectState } from './artwork-object';
import { measureFabricFrame, reconcilePage, toFrameChange } from './geometry';
import {
  drawGuides,
  drawPasteboard,
  drawPlacementWarnings,
  drawSnapGuides,
  type GuideVisibility,
} from './overlays';
import type { RenderServices } from './services';

export interface EditorCanvasView {
  readonly guides: GuideVisibility;
  readonly snapping: boolean;
  readonly showIssues: boolean;
  readonly showPlacementWarnings: boolean;
}

export const DEFAULT_VIEW: EditorCanvasView = {
  guides: { bleed: true, trim: true, safe: true, margins: false, dieline: true },
  snapping: true,
  showIssues: true,
  showPlacementWarnings: true,
};

export interface EditorCanvasEvents {
  /** Double-click on a text object (the UI opens an inline editor). */
  onEditTextRequest?(objectId: string): void;
  onViewportChange?(viewport: Viewport): void;
  /** Pointer position in trim-space points, or null when the pointer leaves the canvas. */
  onPointerMove?(point: { x: number; y: number } | null): void;
  /** A transform the canonical model cannot represent (skew/mirror) was reverted. */
  onTransformRejected?(message: string): void;
}

export interface EditorCanvasOptions {
  readonly width: number;
  readonly height: number;
  readonly services: RenderServices;
  readonly events?: EditorCanvasEvents;
  readonly view?: Partial<EditorCanvasView>;
}

type TransformLabel = 'Move' | 'Resize' | 'Rotate' | 'Transform';

function labelForAction(action: string | undefined): TransformLabel {
  if (!action) return 'Transform';
  if (action === 'drag') return 'Move';
  if (action.startsWith('scale') || action.startsWith('resiz')) return 'Resize';
  if (action === 'rotate') return 'Rotate';
  return 'Transform';
}

/**
 * The interactive design canvas. The EditorStore (canonical document + UI state) is the source
 * of truth; this class mirrors it into Fabric and turns finished gestures back into ONE editor
 * command each. It never persists or serializes Fabric state.
 */
export class EditorCanvas {
  readonly fabric: Canvas;
  private services: RenderServices;
  private readonly events: EditorCanvasEvents;
  private view: EditorCanvasView;
  private store: EditorStore | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly byId = new Map<string, ArtworkFabricObject>();
  private documentRef: DesignDocument | null = null;
  private pageId: string | null = null;
  private guides: PageGuides | null = null;
  private readOnly = false;
  private syncing = false;
  private viewport: Viewport = { zoom: 1, panX: 0, panY: 0 };
  private fittedFor: string | null = null;
  private snapTargets: SnapTargets | null = null;
  private snapGuides: readonly SnapGuide[] = [];
  private panning: { x: number; y: number } | null = null;
  private panMode = false;
  private lastRenderMs = 0;

  constructor(element: HTMLCanvasElement, options: EditorCanvasOptions) {
    this.services = options.services;
    this.events = options.events ?? {};
    this.view = { ...DEFAULT_VIEW, ...options.view };
    this.fabric = new Canvas(element, {
      width: options.width,
      height: options.height,
      preserveObjectStacking: true,
      selection: true,
      selectionKey: 'shiftKey',
      uniformScaling: true,
      uniScaleKey: undefined,
      centeredKey: undefined,
      altActionKey: undefined,
      stopContextMenu: true,
      fireMiddleClick: true,
      enableRetinaScaling: true,
      renderOnAddRemove: false,
      selectionColor: 'rgba(33, 134, 235, 0.08)',
      selectionBorderColor: '#2186EB',
      selectionLineWidth: 1,
    });
    this.registerFabricEvents();
  }

  // -------------------------------------------------------------------------------------------
  // Store connection and synchronisation (canonical → Fabric)
  // -------------------------------------------------------------------------------------------

  attach(store: EditorStore): () => void {
    this.detach();
    this.store = store;
    this.unsubscribe = store.subscribe(() => this.sync(store.getState()));
    this.sync(store.getState());
    return () => this.detach();
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.store = null;
  }

  dispose(): void {
    this.detach();
    void this.fabric.dispose();
  }

  setServices(services: RenderServices): void {
    this.services = services;
    for (const object of this.byId.values()) object.setServices(services);
    this.fabric.requestRenderAll();
  }

  setView(view: Partial<EditorCanvasView>): void {
    this.view = { ...this.view, ...view };
    for (const object of this.byId.values()) object.showIssues = this.view.showIssues;
    this.fabric.requestRenderAll();
  }

  /** Re-render after fonts or images finished loading. */
  invalidate(): void {
    this.services.textLayout.invalidate();
    this.fabric.requestRenderAll();
  }

  private objectState(page: Page, object: ArtworkObject): ArtworkObjectState {
    return {
      locked: isEffectivelyLocked(page, object),
      visible: isEffectivelyVisible(page, object),
      readOnly: this.readOnly,
    };
  }

  /** Mirrors editor state into the canvas. Unchanged canonical objects are not touched. */
  sync(state: EditorState, force = false): void {
    const { document, activePageId, selection, readOnly } = state;
    const page = findPage(document, activePageId);
    const pageChanged = activePageId !== this.pageId;
    const readOnlyChanged = readOnly !== this.readOnly;
    this.readOnly = readOnly;
    if (pageChanged) {
      this.syncing = true;
      this.fabric.discardActiveObject();
      for (const object of this.byId.values()) this.fabric.remove(object);
      this.byId.clear();
      this.syncing = false;
    }
    if (document !== this.documentRef || pageChanged) {
      this.guides = buildPageGuides(document, activePageId);
      this.documentRef = document;
      this.pageId = activePageId;
      this.snapTargets = null;
    }

    this.syncing = true;
    try {
      const ordered = paintOrder(page);
      const updates: {
        fabricObject: ArtworkFabricObject;
        object: ArtworkObject;
        state: ArtworkObjectState;
      }[] = [];
      const present = new Set<string>();
      for (const object of ordered) {
        present.add(object.id);
        const objectState = this.objectState(page, object);
        const existing = this.byId.get(object.id);
        if (
          existing &&
          (force ||
            readOnlyChanged ||
            existing.canonical !== object ||
            existing.state.locked !== objectState.locked ||
            existing.state.visible !== objectState.visible)
        ) {
          updates.push({ fabricObject: existing, object, state: objectState });
        }
      }

      // Objects inside an active selection have group-relative coordinates. The selection is only
      // dissolved when one of its members must be updated or the store selects something else —
      // never while it already matches, so a drag that starts with a click keeps working.
      const activeIds = this.selectedIds();
      const selectionMatches =
        activeIds.length === selection.length && selection.every((id) => activeIds.includes(id));
      const updatingActiveMember = updates.some(({ fabricObject }) =>
        activeIds.includes(fabricObject.objectId),
      );
      const reselect = !selectionMatches || updatingActiveMember || pageChanged || readOnlyChanged;
      if (reselect) {
        this.fabric.discardActiveObject();
      }

      for (const { fabricObject, object, state: objectState } of updates) {
        fabricObject.applyCanonical(object, objectState);
      }
      for (const object of ordered) {
        if (!this.byId.has(object.id)) {
          const created = new ArtworkFabricObject(
            object,
            this.services,
            this.objectState(page, object),
          );
          created.showIssues = this.view.showIssues;
          this.byId.set(object.id, created);
          this.fabric.add(created);
        }
      }
      for (const [id, object] of this.byId) {
        if (!present.has(id)) {
          this.fabric.remove(object);
          this.byId.delete(id);
        }
      }
      const current = this.fabric.getObjects();
      ordered.forEach((object, index) => {
        const fabricObject = this.byId.get(object.id)!;
        if (current[index] !== fabricObject) {
          this.fabric.moveObjectTo(fabricObject, index);
        }
      });
      if (reselect) {
        this.applySelection(selection);
      }
    } finally {
      this.syncing = false;
    }

    if (this.fittedFor !== `${document.documentId}:${activePageId}` && this.fabric.width > 0) {
      this.fittedFor = `${document.documentId}:${activePageId}`;
      this.fit('FIT_PAGE');
    } else {
      this.fabric.requestRenderAll();
    }
  }

  private applySelection(ids: readonly string[]): void {
    const objects = ids
      .map((id) => this.byId.get(id))
      .filter((object): object is ArtworkFabricObject => !!object && object.visible);
    if (objects.length === 0) return;
    if (objects.length === 1) {
      this.fabric.setActiveObject(objects[0]!);
      return;
    }
    const selection = new ActiveSelection(objects, { canvas: this.fabric });
    this.configureSelection(selection);
    this.fabric.setActiveObject(selection);
  }

  /** Multi-selection: uniform corner scaling only (no skew), nothing if any member is locked. */
  private configureSelection(selection: ActiveSelection): void {
    const members = selection
      .getObjects()
      .filter((o): o is ArtworkFabricObject => o instanceof ArtworkFabricObject);
    const locked = this.readOnly || members.some((member) => member.state.locked);
    selection.set({
      lockSkewingX: true,
      lockSkewingY: true,
      lockScalingFlip: true,
      lockMovementX: locked,
      lockMovementY: locked,
      lockRotation: locked,
      lockScalingX: locked,
      lockScalingY: locked,
      hasControls: !locked,
      borderColor: '#2186EB',
      cornerColor: '#FFFFFF',
      cornerStrokeColor: '#2186EB',
      cornerStyle: 'circle',
      transparentCorners: false,
      cornerSize: 9,
    });
    selection.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
  }

  // -------------------------------------------------------------------------------------------
  // Fabric → canonical
  // -------------------------------------------------------------------------------------------

  /** The active page as read back from the canvas (round-trip checks and diagnostics). */
  readPage(): Page {
    if (!this.documentRef || !this.pageId) {
      throw new Error('EditorCanvas has no document');
    }
    const page = findPage(this.documentRef, this.pageId);
    this.syncing = true;
    const active = this.fabric
      .getActiveObjects()
      .map((object) => (object as ArtworkFabricObject).objectId);
    this.fabric.discardActiveObject();
    const objects = this.fabric
      .getObjects()
      .filter((object): object is ArtworkFabricObject => object instanceof ArtworkFabricObject)
      .map((object) => object.readCanonical());
    this.applySelection(active);
    this.syncing = false;
    return reconcilePage(page, objects);
  }

  private commitTransform(target: FabricObject, action: string | undefined): void {
    const store = this.store;
    if (!store || !this.pageId) return;
    const members = target instanceof ActiveSelection ? target.getObjects() : [target];
    const changes: FrameChange[] = [];
    for (const member of members) {
      if (!(member instanceof ArtworkFabricObject)) continue;
      const measured = measureFabricFrame(member);
      if (measured.unsupported) {
        this.events.onTransformRejected?.('Skewed or mirrored transforms are not supported');
        this.sync(store.getState(), true);
        return;
      }
      changes.push(toFrameChange(member.objectId, measured));
    }
    const pageId = this.pageId;
    const changed = store.apply(
      labelForAction(action),
      (document) => setObjectFrames(document, pageId, changes),
      {
        pageId,
      },
    );
    if (!changed) {
      // Nothing canonical changed (e.g. a sub-precision drag): snap Fabric back to canonical.
      this.sync(store.getState(), true);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Viewport
  // -------------------------------------------------------------------------------------------

  getViewport(): Viewport {
    return this.viewport;
  }

  setViewport(viewport: Viewport): void {
    this.viewport = { ...viewport, zoom: clampZoom(viewport.zoom) };
    const scale = viewportScale(this.viewport.zoom);
    this.fabric.setViewportTransform([scale, 0, 0, scale, this.viewport.panX, this.viewport.panY]);
    this.fabric.requestRenderAll();
    this.events.onViewportChange?.(this.viewport);
  }

  setSize(width: number, height: number): void {
    this.fabric.setDimensions({ width, height });
    this.fabric.requestRenderAll();
  }

  fit(mode: 'FIT_PAGE' | 'FIT_WIDTH'): void {
    if (!this.documentRef) return;
    this.setViewport(
      fitBox(
        getBleedBox(this.documentRef.dimensions),
        { width: this.fabric.width, height: this.fabric.height },
        mode,
      ),
    );
  }

  zoomTo(zoom: number, anchor?: { x: number; y: number }): void {
    const point = anchor ?? { x: this.fabric.width / 2, y: this.fabric.height / 2 };
    this.setViewport(zoomAt(this.viewport, zoom, point));
  }

  zoomStep(direction: 1 | -1): void {
    this.zoomTo(nextZoomStep(this.viewport.zoom, direction));
  }

  /** Space-bar panning: drag moves the view instead of objects. */
  setPanMode(enabled: boolean): void {
    this.panMode = enabled;
    this.fabric.selection = !enabled;
    this.fabric.skipTargetFind = enabled;
    this.fabric.defaultCursor = enabled ? 'grab' : 'default';
    this.fabric.setCursor(this.fabric.defaultCursor);
  }

  /** CSS-pixel frame of an object relative to the canvas element (for inline text editing). */
  objectScreenFrame(objectId: string) {
    const object = this.byId.get(objectId);
    if (!object) return null;
    const scale = this.fabric.getZoom();
    const canonical = object.canonical;
    return {
      left: canonical.x * scale + this.viewport.panX,
      top: canonical.y * scale + this.viewport.panY,
      width: canonical.width * scale,
      height: canonical.height * scale,
      rotation: canonical.rotation,
      scale,
    };
  }

  /** Duration of the last full render in milliseconds (performance diagnostics). */
  renderAllTimed(): number {
    const start = performance.now();
    this.fabric.renderAll();
    this.lastRenderMs = performance.now() - start;
    return this.lastRenderMs;
  }

  getFabricObject(objectId: string): ArtworkFabricObject | undefined {
    return this.byId.get(objectId);
  }

  // -------------------------------------------------------------------------------------------
  // Fabric events
  // -------------------------------------------------------------------------------------------

  private selectedIds(): string[] {
    return this.fabric
      .getActiveObjects()
      .filter((object): object is ArtworkFabricObject => object instanceof ArtworkFabricObject)
      .map((object) => object.objectId);
  }

  private registerFabricEvents(): void {
    const onSelection = () => {
      const active = this.fabric.getActiveObject();
      if (active instanceof ActiveSelection) this.configureSelection(active);
      if (this.syncing || !this.store) return;
      this.store.setSelection(this.selectedIds());
    };
    this.fabric.on('selection:created', onSelection);
    this.fabric.on('selection:updated', onSelection);
    this.fabric.on('selection:cleared', onSelection);

    this.fabric.on('before:transform', () => {
      this.store?.setInteracting(true);
    });

    this.fabric.on('object:moving', ({ target, e }) => {
      this.snapGuides = [];
      if (!this.view.snapping || (e as MouseEvent).altKey || !this.documentRef || !this.pageId)
        return;
      const page = findPage(this.documentRef, this.pageId);
      if (!this.snapTargets) {
        const moving = new Set(
          (target instanceof ActiveSelection ? target.getObjects() : [target])
            .filter((o): o is ArtworkFabricObject => o instanceof ArtworkFabricObject)
            .map((o) => o.objectId),
        );
        this.snapTargets = buildSnapTargets(this.documentRef, page, moving);
      }
      // Fabric does not refresh cached corner coordinates while dragging.
      target.setCoords();
      const coords = target.getCoords();
      const xs = coords.map((point) => point.x);
      const ys = coords.map((point) => point.y);
      const bounds = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
      const result = snapMovingBounds(
        bounds,
        this.snapTargets,
        SNAP_TOLERANCE_PX / this.fabric.getZoom(),
      );
      if (result.dx !== 0 || result.dy !== 0) {
        target.set({ left: target.left + result.dx, top: target.top + result.dy });
        target.setCoords();
      }
      this.snapGuides = result.guides;
    });

    this.fabric.on('object:modified', ({ target, action, transform }) => {
      this.snapGuides = [];
      this.snapTargets = null;
      const resolvedAction = action ?? transform?.action;
      // Fabric is still inside its mouse-up processing here. Committing synchronously would
      // re-sync the canvas (possibly rebuilding the active selection) in the middle of that
      // processing, leaving Fabric with a dangling transform. Commit right after it completes.
      queueMicrotask(() => {
        this.commitTransform(target, resolvedAction);
        this.store?.setInteracting(false);
      });
    });

    this.fabric.on('mouse:down', (event: TPointerEventInfo) => {
      const mouse = event.e as MouseEvent;
      if (this.panMode || mouse.button === 1) {
        this.panning = { x: mouse.clientX, y: mouse.clientY };
        this.fabric.setCursor('grabbing');
      }
    });

    this.fabric.on('mouse:move', (event: TPointerEventInfo) => {
      const mouse = event.e as MouseEvent;
      if (this.panning) {
        const dx = mouse.clientX - this.panning.x;
        const dy = mouse.clientY - this.panning.y;
        this.panning = { x: mouse.clientX, y: mouse.clientY };
        this.setViewport({
          ...this.viewport,
          panX: this.viewport.panX + dx,
          panY: this.viewport.panY + dy,
        });
        return;
      }
      this.events.onPointerMove?.({ x: event.scenePoint.x, y: event.scenePoint.y });
    });

    this.fabric.on('mouse:out', () => this.events.onPointerMove?.(null));

    this.fabric.on('mouse:up', () => {
      if (this.panning) {
        this.panning = null;
        this.fabric.setCursor(this.panMode ? 'grab' : 'default');
      }
      if (this.snapGuides.length > 0) {
        this.snapGuides = [];
        this.fabric.requestRenderAll();
      }
      this.store?.setInteracting(false);
    });

    this.fabric.on('mouse:dblclick', ({ target }) => {
      if (
        target instanceof ArtworkFabricObject &&
        target.canonical.type === 'text' &&
        !target.state.locked &&
        !this.readOnly
      ) {
        this.events.onEditTextRequest?.(target.objectId);
      }
    });

    this.fabric.on('mouse:wheel', (event: TPointerEventInfo<WheelEvent>) => {
      const wheel = event.e;
      wheel.preventDefault();
      wheel.stopPropagation();
      if (wheel.ctrlKey || wheel.metaKey) {
        this.setViewport(
          zoomAt(this.viewport, this.viewport.zoom * wheelZoomFactor(wheel.deltaY), {
            x: event.viewportPoint.x,
            y: event.viewportPoint.y,
          }),
        );
        return;
      }
      const dx = wheel.shiftKey ? wheel.deltaY : wheel.deltaX;
      const dy = wheel.shiftKey ? 0 : wheel.deltaY;
      this.setViewport({
        ...this.viewport,
        panX: this.viewport.panX - dx,
        panY: this.viewport.panY - dy,
      });
    });

    this.fabric.on('before:render', ({ ctx }) => {
      if (!this.guides) return;
      drawPasteboard(
        ctx,
        { width: this.fabric.width, height: this.fabric.height },
        this.fabric.viewportTransform,
        this.guides,
      );
    });

    this.fabric.on('after:render', ({ ctx }) => {
      if (!this.guides || !this.documentRef || !this.pageId) return;
      const vpt = this.fabric.viewportTransform;
      drawGuides(ctx, vpt, this.guides, this.view.guides);
      if (this.view.showPlacementWarnings) {
        const page = this.documentRef.pages.find((candidate) => candidate.id === this.pageId);
        const frames = (page?.objects ?? [])
          .filter((object) => isEffectivelyVisible(page!, object))
          .filter(
            (object) =>
              placementWarning(object, this.documentRef!.dimensions)?.severity === 'warning',
          );
        drawPlacementWarnings(ctx, vpt, frames);
      }
      drawSnapGuides(ctx, vpt, this.snapGuides, this.guides.boxes.bleed);
    });
  }
}
