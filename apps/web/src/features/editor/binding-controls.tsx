'use client';

import { describeBindableProperty } from '@smarttag/data-core';
import {
  isFieldTypeCompatible,
  type ArtworkObject,
  type DesignDocument,
  type PropertyBinding,
} from '@smarttag/document-schema';
import { bindablePropertyKind, setPropertyBinding } from '@smarttag/editor-core';
import { cn } from '@smarttag/ui';
import { Database, Sigma, Type } from 'lucide-react';
import type { ReactNode } from 'react';
import { expressionStringLiteral } from './data-ui';
import { ExpressionEditor } from './expression-editor';
import { FieldPicker } from './field-picker';
import { useEditorSession, usePreviewState } from './editor-session';

const MODES = [
  { mode: 'STATIC', label: 'Static', Icon: Type },
  { mode: 'FIELD', label: 'Field', Icon: Database },
  { mode: 'EXPRESSION', label: 'Expression', Icon: Sigma },
] as const;

/** The value an Expression binding starts with, derived from the current binding. */
function initialExpression(
  object: ArtworkObject,
  property: string,
  binding: PropertyBinding,
  document: DesignDocument,
): string | null {
  if (binding.mode === 'FIELD') return binding.field;
  const kind = bindablePropertyKind(object, property);
  if (kind === 'VISIBILITY') return object.visible ? 'true' : 'false';
  if (kind === 'IMAGE_ASSET') {
    const imageField = document.dataSchema.fields.find((field) => field.type === 'image');
    return imageField?.key ?? null;
  }
  const record = object as unknown as Readonly<Record<string, unknown>>;
  const value = record[property];
  return expressionStringLiteral(typeof value === 'string' ? value : '');
}

/**
 * How one property gets its value: Static (the property's own value), a data Field, or an
 * Expression. Changing the mode is one undo step; the static value is kept, so returning to
 * Static restores it. The static editor stays available in every mode as the template/sample value.
 */
export function PropertyBindingControl({
  object,
  pageId,
  property,
  document,
  disabled,
  children,
  staticLabel = 'Template value',
}: {
  object: ArtworkObject;
  pageId: string;
  property: string;
  document: DesignDocument;
  disabled: boolean;
  /** Editor for the static value. */
  children: ReactNode;
  staticLabel?: string;
}) {
  const session = useEditorSession();
  const preview = usePreviewState();
  const kind = bindablePropertyKind(object, property);
  if (!kind) return <>{children}</>;
  const binding = (object.bindings as Readonly<Record<string, PropertyBinding>>)[property] ?? {
    mode: 'STATIC',
  };
  const compatibleFields = document.dataSchema.fields.filter((field) =>
    isFieldTypeCompatible(kind, field.type),
  );
  const label = describeBindableProperty(property);

  const bind = (next: PropertyBinding, action: string) =>
    session.apply(`${action} (${label.toLowerCase()})`, (doc, pid) =>
      setPropertyBinding(doc, pid, object.id, property, next),
    );

  const chooseMode = (mode: PropertyBinding['mode']) => {
    if (mode === binding.mode) return;
    if (mode === 'STATIC') {
      bind({ mode: 'STATIC' }, 'Use static value');
    } else if (mode === 'FIELD') {
      const field = compatibleFields[0];
      if (field) bind({ mode: 'FIELD', field: field.key }, 'Bind to field');
    } else {
      const expression = initialExpression(object, property, binding, document);
      if (expression !== null) bind({ mode: 'EXPRESSION', expression }, 'Use expression');
    }
  };

  const resolved = preview.mode === 'DATA' && binding.mode !== 'STATIC';
  const resolvedObject = resolved
    ? session.preview
        .current()
        ?.resolution.document.pages.find((page) => page.id === pageId)
        ?.objects.find((candidate) => candidate.id === object.id)
    : undefined;
  const resolvedValue = resolvedObject
    ? (resolvedObject as unknown as Readonly<Record<string, unknown>>)[property]
    : undefined;

  return (
    <div
      className="space-y-1.5"
      data-testid={`binding-control-${property}`}
      data-mode={binding.mode}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-600">{label}</span>
        <div
          role="radiogroup"
          aria-label={`${label} source`}
          className="flex rounded border border-slate-300 bg-slate-50 p-px"
        >
          {MODES.map(({ mode, label: modeLabel, Icon }) => {
            const unavailable =
              (mode === 'FIELD' && compatibleFields.length === 0) ||
              (mode === 'EXPRESSION' &&
                kind === 'IMAGE_ASSET' &&
                binding.mode !== 'FIELD' &&
                compatibleFields.length === 0);
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={binding.mode === mode}
                data-testid={`binding-mode-${property}-${mode.toLowerCase()}`}
                disabled={disabled || unavailable}
                title={
                  unavailable
                    ? `Add a data field that can be used for ${label.toLowerCase()} first`
                    : modeLabel
                }
                onClick={() => chooseMode(mode)}
                className={cn(
                  'flex h-5 items-center gap-0.5 rounded-sm px-1.5 text-[10px] disabled:opacity-40',
                  binding.mode === mode
                    ? 'bg-white font-semibold text-brand-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900',
                )}
              >
                <Icon className="size-3" aria-hidden />
                {modeLabel}
              </button>
            );
          })}
        </div>
      </div>

      {binding.mode === 'FIELD' ? (
        <FieldPicker
          fields={document.dataSchema.fields}
          kind={kind}
          value={binding.field}
          disabled={disabled}
          testId={`field-picker-${property}`}
          onChange={(field) => bind({ mode: 'FIELD', field }, 'Bind to field')}
        />
      ) : null}
      {binding.mode === 'EXPRESSION' ? (
        <ExpressionEditor
          property={property}
          kind={kind}
          expression={binding.expression}
          dataSchema={document.dataSchema}
          disabled={disabled}
          onApply={(expression) => bind({ mode: 'EXPRESSION', expression }, 'Change expression')}
        />
      ) : null}
      {resolved && resolvedValue !== undefined ? (
        <p
          data-testid={`resolved-value-${property}`}
          className="rounded bg-sky-50 px-1.5 py-1 text-[11px] text-sky-900"
        >
          <span className="text-sky-700">With test data: </span>
          {typeof resolvedValue === 'boolean'
            ? resolvedValue
              ? 'visible'
              : 'hidden'
            : resolvedValue === null || resolvedValue === ''
              ? '(empty)'
              : typeof resolvedValue === 'string'
                ? resolvedValue
                : JSON.stringify(resolvedValue)}
        </p>
      ) : null}

      {binding.mode === 'STATIC' ? (
        children
      ) : (
        <div className="space-y-1 border-l-2 border-slate-200 pl-2">
          <p className="text-[10px] text-slate-500" data-testid={`static-value-label-${property}`}>
            {staticLabel} — shown in Template values, never printed as data
          </p>
          {children}
        </div>
      )}
    </div>
  );
}
