'use client';

import {
  OBJECT_BINDABLE_PROPERTIES,
  type ArtworkObject,
  type PropertyBinding,
} from '@smarttag/document-schema';
import { useMemo } from 'react';
import {
  findPage,
  isEffectivelyLocked,
  moveObjectToLayerIndex,
  paintOrder,
  renameObject,
  reorderObjects,
  setObjectsLocked,
  setObjectsVisible,
  type ReorderOperation,
} from '@smarttag/editor-core';
import { cn } from '@smarttag/ui';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Barcode,
  Circle,
  Database,
  Eye,
  EyeOff,
  AlertTriangle,
  Sigma,
  Image as ImageIcon,
  Lock,
  Minus,
  QrCode,
  Square,
  Type,
  Unlock,
} from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { useEditorSession, useEditorState, usePreviewState } from './editor-session';

const TYPE_ICONS = {
  text: Type,
  image: ImageIcon,
  rectangle: Square,
  ellipse: Circle,
  line: Minus,
  barcode: Barcode,
  qrCode: QrCode,
} as const;

/** The first data-driven property of an object, for the layer row subtitle. */
function primaryBinding(object: ArtworkObject): PropertyBinding | null {
  const bindings = object.bindings as Readonly<Record<string, PropertyBinding>>;
  const properties = Object.keys(OBJECT_BINDABLE_PROPERTIES[object.type]);
  for (const property of [...properties.filter((p) => p !== 'visible'), 'visible']) {
    const binding = bindings[property];
    if (binding && binding.mode !== 'STATIC') return binding;
  }
  return null;
}

export function LayersPanel() {
  const session = useEditorSession();
  const document = useEditorState((state) => state.document);
  const pageId = useEditorState((state) => state.activePageId);
  const selection = useEditorState((state) => state.selection);
  const readOnly = useEditorState((state) => state.readOnly);
  const preview = usePreviewState();
  const page = findPage(document, pageId);
  const dataState = useMemo(() => {
    void preview.version;
    if (preview.mode !== 'DATA') return null;
    const result = session.preview.compute(document);
    const issues = new Map<string, 'ERROR' | 'WARNING'>();
    for (const issue of result.issues) {
      if (!issue.target) continue;
      if (issues.get(issue.target.objectId) !== 'ERROR')
        issues.set(issue.target.objectId, issue.severity);
    }
    return { hidden: result.resolution.hiddenObjectIds, issues };
  }, [preview.mode, preview.version, document, session]);
  // Top of the stack first, as in design tools.
  const layers = paintOrder(page).reverse();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const select = (id: string, additive: boolean) => {
    if (additive) {
      session.store.setSelection(
        selection.includes(id)
          ? selection.filter((candidate) => candidate !== id)
          : [...selection, id],
      );
    } else {
      session.store.setSelection([id]);
    }
  };

  const reorder = (operation: ReorderOperation, label: string) =>
    session.apply(label, (doc, pid) => reorderObjects(doc, pid, selection, operation));

  const onKey = (event: KeyboardEvent<HTMLLIElement>, id: string, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      select(id, event.shiftKey);
    } else if (event.key === 'F2' && !readOnly) {
      setRenaming(id);
    } else if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      // Plain arrows nudge the selection (editor root); Alt+Up/Down moves between layers.
      event.preventDefault();
      event.stopPropagation();
      const nextIndex = index + (event.key === 'ArrowDown' ? 1 : -1);
      const next = layers[nextIndex];
      if (!next) return;
      (event.currentTarget.parentElement?.children[nextIndex] as HTMLElement | undefined)?.focus();
      select(next.id, event.shiftKey);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="layers-panel">
      <div className="flex items-center justify-between border-b border-slate-200 px-2 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {page.name} · {page.objects.length}
        </span>
        <div className="flex gap-0.5">
          {(
            [
              ['FRONT', 'Bring to front', ArrowUpToLine],
              ['FORWARD', 'Bring forward', ArrowUp],
              ['BACKWARD', 'Send backward', ArrowDown],
              ['BACK', 'Send to back', ArrowDownToLine],
            ] as const
          ).map(([operation, label, Icon]) => (
            <button
              key={operation}
              type="button"
              aria-label={label}
              title={label}
              data-testid={`layer-${operation.toLowerCase()}`}
              disabled={readOnly || selection.length === 0}
              onClick={() => reorder(operation, label)}
              className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
      </div>
      <ul
        role="listbox"
        aria-label="Layers"
        aria-describedby="layers-keyboard-hint"
        aria-multiselectable="true"
        className="min-h-0 flex-1 overflow-y-auto py-1"
      >
        {layers.map((object, index) => {
          const Icon = TYPE_ICONS[object.type];
          const selected = selection.includes(object.id);
          const locked = isEffectivelyLocked(page, object);
          return (
            <li
              key={object.id}
              role="option"
              aria-selected={selected}
              tabIndex={0}
              data-testid={`layer-row-${object.id}`}
              draggable={!readOnly && renaming !== object.id}
              onDragStart={(event) => {
                setDragId(object.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', object.id);
              }}
              onDragOver={(event) => {
                if (!dragId) return;
                event.preventDefault();
                setDropIndex(index);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropIndex(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragId && dragId !== object.id) {
                  // layers are shown top-first; convert to a paint-order index
                  const targetPaintIndex = layers.length - 1 - index;
                  session.apply('Reorder layers', (doc, pid) =>
                    moveObjectToLayerIndex(doc, pid, dragId, targetPaintIndex),
                  );
                }
                setDragId(null);
                setDropIndex(null);
              }}
              onClick={(event) =>
                select(object.id, event.shiftKey || event.metaKey || event.ctrlKey)
              }
              onDoubleClick={() => !readOnly && setRenaming(object.id)}
              onKeyDown={(event) => onKey(event, object.id, index)}
              className={cn(
                'group flex h-8 cursor-default items-center gap-1.5 px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600',
                selected ? 'bg-brand-50 text-brand-900' : 'text-slate-700 hover:bg-slate-50',
                dropIndex === index && dragId !== object.id ? 'border-t-2 border-brand-600' : '',
                !object.visible ? 'text-slate-400' : '',
              )}
            >
              <Icon className="size-3.5 shrink-0 text-slate-500" aria-hidden />
              {renaming === object.id ? (
                <input
                  autoFocus
                  aria-label="Layer name"
                  defaultValue={object.name}
                  className="h-6 min-w-0 flex-1 rounded border border-brand-600 px-1 text-xs"
                  onClick={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    session.apply('Rename layer', (doc, pid) =>
                      renameObject(doc, pid, object.id, event.target.value),
                    );
                    setRenaming(null);
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                    if (event.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate">{object.name || object.id}</span>
              )}
              {dataState?.issues.get(object.id) ? (
                <AlertTriangle
                  data-testid="layer-data-issue"
                  aria-label={
                    dataState.issues.get(object.id) === 'ERROR' ? 'Data error' : 'Data warning'
                  }
                  className={cn(
                    'size-3 shrink-0',
                    dataState.issues.get(object.id) === 'ERROR' ? 'text-red-600' : 'text-amber-600',
                  )}
                />
              ) : null}
              {dataState?.hidden.has(object.id) ? (
                <EyeOff
                  data-testid="layer-data-hidden"
                  aria-label="Hidden by test data"
                  className="size-3 shrink-0 text-sky-700"
                />
              ) : null}
              {(() => {
                const binding = primaryBinding(object);
                if (!binding) return null;
                return binding.mode === 'EXPRESSION' ? (
                  <Sigma
                    data-testid="layer-bound"
                    data-mode="EXPRESSION"
                    aria-label={`Expression: ${binding.expression}`}
                    className="size-3 shrink-0 text-amber-600"
                  >
                    <title>{binding.expression}</title>
                  </Sigma>
                ) : binding.mode === 'FIELD' ? (
                  <span
                    data-testid="layer-bound"
                    data-mode="FIELD"
                    title={`Bound to ${binding.field}`}
                    className="flex max-w-20 shrink items-center gap-0.5 truncate font-mono text-[9px] text-amber-700"
                  >
                    <Database
                      aria-label="Bound to data"
                      className="size-3 shrink-0 text-amber-600"
                    />
                    <span className="truncate">↳ {binding.field}</span>
                  </span>
                ) : null;
              })()}
              <button
                type="button"
                aria-label={
                  object.visible
                    ? `Hide ${object.name || object.id}`
                    : `Show ${object.name || object.id}`
                }
                title={object.visible ? 'Hide' : 'Show'}
                data-testid={`layer-visibility-${object.id}`}
                disabled={readOnly}
                onClick={(event) => {
                  event.stopPropagation();
                  session.apply(object.visible ? 'Hide' : 'Show', (doc, pid) =>
                    setObjectsVisible(doc, pid, [object.id], !object.visible),
                  );
                }}
                className={cn(
                  'rounded p-0.5 hover:bg-slate-200 disabled:opacity-40',
                  object.visible ? 'opacity-0 group-hover:opacity-100 focus:opacity-100' : '',
                )}
              >
                {object.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </button>
              <button
                type="button"
                aria-label={
                  object.locked
                    ? `Unlock ${object.name || object.id}`
                    : `Lock ${object.name || object.id}`
                }
                title={object.locked ? 'Unlock' : 'Lock'}
                data-testid={`layer-lock-${object.id}`}
                disabled={readOnly}
                onClick={(event) => {
                  event.stopPropagation();
                  session.apply(object.locked ? 'Unlock' : 'Lock', (doc, pid) =>
                    setObjectsLocked(doc, pid, [object.id], !object.locked),
                  );
                }}
                className={cn(
                  'rounded p-0.5 hover:bg-slate-200 disabled:opacity-40',
                  locked ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
                )}
              >
                {object.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
              </button>
            </li>
          );
        })}
        {layers.length === 0 ? (
          <li className="px-3 py-4 text-xs text-slate-500">No objects on this page yet.</li>
        ) : null}
      </ul>
      <p id="layers-keyboard-hint" className="sr-only">
        Alt plus Up or Down arrow moves between layers. Arrow keys nudge the selected objects. F2
        renames a layer.
      </p>
    </div>
  );
}
