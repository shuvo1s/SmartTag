'use client';

import { MEASUREMENT_UNITS, type DesignDocument, type Page } from '@smarttag/document-schema';
import { formatLength } from '@smarttag/document-utils';
import {
  DocumentSettingsError,
  alignObjects,
  distributeObjects,
  findPage,
  setPageBackground,
  updateDimensions,
  type AlignMode,
  type DimensionsPatch,
} from '@smarttag/editor-core';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Info,
} from 'lucide-react';
import { useState } from 'react';
import { ColorField, LengthField, PanelSection, SelectField } from './editor-inputs';
import { useEditorSession, useEditorState } from './editor-session';
import { ObjectProperties } from './object-properties';

export function PropertiesPanel({ renderVersion }: { renderVersion: number }) {
  const document = useEditorState((state) => state.document);
  const pageId = useEditorState((state) => state.activePageId);
  const selection = useEditorState((state) => state.selection);
  const readOnly = useEditorState((state) => state.readOnly);
  const page = findPage(document, pageId);
  const selected = selection
    .map((id) => page.objects.find((object) => object.id === id))
    .filter((object) => object !== undefined);

  return (
    <aside
      aria-label="Properties"
      data-testid="properties-panel"
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white"
    >
      {selected.length === 1 ? (
        <ObjectProperties
          object={selected[0]!}
          document={document}
          pageId={pageId}
          readOnly={readOnly}
          renderVersion={renderVersion}
        />
      ) : selected.length > 1 ? (
        <MultiSelection ids={selection} count={selected.length} readOnly={readOnly} />
      ) : (
        <PageSettings document={document} page={page} readOnly={readOnly} />
      )}
    </aside>
  );
}

const ALIGN_BUTTONS: readonly {
  mode: AlignMode;
  label: string;
  Icon: typeof AlignStartVertical;
}[] = [
  { mode: 'LEFT', label: 'Align left', Icon: AlignStartVertical },
  { mode: 'HCENTER', label: 'Align horizontal centres', Icon: AlignCenterVertical },
  { mode: 'RIGHT', label: 'Align right', Icon: AlignEndVertical },
  { mode: 'TOP', label: 'Align top', Icon: AlignStartHorizontal },
  { mode: 'VCENTER', label: 'Align vertical centres', Icon: AlignCenterHorizontal },
  { mode: 'BOTTOM', label: 'Align bottom', Icon: AlignEndHorizontal },
];

function IconButton({
  label,
  onClick,
  disabled,
  children,
  testId,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded border border-slate-200 text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function MultiSelection({
  ids,
  count,
  readOnly,
}: {
  ids: readonly string[];
  count: number;
  readOnly: boolean;
}) {
  const session = useEditorSession();
  return (
    <div data-testid="multi-selection">
      <div className="border-b border-slate-200 px-3 py-2">
        <p className="text-xs font-semibold text-slate-900">{count} objects selected</p>
      </div>
      <PanelSection title="Align">
        <div className="flex flex-wrap gap-1">
          {ALIGN_BUTTONS.map(({ mode, label, Icon }) => (
            <IconButton
              key={mode}
              label={label}
              testId={`align-${mode.toLowerCase()}`}
              disabled={readOnly}
              onClick={() =>
                session.apply(label, (doc, pageId) => alignObjects(doc, pageId, ids, mode))
              }
            >
              <Icon className="size-4" />
            </IconButton>
          ))}
        </div>
      </PanelSection>
      <PanelSection title="Distribute">
        <div className="flex gap-1">
          <IconButton
            label="Distribute horizontally"
            testId="distribute-horizontal"
            disabled={readOnly || count < 3}
            onClick={() =>
              session.apply('Distribute horizontally', (doc, pageId) =>
                distributeObjects(doc, pageId, ids, 'HORIZONTAL'),
              )
            }
          >
            <AlignHorizontalDistributeCenter className="size-4" />
          </IconButton>
          <IconButton
            label="Distribute vertically"
            testId="distribute-vertical"
            disabled={readOnly || count < 3}
            onClick={() =>
              session.apply('Distribute vertically', (doc, pageId) =>
                distributeObjects(doc, pageId, ids, 'VERTICAL'),
              )
            }
          >
            <AlignVerticalDistributeCenter className="size-4" />
          </IconButton>
        </div>
        {count < 3 ? (
          <p className="text-[11px] text-slate-500">Select three or more objects to distribute.</p>
        ) : null}
      </PanelSection>
    </div>
  );
}

function PageSettings({
  document,
  page,
  readOnly,
}: {
  document: DesignDocument;
  page: Page;
  readOnly: boolean;
}) {
  const session = useEditorSession();
  const [error, setError] = useState<string | null>(null);
  const { dimensions } = document;
  const unit = dimensions.displayUnit;
  const uniform = (value: number) => ({ top: value, right: value, bottom: value, left: value });

  const change = (label: string, patch: DimensionsPatch) => {
    setError(null);
    try {
      session.store.apply(label, (doc) => updateDimensions(doc, patch));
    } catch (caught) {
      if (caught instanceof DocumentSettingsError) {
        setError(caught.issues.map((issue) => issue.message).join(' '));
      } else {
        throw caught;
      }
    }
  };

  return (
    <div data-testid="page-settings">
      <div className="border-b border-slate-200 px-3 py-2">
        <p className="text-xs font-semibold text-slate-900">Document</p>
        <p className="text-[11px] text-slate-500">
          {page.name} · {formatLength(dimensions.width, unit)} ×{' '}
          {formatLength(dimensions.height, unit)}
        </p>
      </div>
      <PanelSection title="Size">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <LengthField
            label="Width"
            testId="page-width"
            valuePt={dimensions.width}
            unit={unit}
            disabled={readOnly}
            min={0}
            onCommitPt={(width) => change('Page width', { width })}
          />
          <LengthField
            label="Height"
            testId="page-height"
            valuePt={dimensions.height}
            unit={unit}
            disabled={readOnly}
            min={0}
            onCommitPt={(height) => change('Page height', { height })}
          />
        </div>
        <div className="grid grid-cols-2 gap-x-2">
          <SelectField
            label="Unit"
            testId="page-unit"
            value={unit}
            disabled={readOnly}
            options={MEASUREMENT_UNITS.map((value) => ({ value, label: value }))}
            onChange={(displayUnit) => change('Display unit', { displayUnit })}
          />
          <button
            type="button"
            className="h-7 rounded border border-slate-300 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            disabled={readOnly || dimensions.width === dimensions.height}
            onClick={() =>
              change('Swap orientation', { width: dimensions.height, height: dimensions.width })
            }
          >
            {dimensions.orientation === 'PORTRAIT'
              ? 'Portrait → landscape'
              : 'Landscape → portrait'}
          </button>
        </div>
        <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
          <Info className="mt-0.5 size-3 shrink-0" /> Changing the size does not scale or move
          artwork.
        </p>
      </PanelSection>
      <PanelSection title="Production areas">
        <LengthField
          label="Bleed"
          testId="page-bleed"
          valuePt={dimensions.bleed.top}
          unit={unit}
          disabled={readOnly}
          min={0}
          onCommitPt={(value) => change('Bleed', { bleed: uniform(value) })}
        />
        <LengthField
          label="Safe"
          testId="page-safe"
          valuePt={dimensions.safeArea.top}
          unit={unit}
          disabled={readOnly}
          min={0}
          onCommitPt={(value) => change('Safe area', { safeArea: uniform(value) })}
        />
        <LengthField
          label="Margin"
          valuePt={dimensions.margins.top}
          unit={unit}
          disabled={readOnly}
          min={0}
          onCommitPt={(value) => change('Margins', { margins: uniform(value) })}
        />
        {error ? (
          <p role="alert" className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-800">
            {error}
          </p>
        ) : null}
      </PanelSection>
      <PanelSection title="Page">
        <ColorField
          label="Paper"
          color={page.background}
          allowNone
          disabled={readOnly}
          onChange={(background) =>
            session.apply('Page background', (doc, pageId) =>
              setPageBackground(doc, pageId, background),
            )
          }
        />
      </PanelSection>
      <PanelSection title="Dieline (production guide)">
        {dimensions.dieline.features.length === 0 ? (
          <p className="text-[11px] text-slate-500">No cut features.</p>
        ) : (
          <ul className="space-y-1 text-[11px] text-slate-600">
            <li>Corner radius {formatLength(dimensions.dieline.trimShape.cornerRadius, unit)}</li>
            {dimensions.dieline.features.map((feature) => (
              <li key={feature.id}>
                {feature.type === 'PUNCH_HOLE'
                  ? `Punch hole Ø ${formatLength(feature.diameter, unit)} at ${formatLength(feature.center.x, unit)}, ${formatLength(feature.center.y, unit)}`
                  : feature.type.replace('_', ' ').toLowerCase()}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-slate-400">
          Dieline features are production geometry, not artwork; they are edited with the dieline
          tools in a later phase.
        </p>
      </PanelSection>
    </div>
  );
}
