import {
  validateDesignDocument,
  type DesignDocument,
  type DocumentValidationIssue,
} from '@smarttag/document-schema';
import { computeDocumentHash } from '@smarttag/document-utils';
import type { EditorStore } from './editor-store';

/** Timers exist in every JavaScript runtime this package targets (browsers, Node, workers). */
interface TimerHost {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
const timerHost = globalThis as unknown as TimerHost;

export type SaveStatus =
  'SAVED' | 'UNSAVED' | 'SAVING' | 'FAILED' | 'CONFLICT' | 'INVALID' | 'READ_ONLY';

export interface SaveState {
  readonly status: SaveStatus;
  /** Server revision the next save must name as `expectedRevision`. */
  readonly revision: number;
  readonly lastSavedHash: string;
  readonly lastSavedAt: number | null;
  readonly errorMessage: string | null;
  readonly issues: readonly DocumentValidationIssue[];
}

export interface SaveResponse {
  readonly revision: number;
  readonly documentHash: string;
}

/** Thrown by adapters when the server reports that another session changed the draft. */
export class SaveConflictError extends Error {
  constructor(message = 'This draft was changed in another session.') {
    super(message);
    this.name = 'SaveConflictError';
  }
}

/** Thrown by adapters when the version can no longer be edited (submitted, approved, retired). */
export class SaveForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveForbiddenError';
  }
}

export interface SaveAdapter {
  save(document: DesignDocument, expectedRevision: number): Promise<SaveResponse>;
}

export interface SaveControllerOptions {
  readonly revision: number;
  readonly savedDocument: DesignDocument;
  readonly savedHash: string;
  /** Debounce after the last change; null disables autosave. */
  readonly autosaveDelayMs?: number | null;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/**
 * Coordinates saving of the canonical document (see docs/editor.md#saving):
 *
 *   store.document → validateDesignDocument → canonical hash → PATCH (expectedRevision)
 *
 * - never overlaps requests: a change during a save schedules exactly one follow-up save
 * - a no-op (same hash as last saved) completes without a request
 * - a revision conflict stops autosave; the newer server version is never overwritten
 * - failures keep the document dirty and are reported; nothing pretends to be saved
 * - autosave waits for gestures to finish and for a quiet period after the last change
 */
export class SaveController {
  private state: SaveState;
  private savedDocument: DesignDocument;
  private readonly store: EditorStore;
  private readonly adapter: SaveAdapter;
  private readonly listeners = new Set<() => void>();
  private readonly autosaveDelayMs: number | null;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private timer: unknown = null;
  private inFlight: Promise<void> | null = null;
  private saveAgain = false;
  private unsubscribe: (() => void) | null = null;

  constructor(store: EditorStore, adapter: SaveAdapter, options: SaveControllerOptions) {
    this.store = store;
    this.adapter = adapter;
    this.savedDocument = options.savedDocument;
    this.autosaveDelayMs = options.autosaveDelayMs ?? null;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, ms) => timerHost.setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => timerHost.clearTimeout(handle));
    this.state = {
      status: store.getState().readOnly ? 'READ_ONLY' : 'SAVED',
      revision: options.revision,
      lastSavedHash: options.savedHash,
      lastSavedAt: null,
      errorMessage: null,
      issues: [],
    };
  }

  start(): void {
    this.unsubscribe ??= this.store.subscribe(() => this.onStoreChange());
    this.onStoreChange();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.cancelTimer();
  }

  getState = (): SaveState => this.state;

  private currentStatus(): SaveStatus {
    return this.state.status;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** True when the editor holds changes that are not confirmed saved by the server. */
  isDirty(): boolean {
    return this.store.getState().document !== this.savedDocument;
  }

  private set(patch: Partial<SaveState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  private onStoreChange(): void {
    const { readOnly, interacting } = this.store.getState();
    if (readOnly) {
      this.cancelTimer();
      if (this.state.status !== 'READ_ONLY') this.set({ status: 'READ_ONLY' });
      return;
    }
    if (this.state.status === 'CONFLICT' || this.state.status === 'SAVING') {
      return;
    }
    if (!this.isDirty()) {
      if (this.state.status !== 'SAVED')
        this.set({ status: 'SAVED', errorMessage: null, issues: [] });
      this.cancelTimer();
      return;
    }
    if (this.state.status === 'SAVED' || this.state.status === 'READ_ONLY') {
      this.set({ status: 'UNSAVED' });
    }
    if (this.autosaveDelayMs !== null && !interacting) {
      this.scheduleAutosave();
    }
  }

  private scheduleAutosave(): void {
    this.cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (this.store.getState().interacting) {
        this.scheduleAutosave();
        return;
      }
      void this.save('AUTOSAVE');
    }, this.autosaveDelayMs!);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  /** Explicit save. Resolves when the document (as of now or later) has been handled. */
  saveNow(): Promise<void> {
    return this.save('EXPLICIT');
  }

  private async save(trigger: 'EXPLICIT' | 'AUTOSAVE'): Promise<void> {
    this.cancelTimer();
    if (this.state.status === 'CONFLICT' || this.state.status === 'READ_ONLY') return;
    if (trigger === 'AUTOSAVE' && this.state.status === 'FAILED') return;
    if (this.inFlight) {
      this.saveAgain = true;
      return this.inFlight;
    }
    this.inFlight = this.performSave().finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;
    if (this.saveAgain) {
      this.saveAgain = false;
      // Status may have changed while the request was in flight.
      const status = this.currentStatus();
      if (this.isDirty() && status !== 'CONFLICT' && status !== 'FAILED') {
        await this.save(trigger);
      }
    }
  }

  private async performSave(): Promise<void> {
    const document = this.store.getState().document;
    if (document === this.savedDocument) {
      this.set({ status: 'SAVED', errorMessage: null, issues: [] });
      return;
    }
    const validation = validateDesignDocument(document);
    if (!validation.valid) {
      this.set({
        status: 'INVALID',
        errorMessage: 'The design has errors that must be fixed before it can be saved.',
        issues: validation.errors,
      });
      return;
    }
    const hash = await computeDocumentHash(document);
    if (hash === this.state.lastSavedHash) {
      this.savedDocument = document;
      this.set({ status: this.isDirty() ? 'UNSAVED' : 'SAVED', errorMessage: null, issues: [] });
      return;
    }

    this.set({ status: 'SAVING', errorMessage: null, issues: [] });
    try {
      const response = await this.adapter.save(document, this.state.revision);
      if (response.documentHash !== hash) {
        // The server stored something other than what we hashed — never report this as saved.
        this.set({
          status: 'FAILED',
          revision: response.revision,
          errorMessage: 'The saved document does not match the editor state. Reload the draft.',
        });
        return;
      }
      this.savedDocument = document;
      this.set({
        status: this.isDirty() ? 'UNSAVED' : 'SAVED',
        revision: response.revision,
        lastSavedHash: hash,
        lastSavedAt: this.now(),
      });
      if (this.isDirty() && this.autosaveDelayMs !== null) {
        this.saveAgain = true;
      }
    } catch (error) {
      if (error instanceof SaveConflictError) {
        this.set({
          status: 'CONFLICT',
          errorMessage:
            'This draft was changed in another session. Reload the latest version before saving your changes.',
        });
      } else if (error instanceof SaveForbiddenError) {
        this.set({ status: 'FAILED', errorMessage: error.message });
        this.store.setReadOnly(true);
      } else {
        this.set({
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Saving failed. Try again.',
        });
      }
    }
  }

  /** After reloading the latest server version (conflict resolution). */
  reset(document: DesignDocument, revision: number, hash: string): void {
    this.cancelTimer();
    this.saveAgain = false;
    this.savedDocument = document;
    this.set({
      status: this.store.getState().readOnly ? 'READ_ONLY' : 'SAVED',
      revision,
      lastSavedHash: hash,
      errorMessage: null,
      issues: [],
    });
  }
}
