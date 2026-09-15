'use client';

import { EditorCanvas } from '@smarttag/canvas-adapter';
import {
  EditorCommandError,
  addObjects,
  createFieldObject,
  updateObject,
  viewportScale,
} from '@smarttag/editor-core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FIELD_DRAG_TYPE } from './data-panel';
import { useEditorSession, useEditorState, useEditorUi } from './editor-session';
import { defaultFontChoice } from './editor-shortcuts';

/**
 * Hosts the Fabric canvas. The EditorCanvas subscribes to the editor store itself; React only
 * handles mounting, resizing and the inline text editor, so pointer interaction never re-renders
 * React components.
 */
export function CanvasView({ hidden = false }: { hidden?: boolean }) {
  const session = useEditorSession();
  const container = useRef<HTMLDivElement>(null);
  const canvasElement = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState({ zoom: 1, panX: 0, panY: 0 });

  useLayoutEffect(() => {
    const host = container.current;
    const element = canvasElement.current;
    if (!host || !element) return;
    performance.mark('st-editor-canvas-mount-start');
    const canvas = new EditorCanvas(element, {
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      services: session.resources.services,
      events: {
        onViewportChange: (next) => {
          setViewport(next);
          session.setUi({ viewport: next });
        },
        onEditTextRequest: (objectId) => {
          const state = session.store.getState();
          const object = state.document.pages
            .find((page) => page.id === state.activePageId)
            ?.objects.find((candidate) => candidate.id === objectId);
          if (
            session.preview.getState().mode === 'DATA' &&
            object?.type === 'text' &&
            object.bindings.content.mode !== 'STATIC'
          ) {
            session.notify(
              'info',
              'This text comes from data. Switch to Template values to edit its sample text.',
            );
            return;
          }
          session.setUi({ editingTextId: objectId });
        },
        onPointerMove: (point) => session.setUi({ pointer: point }),
        onTransformRejected: (message) => session.notify('warning', message),
      },
    });
    session.attachCanvas(canvas);
    const detach = canvas.attach(session.store);
    exposeDiagnostics(session, canvas);
    performance.mark('st-editor-canvas-ready');
    performance.measure(
      'st-editor-canvas-mount',
      'st-editor-canvas-mount-start',
      'st-editor-canvas-ready',
    );

    const observer = new ResizeObserver(() => {
      canvas.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      detach();
      canvas.dispose();
      session.detachCanvas(canvas);
    };
  }, [session]);

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const key = event.dataTransfer.getData(FIELD_DRAG_TYPE);
    const canvas = session.canvas;
    if (!key || !canvas || session.store.getState().readOnly) return;
    event.preventDefault();
    const state = session.store.getState();
    const field = state.document.dataSchema.fields.find((candidate) => candidate.key === key);
    if (!field) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const current = canvas.getViewport();
    const scale = viewportScale(current.zoom);
    const center = {
      x: (event.clientX - bounds.left - current.panX) / scale,
      y: (event.clientY - bounds.top - current.panY) / scale,
    };
    try {
      const object = createFieldObject(field, state.document, {
        center,
        font: defaultFontChoice(session),
      });
      session.apply(`Add ${field.displayName}`, (doc, pageId) => ({
        document: addObjects(doc, pageId, [object]),
        selection: [object.id],
      }));
    } catch (error) {
      if (error instanceof EditorCommandError) session.notify('warning', error.message);
      else throw error;
    }
  };

  return (
    <div
      ref={container}
      data-testid="editor-canvas"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(FIELD_DRAG_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={onDrop}
      data-zoom={viewport.zoom}
      data-pan-x={viewport.panX}
      data-pan-y={viewport.panY}
      className={
        hidden
          ? 'pointer-events-none invisible absolute inset-0'
          : 'relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#DDE3EA]'
      }
    >
      <canvas ref={canvasElement} aria-label="Design canvas" />
      <InlineTextEditor viewport={viewport} />
    </div>
  );
}

function InlineTextEditor({
  viewport,
}: {
  viewport: { zoom: number; panX: number; panY: number };
}) {
  const session = useEditorSession();
  const editingId = useEditorUi((ui) => ui.editingTextId);
  const document = useEditorState((state) => state.document);
  const pageId = useEditorState((state) => state.activePageId);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const object = editingId
    ? document.pages
        .find((page) => page.id === pageId)
        ?.objects.find((candidate) => candidate.id === editingId)
    : undefined;

  useEffect(() => {
    if (object) {
      textarea.current?.focus();
      textarea.current?.select();
    }
    // focus once when editing starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  if (!object || object.type !== 'text') return null;
  const frame = session.canvas?.objectScreenFrame(object.id);
  if (!frame) return null;
  void viewport;

  const finish = () => {
    session.store.sealHistory();
    session.setUi({ editingTextId: null });
  };

  return (
    <textarea
      ref={textarea}
      data-testid="inline-text-editor"
      aria-label="Edit text"
      dir="auto"
      lang={object.language ?? undefined}
      value={object.content}
      onChange={(event) =>
        session.apply(
          'Edit text',
          (doc, pid) => updateObject(doc, pid, object.id, { content: event.target.value }),
          {
            coalesceKey: `text:${object.id}:content`,
          },
        )
      }
      onBlur={finish}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
          event.preventDefault();
          finish();
        }
      }}
      style={{
        left: frame.left,
        top: frame.top,
        width: Math.max(frame.width, 60),
        height: Math.max(frame.height, 24),
        transform: frame.rotation ? `rotate(${frame.rotation}deg)` : undefined,
        transformOrigin: 'center',
        fontSize: Math.max(11, object.fontSize * frame.scale),
      }}
      className="absolute z-10 resize-none rounded-sm border-2 border-brand-600 bg-white/95 p-0.5 leading-tight text-slate-900 shadow-lg outline-none"
    />
  );
}

/**
 * Opt-in diagnostics for support and automated tests: set localStorage "smarttag:editor-diagnostics"
 * to "1" to expose the editor store and canvas on window. Same-origin scripts already have full
 * access to the page, so this grants no additional capability.
 */
function exposeDiagnostics(
  session: ReturnType<typeof useEditorSession>,
  canvas: EditorCanvas,
): void {
  try {
    if (window.localStorage.getItem('smarttag:editor-diagnostics') !== '1') return;
  } catch {
    return;
  }
  (window as unknown as { __smarttagEditor?: unknown }).__smarttagEditor = {
    store: session.store,
    save: session.save,
    canvas,
  };
}
