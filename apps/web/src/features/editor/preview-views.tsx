'use client';

import { getBleedBox } from '@smarttag/document-schema';
import { CSS_PIXELS_PER_POINT } from '@smarttag/document-utils';
import { buildPageScene, renderSceneToSvg } from '@smarttag/rendering-core';
import { useMemo, useState } from 'react';
import { FontAvailabilityNotice, summarizeFontAvailability } from '../rendering/font-availability';
import { svgOptionsFor } from '../rendering/rendering-services';
import { useEditorSession, useEditorState, useEditorUi } from './editor-session';

/** SVG of the active page rendered from the CANONICAL document by rendering-core. */
function useCanonicalSvg(options: {
  guides: boolean;
  finish: 'BLEED' | 'TRIM';
  showIssues: boolean;
  renderVersion: number;
}) {
  const session = useEditorSession();
  const document = useEditorState((state) => state.document);
  const pageId = useEditorState((state) => state.activePageId);
  return useMemo(() => {
    const scene = buildPageScene(document, pageId, {
      textLayout: session.resources.services.textLayout,
      barcodeEncoder: session.resources.services.barcodeEncoder ?? undefined,
    });
    return {
      scene,
      svg: renderSceneToSvg(scene, {
        ...svgOptionsFor(session.resources, session.assets),
        guides: options.guides
          ? { bleed: true, trim: true, safe: true, margins: false, dieline: true }
          : { bleed: false, trim: false, safe: false, margins: false, dieline: false },
        finish: options.finish,
        sizeUnit: 'none',
        showIssues: options.showIssues,
        idPrefix: `canonical-${pageId}`,
      }),
    };
    // renderVersion changes when fonts or images finish loading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    document,
    pageId,
    session,
    options.guides,
    options.finish,
    options.showIssues,
    options.renderVersion,
  ]);
}

/** Preview mode: no selection controls, no guides, trimmed piece — rendered from canonical data. */
export function PreviewView({ renderVersion }: { renderVersion: number }) {
  const session = useEditorSession();
  const document = useEditorState((state) => state.document);
  const [finish, setFinish] = useState<'TRIM' | 'BLEED'>('TRIM');
  const fontAvailability = useMemo(() => {
    void renderVersion;
    return summarizeFontAvailability(document, session.resources.fonts);
  }, [document, session, renderVersion]);
  const zoom = useEditorUi((ui) => ui.viewport.zoom);
  const { svg, scene } = useCanonicalSvg({
    guides: false,
    finish,
    showIssues: false,
    renderVersion,
  });
  const { bleed } = scene.boxes;
  const scale = Math.max(zoom, 0.25) * CSS_PIXELS_PER_POINT;
  return (
    <div
      data-testid="canonical-preview"
      className="relative flex min-h-0 flex-1 flex-col bg-slate-600"
    >
      <div className="flex items-center gap-2 bg-slate-700 px-3 py-1.5 text-xs text-slate-100">
        <span className="font-medium">Preview · canonical renderer</span>
        <FontAvailabilityNotice availability={fontAvailability} compact />
        <label className="ml-auto flex items-center gap-1.5">
          Show
          <select
            aria-label="Preview area"
            className="rounded bg-slate-800 px-1 py-0.5"
            value={finish}
            onChange={(event) => setFinish(event.target.value as 'TRIM' | 'BLEED')}
          >
            <option value="TRIM">Finished piece</option>
            <option value="BLEED">Print sheet with bleed</option>
          </select>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-10">
        <div
          className="mx-auto shadow-2xl [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          style={{ width: bleed.width * scale, height: bleed.height * scale }}
          // Produced by rendering-core, which escapes all text and attribute values.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}

/**
 * Developer comparison: the canonical SVG drawn over the live canvas with the same viewport, either
 * side by side or as a difference overlay (identical pixels cancel out, divergence lights up).
 */
export function CompareOverlay({ renderVersion }: { renderVersion: number }) {
  const [mode, setMode] = useState<'difference' | 'side-by-side' | 'onion'>('difference');
  const document = useEditorState((state) => state.document);
  const { svg } = useCanonicalSvg({
    guides: false,
    finish: 'BLEED',
    showIssues: true,
    renderVersion,
  });
  const viewport = useEditorUi((ui) => ui.viewport);
  const bleed = getBleedBox(document.dimensions);
  const scale = viewport.zoom * CSS_PIXELS_PER_POINT;

  return (
    <>
      <div className="absolute left-1/2 top-2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900/90 px-3 py-1 text-[11px] text-white shadow">
        <span className="font-semibold">Canvas vs canonical renderer</span>
        {(['difference', 'onion', 'side-by-side'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={
              value === mode ? 'rounded bg-white/20 px-1.5' : 'px-1.5 opacity-70 hover:opacity-100'
            }
          >
            {value}
          </button>
        ))}
      </div>
      {mode === 'side-by-side' ? (
        <div
          data-testid="compare-side"
          className="absolute inset-y-0 right-0 z-10 w-1/2 overflow-auto border-l-4 border-slate-900 bg-[#DDE3EA] p-6"
        >
          <p className="mb-2 text-[11px] font-semibold text-slate-700">
            Canonical SVG (rendering-core)
          </p>
          <div
            className="shadow-lg [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
            style={{ width: bleed.width * scale, height: bleed.height * scale }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      ) : (
        <div
          data-testid="compare-overlay"
          className="pointer-events-none absolute z-10 [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          style={{
            left: viewport.panX + bleed.x * scale,
            top: viewport.panY + bleed.y * scale,
            width: bleed.width * scale,
            height: bleed.height * scale,
            mixBlendMode: mode === 'difference' ? 'difference' : 'normal',
            opacity: mode === 'onion' ? 0.5 : 1,
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </>
  );
}
