'use client';

import {
  formatIssuePath,
  parseDesignDocument,
  type DesignDocument,
  type DocumentValidationIssue,
} from '@smarttag/document-schema';
import {
  formatLength,
  ptToCssPx,
  resolveDocumentBindings,
  type DataRecord,
} from '@smarttag/document-utils';
import { buildPageScene, renderSceneToSvg, type SvgGuideOptions } from '@smarttag/rendering-core';
import { Alert, cn } from '@smarttag/ui';
import { useId, useMemo, useState } from 'react';
import {
  svgOptionsFor,
  useFontRegistryQuery,
  useLoadedResources,
  useRenderingResources,
  type RenderingResources,
} from '../rendering/rendering-services';

const ZOOM_LEVELS = [0.5, 1, 1.5, 2, 3] as const;

export const assetContentUrl = (assetId: string) => `/api/v1/assets/${assetId}/content`;

export interface DocumentPreviewProps {
  document: DesignDocument;
  /** When provided, bound properties are replaced with values from this record. */
  record?: DataRecord | null;
  resolveAssetUrl?: (assetId: string) => string | null;
  initialZoom?: (typeof ZOOM_LEVELS)[number];
  /** Controlled fonts, text layout and barcode encoder; without them the preview approximates. */
  resources?: RenderingResources | null;
  /** Changes when fonts or images finish loading. */
  resourceVersion?: number;
}

/**
 * Browser representation of a canonical document, built with rendering-core (scene → SVG).
 * Not an editor: it proves that the stored model renders independently of any canvas library.
 */
export function DocumentPreview({
  document,
  record = null,
  resolveAssetUrl = assetContentUrl,
  initialZoom = 1.5,
  resources = null,
  resourceVersion = 0,
}: DocumentPreviewProps) {
  const [pageId, setPageId] = useState(document.pages[0]?.id ?? '');
  const [zoom, setZoom] = useState<number>(initialZoom);
  const [finish, setFinish] = useState<'BLEED' | 'TRIM'>('BLEED');
  const [highlightBound, setHighlightBound] = useState(false);
  const [guides, setGuides] = useState<SvgGuideOptions>({
    bleed: true,
    trim: true,
    safe: true,
    margins: false,
    dieline: true,
  });
  const idPrefix = `preview${useId()}`;

  const activePageId = document.pages.some((page) => page.id === pageId)
    ? pageId
    : (document.pages[0]?.id ?? '');
  const resolution = useMemo(
    () => (record ? resolveDocumentBindings(document, record) : null),
    [document, record],
  );
  const rendered = useMemo(() => {
    // Fonts and images load asynchronously; their arrival must produce a new render.
    void resourceVersion;
    const scene = buildPageScene(resolution?.document ?? document, activePageId, {
      textLayout: resources?.services.textLayout,
      barcodeEncoder: resources?.services.barcodeEncoder ?? undefined,
    });
    return {
      scene,
      svg: renderSceneToSvg(scene, {
        ...(resources ? svgOptionsFor(resources, new Map()) : {}),
        guides,
        finish,
        sizeUnit: 'none',
        resolveAssetUrl,
        highlightDataBound: highlightBound,
        idPrefix,
      }),
    };
  }, [
    resolution,
    document,
    activePageId,
    guides,
    finish,
    resolveAssetUrl,
    highlightBound,
    idPrefix,
    resources,
    resourceVersion,
  ]);

  const { dimensions } = document;
  const unit = dimensions.displayUnit;
  const { bleed } = rendered.scene.boxes;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div
          role="tablist"
          aria-label="Pages"
          className="inline-flex rounded-md border border-slate-300 bg-white p-0.5"
        >
          {document.pages.map((page) => (
            <button
              key={page.id}
              type="button"
              role="tab"
              aria-selected={page.id === activePageId}
              onClick={() => setPageId(page.id)}
              className={cn(
                'rounded px-3 py-1 text-sm',
                page.id === activePageId
                  ? 'bg-brand-700 text-white'
                  : 'text-slate-700 hover:bg-slate-100',
              )}
            >
              {page.name}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5">
          Zoom
          <select
            className="rounded border border-slate-300 px-1 py-0.5"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          >
            {ZOOM_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level * 100}%
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          View
          <select
            className="rounded border border-slate-300 px-1 py-0.5"
            value={finish}
            onChange={(event) => setFinish(event.target.value as 'BLEED' | 'TRIM')}
          >
            <option value="BLEED">Print sheet (with bleed)</option>
            <option value="TRIM">Finished piece (trimmed)</option>
          </select>
        </label>
        {(['bleed', 'trim', 'safe', 'margins', 'dieline'] as const).map((guide) => (
          <label key={guide} className="flex items-center gap-1 capitalize">
            <input
              type="checkbox"
              checked={guides[guide]}
              onChange={(event) => setGuides({ ...guides, [guide]: event.target.checked })}
            />
            {guide}
          </label>
        ))}
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={highlightBound}
            onChange={(event) => setHighlightBound(event.target.checked)}
          />
          Highlight data-bound
        </label>
      </div>

      {resolution && !resolution.ok ? (
        <Alert tone="warning" title="Some bound values could not be resolved from the data record">
          <ul className="list-disc pl-5">
            {resolution.issues.map((issue) => (
              <li key={`${issue.objectId}-${issue.property}`}>
                {issue.objectId}.{issue.property}: {issue.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="overflow-auto rounded-md border border-slate-200 bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-6">
        <div
          data-testid="document-preview-canvas"
          className="mx-auto shadow-md [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          style={{ width: ptToCssPx(bleed.width, zoom), height: ptToCssPx(bleed.height, zoom) }}
          // The SVG is produced by rendering-core, which escapes all text and attribute values.
          dangerouslySetInnerHTML={{ __html: rendered.svg }}
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
        <div>
          <dt className="font-medium text-slate-500">Trim</dt>
          <dd>
            {formatLength(dimensions.width, unit)} × {formatLength(dimensions.height, unit)} (
            {formatLength(dimensions.width, 'pt')} × {formatLength(dimensions.height, 'pt')})
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Bleed</dt>
          <dd>{formatLength(dimensions.bleed.top, unit)}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Safe area inset</dt>
          <dd>{formatLength(dimensions.safeArea.top, unit)}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Sheet with bleed</dt>
          <dd>
            {formatLength(bleed.width, unit)} × {formatLength(bleed.height, unit)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function DocumentIssues({
  issues,
  title,
}: {
  issues: readonly DocumentValidationIssue[];
  title: string;
}) {
  return (
    <Alert
      tone={issues.some((issue) => issue.severity === 'error') ? 'danger' : 'warning'}
      title={title}
    >
      <ul className="mt-1 space-y-1">
        {issues.map((issue, index) => (
          <li key={index} className="font-mono text-xs">
            <span className="font-semibold">{issue.code}</span> at{' '}
            <span>{formatIssuePath(issue.path) || '<root>'}</span>: {issue.message}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

/** Accepts untrusted JSON (e.g. from the API) and only renders it after migration + validation. */
export function ValidatedDocumentPreview({
  document,
  record,
}: {
  document: unknown;
  record?: DataRecord | null;
}) {
  const parsed = useMemo(() => parseDesignDocument(document), [document]);
  const fonts = useFontRegistryQuery();
  const resources = useRenderingResources(fonts.data);
  const resourceVersion = useLoadedResources(resources, parsed.valid ? parsed.document : null);
  if (!parsed.valid) {
    return (
      <DocumentIssues
        title="This document cannot be rendered because it failed validation"
        issues={parsed.errors}
      />
    );
  }
  return (
    <div className="space-y-3">
      {parsed.warnings.length > 0 ? (
        <DocumentIssues title="Validation warnings" issues={parsed.warnings} />
      ) : null}
      <DocumentPreview
        document={parsed.document}
        record={record}
        resources={resources}
        resourceVersion={resourceVersion}
      />
    </div>
  );
}
