import type { CanvasDataPreview, EditorCanvas, RenderServices } from '@smarttag/canvas-adapter';
import {
  buildDataPreview,
  createSampleRecord,
  type AssetAvailability,
  type DataPreview,
  type TestValue,
} from '@smarttag/data-core';
import type { ArtworkObject, DesignDocument } from '@smarttag/document-schema';
import type { EditorStore } from '@smarttag/editor-core';

export type PreviewMode = 'TEMPLATE' | 'DATA';

/** A test record as the editor holds it: raw values per field key, exactly as entered. */
export type TestRecord = Readonly<Record<string, TestValue>>;

export interface DataPreviewState {
  /** TEMPLATE shows the stored template values; DATA shows the artwork resolved with the test record. */
  readonly mode: PreviewMode;
  readonly record: TestRecord;
  /** Increments whenever the record, the mode or the result changes. */
  readonly version: number;
}

interface Cache {
  readonly document: DesignDocument;
  readonly record: TestRecord;
  readonly resourceVersion: number;
  readonly preview: DataPreview;
}

type Listener = () => void;

/**
 * Test data for one editing session (docs/data-bindings.md#test-data-preview).
 *
 *   canonical document (store) + test record (here) → data-core → resolved preview
 *
 * The test record is temporary editor context: it is never written into the document, never saved
 * and never changes the template hash. The resolved preview is recomputed in full for every change
 * (measured at well under a millisecond for 120 objects / 60 bindings) and handed to the canvas as
 * display-only state.
 */
export class DataPreviewController {
  private state: DataPreviewState = { mode: 'TEMPLATE', record: {}, version: 0 };
  private cache: Cache | null = null;
  private readonly listeners = new Set<Listener>();
  private canvas: EditorCanvas | null = null;
  private resourceVersion = 0;
  private unsubscribeStore: (() => void) | null = null;
  /** Duration of the last pipeline run in milliseconds (diagnostics and performance tests). */
  lastComputeMs = 0;

  constructor(
    private readonly store: EditorStore,
    private readonly services: () => RenderServices,
    private readonly assetAvailability: (assetId: string) => AssetAvailability,
  ) {}

  start(): void {
    this.unsubscribeStore ??= this.store.subscribe(() => this.pushToCanvas());
  }

  stop(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
  }

  getState = (): DataPreviewState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<DataPreviewState>): void {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
    this.pushToCanvas();
    for (const listener of [...this.listeners]) listener();
  }

  attachCanvas(canvas: EditorCanvas | null): void {
    this.canvas = canvas;
    this.pushToCanvas();
  }

  /** Fonts, images or asset metadata changed: layout and image checks may change. */
  invalidateResources(): void {
    this.resourceVersion += 1;
    if (this.state.mode === 'DATA') this.set({});
  }

  setMode(mode: PreviewMode): void {
    if (mode !== this.state.mode) this.set({ mode });
  }

  setValue(key: string, value: TestValue): void {
    if (this.state.record[key] === value) return;
    this.set({ record: { ...this.state.record, [key]: value } });
  }

  replaceRecord(record: TestRecord): void {
    this.set({ record });
  }

  fillSample(document: DesignDocument): void {
    this.set({ record: { ...createSampleRecord(document.dataSchema), ...this.nonEmpty() } });
  }

  private nonEmpty(): TestRecord {
    return Object.fromEntries(
      Object.entries(this.state.record).filter(
        ([, value]) => value !== null && !(typeof value === 'string' && value.trim() === ''),
      ),
    );
  }

  /** The preview of the current document with the current test record (memoized). */
  compute(document: DesignDocument): DataPreview {
    const cached = this.cache;
    if (
      cached &&
      cached.document === document &&
      cached.record === this.state.record &&
      cached.resourceVersion === this.resourceVersion
    ) {
      return cached.preview;
    }
    const started = performance.now();
    const preview = buildDataPreview(document, this.state.record, {
      textLayout: this.services().textLayout,
      assetAvailability: this.assetAvailability,
    });
    this.lastComputeMs = performance.now() - started;
    performance.measure('st-data-preview-compute', {
      start: started,
      duration: this.lastComputeMs,
    });
    this.cache = {
      document,
      record: this.state.record,
      resourceVersion: this.resourceVersion,
      preview,
    };
    return preview;
  }

  /** The preview for the store's current document, or null in Template Values mode. */
  current(): DataPreview | null {
    return this.state.mode === 'DATA' ? this.compute(this.store.getState().document) : null;
  }

  private pushToCanvas(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    if (this.state.mode !== 'DATA') {
      if (canvas.getDataPreview() !== null) canvas.setDataPreview(null);
      return;
    }
    const document = this.store.getState().document;
    const preview = this.compute(document);
    const previous = canvas.getDataPreview();
    const next = toCanvasPreview(document, preview);
    if (!previous || !sameCanvasPreview(previous, next)) {
      performance.mark('st-data-preview-canvas-start');
      canvas.setDataPreview(next);
      canvas.fabric.renderAll();
      performance.measure('st-data-preview-canvas', 'st-data-preview-canvas-start');
    }
  }
}

/** Display state for the canvas: resolved objects that differ from the template, hidden ids, markers. */
export function toCanvasPreview(document: DesignDocument, preview: DataPreview): CanvasDataPreview {
  const objects = new Map<string, ArtworkObject>();
  preview.resolution.document.pages.forEach((page, pageIndex) => {
    const source = document.pages[pageIndex]?.objects;
    page.objects.forEach((object, index) => {
      if (source?.[index] !== object) objects.set(object.id, object);
    });
  });
  const issues = new Map<string, 'ERROR' | 'WARNING'>();
  for (const issue of preview.issues) {
    if (!issue.target) continue;
    if (issues.get(issue.target.objectId) !== 'ERROR') {
      issues.set(issue.target.objectId, issue.severity);
    }
  }
  return { objects, hiddenObjectIds: preview.resolution.hiddenObjectIds, issues };
}

function sameCanvasPreview(a: CanvasDataPreview, b: CanvasDataPreview): boolean {
  if (a.objects.size !== b.objects.size || a.issues.size !== b.issues.size) return false;
  if (a.hiddenObjectIds.size !== b.hiddenObjectIds.size) return false;
  for (const [id, object] of b.objects) if (a.objects.get(id) !== object) return false;
  for (const [id, severity] of b.issues) if (a.issues.get(id) !== severity) return false;
  for (const id of b.hiddenObjectIds) if (!a.hiddenObjectIds.has(id)) return false;
  return true;
}
