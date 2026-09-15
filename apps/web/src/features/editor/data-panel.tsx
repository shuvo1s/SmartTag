'use client';

import { collectFieldUsages, type FieldUsage } from '@smarttag/data-core';
import { MISSING_DATA_POLICIES, type MissingDataPolicy } from '@smarttag/document-schema';
import {
  EditorCommandError,
  addObjects,
  createFieldObject,
  deleteDataField,
  setMissingDataPolicy,
} from '@smarttag/editor-core';
import { cn } from '@smarttag/ui';
import { GripVertical, Pencil, Plus, Trash2, Type, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FieldTypeBadge, RequiredBadge } from './data-ui';
import { panelInputClass } from './editor-inputs';
import { useEditorSession, useEditorState, useEditorUi } from './editor-session';
import { defaultFontChoice } from './editor-shortcuts';
import { TestDataPanel } from './test-data-panel';

/** MIME type carrying a field key when a field row is dragged onto the artboard. */
export const FIELD_DRAG_TYPE = 'application/x-smarttag-field';

const POLICY_LABELS: Readonly<Record<MissingDataPolicy, string>> = {
  FAIL: 'Fail — missing values are errors',
  WARN: 'Warn — leave empty and warn',
  EMPTY: 'Empty — leave empty silently',
};

export function DataPanel() {
  const session = useEditorSession();
  const tab = useEditorUi((ui) => ui.dataTab);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="data-panel">
      <div className="flex border-b border-slate-200 text-[11px]">
        {(
          [
            ['fields', 'Fields'],
            ['test', 'Test data'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            data-testid={`data-tab-${value}`}
            aria-pressed={tab === value}
            onClick={() => session.setUi({ dataTab: value })}
            className={cn(
              'flex-1 py-1.5 font-medium',
              tab === value ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'fields' ? <FieldsTab /> : <TestDataPanel />}
      <DeleteFieldDialog />
    </div>
  );
}

function FieldsTab() {
  const session = useEditorSession();
  const document = useEditorState((state) => state.document);
  const readOnly = useEditorState((state) => state.readOnly);
  const focused = useEditorUi((ui) => ui.focusedField);
  const usages = useMemo(() => collectFieldUsages(document), [document]);
  const [openUsage, setOpenUsage] = useState<string | null>(null);
  const fields = document.dataSchema.fields;

  const insertText = (key: string) => {
    const field = fields.find((candidate) => candidate.key === key);
    if (!field) return;
    try {
      const object = createFieldObject(field, document, { font: defaultFontChoice(session) });
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-2 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Fields · {fields.length}
        </span>
        <button
          type="button"
          data-testid="add-field"
          disabled={readOnly}
          onClick={() => session.setUi({ fieldDialog: { mode: 'create' } })}
          className="flex h-6 items-center gap-1 rounded bg-brand-700 px-2 text-[11px] font-medium text-white hover:bg-brand-800 disabled:bg-slate-300"
        >
          <Plus className="size-3" /> Add field
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Data fields">
        {fields.map((field) => {
          const used = usages.get(field.key) ?? [];
          return (
            <li
              key={field.key}
              data-testid={`data-field-row-${field.key}`}
              draggable={!readOnly}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData(FIELD_DRAG_TYPE, field.key);
                event.dataTransfer.setData('text/plain', field.key);
              }}
              className={cn(
                'group border-b border-slate-100 px-2 py-1.5',
                focused === field.key ? 'bg-brand-50' : 'hover:bg-slate-50',
              )}
            >
              <div className="flex items-start gap-1">
                {!readOnly ? (
                  <GripVertical
                    className="mt-0.5 size-3.5 shrink-0 cursor-grab text-slate-300"
                    aria-hidden
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-900">{field.displayName}</p>
                  <code className="block truncate font-mono text-[10px] text-slate-500">
                    {field.key}
                  </code>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <FieldTypeBadge type={field.type} />
                    {field.required ? <RequiredBadge /> : null}
                    <button
                      type="button"
                      data-testid={`field-usage-${field.key}`}
                      data-count={used.length}
                      aria-expanded={openUsage === field.key}
                      onClick={() => setOpenUsage(openUsage === field.key ? null : field.key)}
                      className={cn(
                        'rounded px-1 text-[10px]',
                        used.length > 0
                          ? 'text-brand-800 hover:bg-brand-50'
                          : 'text-slate-400 hover:bg-slate-100',
                      )}
                    >
                      {used.length === 0 ? 'Not used' : `Used by ${used.length}`}
                    </button>
                  </div>
                </div>
                <div className="flex shrink-0 gap-0.5 opacity-60 group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label={`Insert ${field.displayName} as text`}
                    title="Insert on the artboard"
                    data-testid={`insert-field-${field.key}`}
                    disabled={readOnly || field.type === 'boolean'}
                    onClick={() => insertText(field.key)}
                    className="rounded p-0.5 text-slate-600 hover:bg-slate-200 disabled:opacity-30"
                  >
                    <Type className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Edit ${field.displayName}`}
                    data-testid={`edit-field-${field.key}`}
                    onClick={() => session.setUi({ fieldDialog: { mode: 'edit', key: field.key } })}
                    disabled={readOnly}
                    className="rounded p-0.5 text-slate-600 hover:bg-slate-200 disabled:opacity-30"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${field.displayName}`}
                    data-testid={`delete-field-${field.key}`}
                    onClick={() => session.setUi({ deleteFieldKey: field.key })}
                    disabled={readOnly}
                    className="rounded p-0.5 text-slate-600 hover:bg-red-100 hover:text-red-700 disabled:opacity-30"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
              {openUsage === field.key ? (
                <UsageList usages={used} testId={`field-usages-${field.key}`} />
              ) : null}
            </li>
          );
        })}
        {fields.length === 0 ? (
          <li className="space-y-1 px-3 py-4 text-xs text-slate-500">
            <p>This template has no data fields yet.</p>
            <p>Add fields such as product name, size or price, then bind artwork to them.</p>
          </li>
        ) : null}
      </ul>
      <div className="space-y-1 border-t border-slate-200 p-2">
        <label className="block space-y-0.5">
          <span className="text-[11px] font-medium text-slate-600">
            When an optional value is missing
          </span>
          <select
            data-testid="missing-data-policy"
            className={panelInputClass}
            value={document.settings.missingDataPolicy}
            disabled={readOnly}
            onChange={(event) =>
              session.apply('Missing data policy', (doc) =>
                setMissingDataPolicy(doc, event.target.value as MissingDataPolicy),
              )
            }
          >
            {MISSING_DATA_POLICIES.map((policy) => (
              <option key={policy} value={policy}>
                {POLICY_LABELS[policy]}
              </option>
            ))}
          </select>
        </label>
        {!readOnly && fields.length > 0 ? (
          <p className="text-[10px] text-slate-400">
            Drag a field onto the artboard to add text bound to it.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function UsageList({ usages, testId }: { usages: readonly FieldUsage[]; testId: string }) {
  const session = useEditorSession();
  if (usages.length === 0) {
    return (
      <p data-testid={testId} className="mt-1 pl-4 text-[10px] text-slate-400">
        No artwork uses this field.
      </p>
    );
  }
  return (
    <ul data-testid={testId} className="mt-1 space-y-0.5 pl-4">
      {usages.map((usage) => (
        <li key={`${usage.objectId}:${usage.property}`}>
          <button
            type="button"
            data-testid="field-usage-entry"
            onClick={() => {
              session.store.setActivePage(usage.pageId);
              session.store.setSelection([usage.objectId]);
            }}
            className="w-full truncate rounded px-1 text-left text-[10px] text-slate-600 hover:bg-slate-200"
            title={usage.label}
          >
            {usage.label}
            {usage.mode === 'EXPRESSION' ? ' · expression' : ''}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Deleting a field never silently corrupts artwork: an unused field is simply removed; a used
 * field is removed only after explicit confirmation, together with returning every affected
 * property to its static value — in one undoable change.
 */
function DeleteFieldDialog() {
  const session = useEditorSession();
  const key = useEditorUi((ui) => ui.deleteFieldKey);
  const document = useEditorState((state) => state.document);
  const dialog = useRef<HTMLDialogElement>(null);
  const field = document.dataSchema.fields.find((candidate) => candidate.key === key) ?? null;
  const usages = useMemo(
    () => (key ? (collectFieldUsages(document).get(key) ?? []) : []),
    [document, key],
  );
  const open = field !== null;

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  const close = () => session.setUi({ deleteFieldKey: null });
  const confirm = () => {
    if (!field) return;
    session.apply(
      usages.length > 0 ? 'Delete field and bindings' : 'Delete field',
      (doc) => deleteDataField(doc, field.key, { removeBindings: true }).document,
    );
    close();
  };

  return (
    <dialog
      ref={dialog}
      data-testid="delete-field-dialog"
      aria-label="Delete data field"
      onClose={close}
      className="m-auto w-[440px] max-w-[95vw] rounded-lg border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      {field ? (
        <div className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Delete {field.displayName} ({field.key})?
            </h2>
            <button
              type="button"
              aria-label="Close"
              className="rounded p-1 hover:bg-slate-100"
              onClick={close}
            >
              <X className="size-4" />
            </button>
          </div>
          {usages.length > 0 ? (
            <>
              <p className="text-sm text-slate-700" data-testid="delete-field-usage-warning">
                This field is used by {usages.length} design propert
                {usages.length === 1 ? 'y' : 'ies'}. Deleting it returns{' '}
                {usages.length === 1 ? 'it' : 'them'} to their static values:
              </p>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
                {usages.map((usage) => (
                  <li key={`${usage.objectId}:${usage.property}`}>
                    {usage.label}
                    {usage.mode === 'EXPRESSION' ? ' (expression)' : ''}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-slate-700">No artwork uses this field.</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
              onClick={close}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="confirm-delete-field"
              className="rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800"
              onClick={confirm}
            >
              {usages.length > 0
                ? `Remove ${usages.length} binding${usages.length === 1 ? '' : 's'} and delete`
                : 'Delete field'}
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
