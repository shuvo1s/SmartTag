'use client';

import {
  addObjects,
  createToolObject,
  deleteObjects,
  duplicateObjects,
  duplicateOffsetPt,
  findPage,
  isEffectivelyLocked,
  moveObjects,
  nudgeDistancePt,
  pasteObjects,
  type FontChoice,
  type ToolType,
} from '@smarttag/editor-core';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { EditorSession } from './editor-session';

export const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: 'Ctrl/⌘ Z', action: 'Undo' },
  { keys: 'Ctrl/⌘ Shift Z · Ctrl Y', action: 'Redo' },
  { keys: 'Ctrl/⌘ C / V', action: 'Copy / paste objects' },
  { keys: 'Ctrl/⌘ D', action: 'Duplicate' },
  { keys: 'Ctrl/⌘ S', action: 'Save' },
  { keys: 'Ctrl/⌘ A', action: 'Select all on this page' },
  { keys: 'Delete · Backspace', action: 'Delete (not locked objects)' },
  { keys: 'Arrow keys', action: 'Nudge 0.25 mm (0.01 in)' },
  { keys: 'Shift + arrows', action: 'Nudge 1 mm (0.1 in)' },
  { keys: 'Alt + ↑ / ↓ (Layers)', action: 'Previous / next layer (Shift adds to selection)' },
  { keys: 'Esc', action: 'Deselect / leave text editing' },
  { keys: 'Ctrl/⌘ + / −', action: 'Zoom in / out' },
  { keys: 'Ctrl/⌘ 0 · Ctrl/⌘ 1', action: 'Fit page · 100 %' },
  { keys: 'Space + drag · wheel', action: 'Pan' },
  { keys: 'Ctrl/⌘ + wheel', action: 'Zoom at pointer' },
  { keys: 'Alt while dragging', action: 'Temporarily disable snapping' },
  { keys: 'Enter · double-click text', action: 'Edit text on the canvas' },
  { keys: 'T · R · E · L · B · Q', action: 'Add text, rectangle, ellipse, line, barcode, QR code' },
  { keys: '?', action: 'Show shortcuts' },
];

const TOOL_KEYS: Readonly<Record<string, ToolType>> = {
  t: 'text',
  r: 'rectangle',
  e: 'ellipse',
  l: 'line',
  b: 'barcode',
  q: 'qrCode',
};

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.closest('dialog[open]') !== null
  );
}

/** The registered font new text uses (Noto Sans Regular when available); starts loading it. */
export function defaultFontChoice(session: EditorSession): FontChoice | null {
  const face =
    session.fontFaces.find(
      (candidate) =>
        candidate.familyName === 'Noto Sans' &&
        candidate.weight === 400 &&
        candidate.style === 'NORMAL',
    ) ??
    session.fontFaces[0] ??
    null;
  if (!face) return null;
  void session.resources.fonts.load(face.assetId);
  return {
    assetId: face.assetId,
    familyName: face.familyName,
    weight: face.weight,
    style: face.style,
  };
}

export function addTool(session: EditorSession, tool: ToolType): void {
  if (tool === 'image' || tool === 'logo') {
    session.setUi({ assetPicker: { purpose: tool } });
    return;
  }
  const document = session.store.getState().document;
  const object = createToolObject(tool, document, { font: defaultFontChoice(session) });
  session.apply(`Add ${tool === 'qrCode' ? 'QR code' : tool}`, (doc, pageId) => ({
    document: addObjects(doc, pageId, [object]),
    selection: [object.id],
  }));
}

/**
 * Keyboard handling attached to the editor root, so shortcuts only apply while focus is inside the
 * editor and never while typing in a field.
 */
export function handleEditorKeyDown(
  session: EditorSession,
  event: ReactKeyboardEvent<HTMLElement>,
): void {
  const { store } = session;
  const state = store.getState();
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  // Save works everywhere in the editor, even from a field.
  if (mod && key === 's') {
    event.preventDefault();
    void session.save.saveNow();
    return;
  }
  if (isEditableTarget(event.target)) return;

  const canvas = session.canvas;
  if (mod && key === 'z') {
    event.preventDefault();
    if (event.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if (mod && key === 'y') {
    event.preventDefault();
    store.redo();
    return;
  }
  if (mod && (key === '=' || key === '+')) {
    event.preventDefault();
    canvas?.zoomStep(1);
    return;
  }
  if (mod && key === '-') {
    event.preventDefault();
    canvas?.zoomStep(-1);
    return;
  }
  if (mod && key === '0') {
    event.preventDefault();
    canvas?.fit('FIT_PAGE');
    return;
  }
  if (mod && key === '1') {
    event.preventDefault();
    canvas?.zoomTo(1);
    return;
  }
  if (key === '?') {
    session.setUi({ shortcutsOpen: true });
    return;
  }
  if (key === ' ' && !event.repeat) {
    event.preventDefault();
    canvas?.setPanMode(true);
    return;
  }
  if (key === 'escape') {
    store.setSelection([]);
    return;
  }

  const page = findPage(state.document, state.activePageId);
  const unit = state.document.dimensions.displayUnit;

  if (mod && key === 'a') {
    event.preventDefault();
    store.setSelection(page.objects.filter((object) => object.visible).map((object) => object.id));
    return;
  }
  if (mod && key === 'c') {
    if (state.selection.length > 0) {
      event.preventDefault();
      const count = store.copySelection();
      session.notify('info', `${count} object${count === 1 ? '' : 's'} copied`);
    }
    return;
  }
  if (state.readOnly) return;

  if (mod && key === 'v') {
    const clipboard = store.getClipboard();
    if (clipboard.length > 0) {
      event.preventDefault();
      session.apply('Paste', (doc, pageId) => {
        const sourceOnPage = findPage(doc, pageId).objects.some((object) =>
          clipboard.some((item) => item.id === object.id),
        );
        const result = pasteObjects(
          doc,
          pageId,
          clipboard,
          sourceOnPage ? duplicateOffsetPt(unit) : 0,
        );
        return { document: result.document, selection: result.insertedIds };
      });
    }
    return;
  }
  if (mod && key === 'd') {
    event.preventDefault();
    if (state.selection.length > 0) {
      session.apply('Duplicate', (doc, pageId) => {
        const result = duplicateObjects(doc, pageId, state.selection, duplicateOffsetPt(unit));
        return { document: result.document, selection: result.insertedIds };
      });
    }
    return;
  }
  if ((key === 'delete' || key === 'backspace') && state.selection.length > 0) {
    event.preventDefault();
    let skipped = 0;
    session.apply('Delete', (doc, pageId) => {
      const result = deleteObjects(doc, pageId, state.selection);
      skipped = result.skippedLockedIds.length;
      return { document: result.document, selection: result.skippedLockedIds };
    });
    if (skipped > 0)
      session.notify(
        'warning',
        `${skipped} locked object${skipped === 1 ? ' was' : 's were'} not deleted. Unlock first.`,
      );
    return;
  }
  if (key.startsWith('arrow') && !event.altKey && state.selection.length > 0) {
    event.preventDefault();
    const movable = state.selection.filter((id) => {
      const object = page.objects.find((candidate) => candidate.id === id);
      return object && !isEffectivelyLocked(page, object);
    });
    if (movable.length === 0) return;
    const distance = nudgeDistancePt(unit, event.shiftKey);
    const dx = key === 'arrowleft' ? -distance : key === 'arrowright' ? distance : 0;
    const dy = key === 'arrowup' ? -distance : key === 'arrowdown' ? distance : 0;
    session.apply('Nudge', (doc, pageId) => moveObjects(doc, pageId, movable, dx, dy), {
      coalesceKey: `nudge:${movable.join(',')}`,
    });
    return;
  }
  if (key === 'enter' && state.selection.length === 1) {
    const object = page.objects.find((candidate) => candidate.id === state.selection[0]);
    if (object?.type === 'text' && !isEffectivelyLocked(page, object)) {
      event.preventDefault();
      session.setUi({ editingTextId: object.id });
    }
    return;
  }
  if (!mod && !event.altKey && TOOL_KEYS[key]) {
    event.preventDefault();
    addTool(session, TOOL_KEYS[key]);
  }
}

export function handleEditorKeyUp(
  session: EditorSession,
  event: ReactKeyboardEvent<HTMLElement>,
): void {
  if (event.key === ' ') {
    session.canvas?.setPanMode(false);
  }
}
