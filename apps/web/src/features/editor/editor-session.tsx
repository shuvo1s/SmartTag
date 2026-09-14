'use client';

import type { EditorCanvas } from '@smarttag/canvas-adapter';
import type { DesignDocument } from '@smarttag/document-schema';
import {
  EditorCommandError,
  EditorStore,
  SaveController,
  findPage,
  type EditorMutation,
  type EditorState,
  type SaveState,
} from '@smarttag/editor-core';
import type {
  AssetDto,
  FontFaceDto,
  TemplateDto,
  TemplateVersionDetailDto,
} from '@smarttag/shared-types';
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { createRenderingResources, type RenderingResources } from '../rendering/rendering-services';
import { createVersionSaveAdapter } from './editor-api';

export interface EditorSessionInit {
  readonly template: TemplateDto;
  readonly version: TemplateVersionDetailDto;
  readonly document: DesignDocument;
  readonly originalSchemaVersion: number;
  readonly readOnly: boolean;
  readonly readOnlyReason: string | null;
  readonly fonts: readonly FontFaceDto[];
  readonly onSaved: (version: TemplateVersionDetailDto) => void;
}

type Listener = () => void;

/** Transient UI state that is never part of the document (panels, tool, notices). */
export interface EditorUiState {
  readonly leftPanel: 'layers' | 'assets';
  readonly mode: 'edit' | 'preview' | 'compare';
  readonly assetPicker: null | { readonly purpose: 'image' | 'logo' | 'replace' };
  readonly editingTextId: string | null;
  readonly notice: null | {
    readonly tone: 'info' | 'warning' | 'danger';
    readonly message: string;
  };
  readonly shortcutsOpen: boolean;
  readonly viewport: { readonly zoom: number; readonly panX: number; readonly panY: number };
  readonly pointer: { readonly x: number; readonly y: number } | null;
}

/**
 * Everything one editing session needs, created once per opened version. React components
 * subscribe to narrow slices; the canvas subscribes to the store directly, so pointer movement
 * never re-renders React.
 */
export class EditorSession {
  readonly template: TemplateDto;
  readonly versionId: string;
  readonly store: EditorStore;
  readonly save: SaveController;
  readonly resources: RenderingResources;
  readonly readOnlyReason: string | null;
  readonly originalSchemaVersion: number;
  readonly fontFaces: readonly FontFaceDto[];
  readonly assets = new Map<string, AssetDto>();
  canvas: EditorCanvas | null = null;
  versionStatus: TemplateVersionDetailDto['status'];
  private ui: EditorUiState = {
    leftPanel: 'layers',
    mode: 'edit',
    assetPicker: null,
    editingTextId: null,
    notice: null,
    shortcutsOpen: false,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    pointer: null,
  };
  private readonly uiListeners = new Set<Listener>();
  private readonly resourceListeners = new Set<Listener>();
  private resourceVersion = 0;
  private resourceUnsubscribers: (() => void)[] = [];

  constructor(init: EditorSessionInit) {
    this.template = init.template;
    this.versionId = init.version.id;
    this.versionStatus = init.version.status;
    this.readOnlyReason = init.readOnlyReason;
    this.originalSchemaVersion = init.originalSchemaVersion;
    this.fontFaces = init.fonts;
    this.store = new EditorStore({ document: init.document, readOnly: init.readOnly });
    this.resources = createRenderingResources(init.fonts, (assetId) => {
      const asset = this.assets.get(assetId);
      return asset?.widthPx && asset.heightPx
        ? { width: asset.widthPx, height: asset.heightPx }
        : null;
    });
    this.save = new SaveController(
      this.store,
      createVersionSaveAdapter(init.version.id, init.onSaved),
      {
        revision: init.version.revision,
        savedDocument: init.document,
        savedHash: init.version.documentHash,
        autosaveDelayMs: 4_000,
      },
    );
  }

  /** Starts autosave and resource tracking (paired with stop(); safe to call again). */
  start(): void {
    this.save.start();
    if (this.resourceUnsubscribers.length === 0) {
      this.resourceUnsubscribers = [
        this.resources.fonts.subscribe(() => this.bumpResources()),
        this.resources.images.subscribe(() => this.bumpResources()),
      ];
    }
  }

  stop(): void {
    this.save.dispose();
    for (const unsubscribe of this.resourceUnsubscribers) unsubscribe();
    this.resourceUnsubscribers = [];
  }

  attachCanvas(canvas: EditorCanvas): void {
    this.canvas = canvas;
  }

  detachCanvas(canvas: EditorCanvas): void {
    if (this.canvas === canvas) this.canvas = null;
  }

  setVersionStatus(status: TemplateVersionDetailDto['status']): void {
    this.versionStatus = status;
    this.bumpResources();
  }

  /** Registers asset metadata (pixel sizes, file names) for rendering and properties. */
  registerAssets(assets: readonly (AssetDto | null)[]): void {
    let added = false;
    for (const asset of assets) {
      if (asset && !this.assets.has(asset.id)) {
        this.assets.set(asset.id, asset);
        added = true;
      }
    }
    if (added) this.bumpResources();
  }

  private bumpResources(): void {
    this.resourceVersion += 1;
    this.canvas?.invalidate();
    for (const listener of [...this.resourceListeners]) listener();
  }

  getResourceVersion = (): number => this.resourceVersion;

  subscribeResources = (listener: Listener): (() => void) => {
    this.resourceListeners.add(listener);
    return () => this.resourceListeners.delete(listener);
  };

  getUi = (): EditorUiState => this.ui;

  subscribeUi = (listener: Listener): (() => void) => {
    this.uiListeners.add(listener);
    return () => this.uiListeners.delete(listener);
  };

  setUi(patch: Partial<EditorUiState>): void {
    this.ui = { ...this.ui, ...patch };
    for (const listener of [...this.uiListeners]) listener();
  }

  notify(tone: 'info' | 'warning' | 'danger', message: string): void {
    this.setUi({ notice: { tone, message } });
  }

  /** Runs an editor command; command errors become a visible notice instead of an exception. */
  apply(
    label: string,
    mutate: (document: DesignDocument, pageId: string) => EditorMutation,
    options: { coalesceKey?: string } = {},
  ): boolean {
    try {
      return this.store.apply(label, mutate, options);
    } catch (error) {
      if (error instanceof EditorCommandError) {
        this.notify('danger', error.message);
        return false;
      }
      throw error;
    }
  }

  activePage() {
    const state = this.store.getState();
    return findPage(state.document, state.activePageId);
  }
}

const EditorSessionContext = createContext<EditorSession | null>(null);

export function EditorSessionProvider({
  session,
  children,
}: {
  session: EditorSession;
  children: ReactNode;
}) {
  return <EditorSessionContext.Provider value={session}>{children}</EditorSessionContext.Provider>;
}

export function useEditorSession(): EditorSession {
  const session = useContext(EditorSessionContext);
  if (!session) throw new Error('useEditorSession must be used inside <EditorSessionProvider>');
  return session;
}

/** Subscribe to a slice of editor state. The selector must return stable references. */
export function useEditorState<T>(selector: (state: EditorState) => T): T {
  const session = useEditorSession();
  return useSyncExternalStore(
    session.store.subscribe,
    () => selector(session.store.getState()),
    () => selector(session.store.getState()),
  );
}

export function useSaveState(): SaveState {
  const session = useEditorSession();
  return useSyncExternalStore(session.save.subscribe, session.save.getState, session.save.getState);
}

/** Changes when fonts, images or asset metadata finish loading. */
export function useResourceVersion(): number {
  const session = useEditorSession();
  return useSyncExternalStore(
    session.subscribeResources,
    session.getResourceVersion,
    session.getResourceVersion,
  );
}

export function useEditorUi<T>(selector: (ui: EditorUiState) => T): T {
  const session = useEditorSession();
  return useSyncExternalStore(
    session.subscribeUi,
    () => selector(session.getUi()),
    () => selector(session.getUi()),
  );
}
