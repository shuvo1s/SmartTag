import type { DesignDocument } from '@smarttag/document-schema';
import { computeDocumentHash } from '@smarttag/document-utils';
import { createSampleHangTagDocument } from '@smarttag/document-utils/fixtures';
import { describe, expect, it, vi } from 'vitest';
import {
  EditorStore,
  SaveConflictError,
  SaveController,
  SaveForbiddenError,
  moveObjects,
  updateObject,
  type SaveResponse,
} from '../src';

interface PendingSave {
  readonly document: DesignDocument;
  readonly expectedRevision: number;
  resolve(response: SaveResponse): void;
  reject(error: unknown): void;
}

function controllableAdapter() {
  const calls: PendingSave[] = [];
  return {
    calls,
    adapter: {
      save: (document: DesignDocument, expectedRevision: number) =>
        new Promise<SaveResponse>((resolve, reject) => {
          calls.push({ document, expectedRevision, resolve, reject });
        }),
    },
  };
}

async function setup(options: { autosaveDelayMs?: number | null } = {}) {
  const document = createSampleHangTagDocument();
  const store = new EditorStore({ document });
  const { adapter, calls } = controllableAdapter();
  const timers: (() => void)[] = [];
  const controller = new SaveController(store, adapter, {
    revision: 1,
    savedDocument: document,
    savedHash: await computeDocumentHash(document),
    autosaveDelayMs: options.autosaveDelayMs ?? null,
    setTimer: (callback) => timers.push(callback),
    clearTimer: () => timers.splice(0),
  });
  controller.start();
  const move = () =>
    store.apply('Move', (doc, page) => moveObjects(doc, page, ['front-price'], 2, 0));
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { store, controller, calls, timers, move, flush };
}

describe('SaveController', () => {
  it('saves the validated canonical document with expectedRevision and tracks the new revision', async () => {
    const { controller, calls, move } = await setup();
    move();
    expect(controller.getState().status).toBe('UNSAVED');
    const saving = controller.saveNow();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(controller.getState().status).toBe('SAVING');
    expect(calls[0]!.expectedRevision).toBe(1);
    calls[0]!.resolve({ revision: 2, documentHash: await computeDocumentHash(calls[0]!.document) });
    await saving;
    expect(controller.getState()).toMatchObject({ status: 'SAVED', revision: 2 });
    expect(controller.isDirty()).toBe(false);
  });

  it('never overlaps requests and saves changes made during a save exactly once more', async () => {
    const { controller, calls, move, flush } = await setup();
    move();
    const first = controller.saveNow();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    move();
    const second = controller.saveNow();
    const third = controller.saveNow();
    await flush();
    expect(calls).toHaveLength(1);
    calls[0]!.resolve({ revision: 2, documentHash: await computeDocumentHash(calls[0]!.document) });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.expectedRevision).toBe(2);
    calls[1]!.resolve({ revision: 3, documentHash: await computeDocumentHash(calls[1]!.document) });
    await Promise.all([first, second, third]);
    expect(controller.getState()).toMatchObject({ status: 'SAVED', revision: 3 });
  });

  it('does not send a request when the content hash equals the last saved hash', async () => {
    const { controller, store, calls } = await setup();
    store.apply('Edit', (doc, page) => updateObject(doc, page, 'front-size', { content: 'XL' }));
    store.apply('Edit back', (doc, page) =>
      updateObject(doc, page, 'front-size', { content: 'M' }),
    );
    expect(controller.isDirty()).toBe(true); // different object identity…
    await controller.saveNow();
    expect(calls).toHaveLength(0); // …but identical canonical content
    expect(controller.getState().status).toBe('SAVED');
  });

  it('stops on a revision conflict without overwriting and keeps the changes', async () => {
    const { controller, calls, move } = await setup({ autosaveDelayMs: 100 });
    move();
    const saving = controller.saveNow();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0]!.reject(new SaveConflictError());
    await saving;
    expect(controller.getState().status).toBe('CONFLICT');
    expect(controller.getState().errorMessage).toMatch(/changed in another session/);
    expect(controller.isDirty()).toBe(true);
    move();
    await controller.saveNow();
    expect(calls).toHaveLength(1);
  });

  it('reports failures honestly and keeps the document dirty', async () => {
    const { controller, calls, move } = await setup();
    move();
    const saving = controller.saveNow();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0]!.reject(new Error('Network unreachable'));
    await saving;
    expect(controller.getState()).toMatchObject({
      status: 'FAILED',
      errorMessage: 'Network unreachable',
    });
    expect(controller.isDirty()).toBe(true);
  });

  it('refuses to report success when the server hash differs from the editor hash', async () => {
    const { controller, calls, move } = await setup();
    move();
    const saving = controller.saveNow();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0]!.resolve({ revision: 2, documentHash: 'f'.repeat(64) });
    await saving;
    expect(controller.getState().status).toBe('FAILED');
    expect(controller.isDirty()).toBe(true);
  });

  it('becomes read-only when the server refuses edits', async () => {
    const { controller, store, calls, move } = await setup();
    move();
    const saving = controller.saveNow();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0]!.reject(new SaveForbiddenError('This version is APPROVED and cannot be modified.'));
    await saving;
    expect(store.getState().readOnly).toBe(true);
    expect(controller.getState().status).toBe('READ_ONLY');
  });

  it('does not save an invalid document', async () => {
    const { controller, store, calls } = await setup();
    // bypass command validation to simulate a document the validator rejects
    const document = store.getState().document;
    const [front, ...rest] = document.pages;
    store.replaceDocument({
      ...document,
      pages: [{ ...front!, objects: [...front!.objects, front!.objects[0]!] }, ...rest],
    });
    await controller.saveNow();
    expect(calls).toHaveLength(0);
    expect(controller.getState().status).toBe('INVALID');
  });

  it('autosaves after a quiet period but never during a gesture', async () => {
    const { controller, store, calls, timers } = await setup({ autosaveDelayMs: 2000 });
    store.setInteracting(true);
    store.apply('Edit', (doc, page) => updateObject(doc, page, 'front-size', { content: 'L' }));
    expect(timers).toHaveLength(0);
    store.setInteracting(false);
    expect(timers).toHaveLength(1);
    timers.shift()!();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0]!.resolve({ revision: 2, documentHash: await computeDocumentHash(calls[0]!.document) });
    await vi.waitFor(() => expect(controller.getState().status).toBe('SAVED'));
  });
});
