'use client';

import { EditorCanvas } from '@smarttag/canvas-adapter';
import { updateObject } from '@smarttag/editor-core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditorSession, useEditorState, useEditorUi } from './editor-session';

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
        onEditTextRequest: (objectId) => session.setUi({ editingTextId: objectId }),
        onPointerMove: (point) => session.setUi({ pointer: point }),
        onTransformRejected: (message) => session.notify('warning', message),
      },
    });
    session.attachCanvas(canvas);
    const detach = canvas.attach(session.store);
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

  return (
    <div
      ref={container}
      data-testid="editor-canvas"
      data-zoom={viewport.zoom}
      data-pan-x={viewport.panX}
      data-pan-y={viewport.panY}
      className={
        hidden
          ? 'pointer-events-none invisible absolute inset-0'
          : 'relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#DDE3EA]'
      }
      onPointerDown={() => (document.activeElement as HTMLElement | null)?.blur()}
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
