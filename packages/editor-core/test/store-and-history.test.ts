import { createSampleHangTagDocument } from '@smarttag/document-utils/fixtures';
import { describe, expect, it } from 'vitest';
import {
  EditorHistory,
  EditorStore,
  duplicateObjects,
  findPage,
  moveObjects,
  updateObject,
} from '../src';

function store(now = { value: 0 }) {
  return new EditorStore({
    document: createSampleHangTagDocument(),
    history: { now: () => now.value, coalesceWindowMs: 1000 },
  });
}

describe('EditorStore', () => {
  it('records one undo step per command and restores document, page and selection', () => {
    const editor = store();
    editor.setSelection(['front-price']);
    const original = editor.getState().document;
    editor.apply('Move', (doc, page) => moveObjects(doc, page, ['front-price'], 5, 0));
    editor.apply('Move', (doc, page) => moveObjects(doc, page, ['front-price'], 5, 0));
    expect(editor.getState()).toMatchObject({ canUndo: true, undoLabel: 'Move', changeCount: 2 });

    editor.setActivePage('page-back');
    expect(editor.undo()).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.getState().document).toBe(original);
    expect(editor.getState().activePageId).toBe('page-front');
    expect(editor.getState().selection).toEqual(['front-price']);
    expect(editor.getState().canUndo).toBe(false);

    expect(editor.redo()).toBe(true);
    expect(findPage(editor.getState().document, 'page-front').objects).not.toBe(
      findPage(original, 'page-front').objects,
    );
  });

  it('coalesces rapid edits of the same property into a single step', () => {
    const now = { value: 0 };
    const editor = store(now);
    for (const content of ['O', 'Or', 'Org', 'Orga']) {
      now.value += 200;
      editor.apply(
        'Edit text',
        (doc, page) => updateObject(doc, page, 'front-product-name', { content }),
        { coalesceKey: 'text:front-product-name:content' },
      );
    }
    editor.undo();
    expect(editor.getState().canUndo).toBe(false);
    const text = findPage(editor.getState().document, 'page-front').objects.find(
      (o) => o.id === 'front-product-name',
    );
    expect(text?.type === 'text' && text.content).toBe('Organic Cotton Tee');
  });

  it('starts a new step after the coalescing window or a seal', () => {
    const now = { value: 0 };
    const editor = store(now);
    const edit = (content: string) =>
      editor.apply('Edit', (doc, page) => updateObject(doc, page, 'front-size', { content }), {
        coalesceKey: 'size',
      });
    edit('S');
    now.value = 5000;
    edit('M');
    editor.sealHistory();
    edit('L');
    editor.undo();
    editor.undo();
    expect(editor.getState().canUndo).toBe(true);
  });

  it('does nothing in read-only mode and never records no-op commands', () => {
    const readOnly = new EditorStore({ document: createSampleHangTagDocument(), readOnly: true });
    expect(
      readOnly.apply('Move', (doc, page) => moveObjects(doc, page, ['front-price'], 5, 0)),
    ).toBe(false);
    expect(readOnly.getState().changeCount).toBe(0);

    const editor = store();
    expect(editor.apply('Nothing', (doc) => doc)).toBe(false);
    expect(editor.getState().canUndo).toBe(false);
  });

  it('selects inserted objects and drops selections that no longer exist', () => {
    const editor = store();
    editor.setSelection(['front-price', 'does-not-exist']);
    expect(editor.getState().selection).toEqual(['front-price']);
    editor.apply('Duplicate', (doc, page) => {
      const result = duplicateObjects(doc, page, ['front-price'], 5);
      return { document: result.document, selection: result.insertedIds };
    });
    const [copy] = editor.getState().selection;
    expect(copy).not.toBe('front-price');
    editor.undo();
    expect(editor.getState().selection).toEqual(['front-price']);
  });

  it('keeps a deep-copied clipboard and notifies subscribers', () => {
    const editor = store();
    let notifications = 0;
    const unsubscribe = editor.subscribe(() => (notifications += 1));
    editor.setSelection(['front-logo']);
    expect(editor.copySelection()).toBe(1);
    expect(editor.getState().clipboardSize).toBe(1);
    const copied = editor.getClipboard()[0]!;
    const live = findPage(editor.getState().document, 'page-front').objects.find(
      (o) => o.id === 'front-logo',
    );
    expect(copied).toEqual(live);
    expect(copied).not.toBe(live);
    unsubscribe();
    expect(notifications).toBe(2);
  });
});

describe('EditorHistory', () => {
  it('limits its size', () => {
    const history = new EditorHistory({ limit: 3 });
    const document = createSampleHangTagDocument();
    const snapshot = { document, pageId: 'page-front', selection: [] };
    for (let i = 0; i < 5; i += 1) history.record(`step ${i}`, snapshot, snapshot);
    expect(history.size).toBe(3);
    expect(history.undoLabel).toBe('step 4');
  });
});
