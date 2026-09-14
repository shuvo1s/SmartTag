import type { DesignDocument } from '@smarttag/document-schema';

/** Everything needed to restore the editor after undo/redo. */
export interface EditorSnapshot {
  readonly document: DesignDocument;
  readonly pageId: string;
  readonly selection: readonly string[];
}

export interface HistoryEntry {
  readonly label: string;
  readonly before: EditorSnapshot;
  readonly after: EditorSnapshot;
  /** Consecutive entries with the same key within the coalescing window merge into one step. */
  readonly coalesceKey: string | null;
  readonly timestamp: number;
}

export interface HistoryOptions {
  readonly limit?: number;
  readonly coalesceWindowMs?: number;
  readonly now?: () => number;
}

/**
 * Transactional undo/redo. One logical operation (a drag, an alignment, a colour change) is one
 * entry: the canvas commits a transform only when the gesture ends, and rapid edits of the same
 * property (typing, nudging) coalesce. Snapshots share structure with each other, so an entry
 * costs a few object references, not a copy of the document.
 */
export class EditorHistory {
  private readonly past: HistoryEntry[] = [];
  private readonly future: HistoryEntry[] = [];
  private readonly limit: number;
  private readonly coalesceWindowMs: number;
  private readonly now: () => number;

  constructor(options: HistoryOptions = {}) {
    this.limit = options.limit ?? 200;
    this.coalesceWindowMs = options.coalesceWindowMs ?? 1_000;
    this.now = options.now ?? Date.now;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.past[this.past.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future[this.future.length - 1]?.label ?? null;
  }

  get size(): number {
    return this.past.length;
  }

  record(
    label: string,
    before: EditorSnapshot,
    after: EditorSnapshot,
    coalesceKey: string | null = null,
  ): void {
    const timestamp = this.now();
    const last = this.past[this.past.length - 1];
    this.future.length = 0;
    if (
      coalesceKey !== null &&
      last?.coalesceKey === coalesceKey &&
      timestamp - last.timestamp <= this.coalesceWindowMs
    ) {
      this.past[this.past.length - 1] = { ...last, after, timestamp };
      return;
    }
    this.past.push({ label, before, after, coalesceKey, timestamp });
    if (this.past.length > this.limit) {
      this.past.shift();
    }
  }

  /** Ends coalescing so the next edit starts a new step (e.g. after a text field loses focus). */
  seal(): void {
    const last = this.past[this.past.length - 1];
    if (last?.coalesceKey) {
      this.past[this.past.length - 1] = { ...last, coalesceKey: null };
    }
  }

  undo(): EditorSnapshot | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push({ ...entry, coalesceKey: null });
    return entry.before;
  }

  redo(): EditorSnapshot | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push(entry);
    return entry.after;
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}
