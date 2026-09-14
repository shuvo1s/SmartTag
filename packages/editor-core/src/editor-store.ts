import type { ArtworkObject, DesignDocument } from '@smarttag/document-schema';
import { EditorCommandError, findPage } from './document-access';
import { EditorHistory, type EditorSnapshot, type HistoryOptions } from './history';

/**
 * Editor state is split deliberately (see docs/editor.md):
 * - `document`: the canonical DesignDocument — the only thing that is ever saved
 * - UI state (`activePageId`, `selection`, `interacting`, clipboard): never persisted
 * Zoom, pan, open panels, hover and snap guides live in the canvas adapter or React components.
 */
export interface EditorState {
  readonly document: DesignDocument;
  readonly activePageId: string;
  readonly selection: readonly string[];
  readonly readOnly: boolean;
  /** True while a pointer gesture is in progress (autosave waits for it to end). */
  readonly interacting: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly clipboardSize: number;
  /** Increments on every document change (including undo/redo). */
  readonly changeCount: number;
}

export type EditorMutation =
  DesignDocument | { readonly document: DesignDocument; readonly selection?: readonly string[] };

export interface ApplyOptions {
  readonly coalesceKey?: string;
  /** Page the mutation targets; defaults to the active page. */
  readonly pageId?: string;
}

type Listener = () => void;

export class EditorStore {
  private state: EditorState;
  private readonly history: EditorHistory;
  private readonly listeners = new Set<Listener>();
  private clipboard: readonly ArtworkObject[] = [];

  constructor(options: {
    readonly document: DesignDocument;
    readonly pageId?: string;
    readonly readOnly?: boolean;
    readonly history?: HistoryOptions;
  }) {
    const pageId = options.pageId ?? options.document.pages[0]?.id;
    if (!pageId) {
      throw new EditorCommandError('A document needs at least one page');
    }
    findPage(options.document, pageId);
    this.history = new EditorHistory(options.history);
    this.state = {
      document: options.document,
      activePageId: pageId,
      selection: [],
      readOnly: options.readOnly ?? false,
      interacting: false,
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
      clipboardSize: 0,
      changeCount: 0,
    };
  }

  getState = (): EditorState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<EditorState>): void {
    this.state = {
      ...this.state,
      ...patch,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      undoLabel: this.history.undoLabel,
      redoLabel: this.history.redoLabel,
      clipboardSize: this.clipboard.length,
    };
    for (const listener of [...this.listeners]) listener();
  }

  private snapshot(): EditorSnapshot {
    return {
      document: this.state.document,
      pageId: this.state.activePageId,
      selection: this.state.selection,
    };
  }

  /**
   * Runs a command against the canonical document and records ONE undo step. Returns false when
   * the editor is read-only or the command changed nothing. Command errors propagate.
   */
  apply(
    label: string,
    mutate: (document: DesignDocument, pageId: string) => EditorMutation,
    options: ApplyOptions = {},
  ): boolean {
    if (this.state.readOnly) return false;
    const pageId = options.pageId ?? this.state.activePageId;
    const before = this.snapshot();
    const result = mutate(this.state.document, pageId);
    const document = 'pages' in result ? result : result.document;
    const requestedSelection = 'pages' in result ? undefined : result.selection;
    if (document === this.state.document && requestedSelection === undefined) {
      return false;
    }
    const selection = this.validSelection(
      document,
      pageId,
      requestedSelection ?? (pageId === before.pageId ? before.selection : []),
    );
    const after: EditorSnapshot = { document, pageId, selection };
    if (document !== this.state.document) {
      this.history.record(label, before, after, options.coalesceKey ?? null);
    }
    this.set({
      document,
      activePageId: pageId,
      selection,
      changeCount:
        document !== this.state.document ? this.state.changeCount + 1 : this.state.changeCount,
    });
    return document !== before.document;
  }

  setSelection(ids: readonly string[]): void {
    const selection = this.validSelection(this.state.document, this.state.activePageId, ids);
    if (
      selection.length === this.state.selection.length &&
      selection.every((id, index) => id === this.state.selection[index])
    ) {
      return;
    }
    this.history.seal();
    this.set({ selection });
  }

  setActivePage(pageId: string): void {
    if (pageId === this.state.activePageId) return;
    findPage(this.state.document, pageId);
    this.history.seal();
    this.set({ activePageId: pageId, selection: [] });
  }

  setInteracting(interacting: boolean): void {
    if (interacting !== this.state.interacting) this.set({ interacting });
  }

  setReadOnly(readOnly: boolean): void {
    if (readOnly !== this.state.readOnly) this.set({ readOnly });
  }

  sealHistory(): void {
    this.history.seal();
  }

  undo(): boolean {
    if (this.state.readOnly) return false;
    const snapshot = this.history.undo();
    return snapshot ? this.restore(snapshot) : false;
  }

  redo(): boolean {
    if (this.state.readOnly) return false;
    const snapshot = this.history.redo();
    return snapshot ? this.restore(snapshot) : false;
  }

  private restore(snapshot: EditorSnapshot): boolean {
    this.set({
      document: snapshot.document,
      activePageId: snapshot.pageId,
      selection: this.validSelection(snapshot.document, snapshot.pageId, snapshot.selection),
      changeCount: this.state.changeCount + 1,
    });
    return true;
  }

  /** Copies the selected objects (deep copies; ids are replaced on paste). */
  copySelection(): number {
    const page = findPage(this.state.document, this.state.activePageId);
    const selected = new Set(this.state.selection);
    this.clipboard = page.objects
      .filter((object) => selected.has(object.id))
      .map((object) => JSON.parse(JSON.stringify(object)) as ArtworkObject);
    this.set({});
    return this.clipboard.length;
  }

  getClipboard(): readonly ArtworkObject[] {
    return this.clipboard;
  }

  /** Replaces the document after a reload (e.g. conflict resolution). History is cleared. */
  replaceDocument(document: DesignDocument, options: { readonly readOnly?: boolean } = {}): void {
    const pageId = document.pages.some((page) => page.id === this.state.activePageId)
      ? this.state.activePageId
      : document.pages[0]!.id;
    this.history.clear();
    this.set({
      document,
      activePageId: pageId,
      selection: this.validSelection(document, pageId, this.state.selection),
      readOnly: options.readOnly ?? this.state.readOnly,
      changeCount: this.state.changeCount + 1,
    });
  }

  private validSelection(
    document: DesignDocument,
    pageId: string,
    ids: readonly string[],
  ): readonly string[] {
    const page = document.pages.find((candidate) => candidate.id === pageId);
    if (!page) return [];
    const present = new Set(page.objects.map((object) => object.id));
    return [...new Set(ids)].filter((id) => present.has(id));
  }
}
