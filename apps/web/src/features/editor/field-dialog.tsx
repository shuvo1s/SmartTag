'use client';

import {
  DATA_FIELD_TYPES,
  DECIMAL_PATTERN,
  DataFieldSchema,
  checkFieldDefinition,
  type DataField,
  type DataFieldType,
  type DesignDocument,
} from '@smarttag/document-schema';
import { suggestFieldKey } from '@smarttag/document-utils';
import {
  EditorCommandError,
  addDataField,
  checkNewFieldKey,
  countFieldUsages,
  renameDataField,
  updateDataField,
} from '@smarttag/editor-core';
import { normalizeDecimal } from '@smarttag/expression-core';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FIELD_TYPE_LABELS } from './data-ui';
import { usePlaceableAssets } from './editor-api';
import { panelInputClass } from './editor-inputs';
import { useEditorSession, useEditorState, useEditorUi } from './editor-session';

interface FieldForm {
  readonly displayName: string;
  readonly key: string;
  readonly keyTouched: boolean;
  readonly type: DataFieldType;
  readonly required: boolean;
  /** Text form of the default value ("" = none; "true"/"false" for yes/no fields). */
  readonly defaultText: string;
  readonly description: string;
  readonly minLength: string;
  readonly maxLength: string;
  readonly pattern: string;
  /** One allowed value per line. */
  readonly allowedValues: string;
  readonly min: string;
  readonly max: string;
}

const EMPTY_FORM: FieldForm = {
  displayName: '',
  key: '',
  keyTouched: false,
  type: 'string',
  required: false,
  defaultText: '',
  description: '',
  minLength: '',
  maxLength: '',
  pattern: '',
  allowedValues: '',
  min: '',
  max: '',
};

function formFromField(field: DataField): FieldForm {
  const text = (value: string | number | null) => (value === null ? '' : String(value));
  const base = {
    ...EMPTY_FORM,
    displayName: field.displayName,
    key: field.key,
    keyTouched: true,
    type: field.type,
    required: field.required,
    defaultText: field.defaultValue === null ? '' : String(field.defaultValue),
    description: field.description,
  };
  switch (field.type) {
    case 'string':
      return {
        ...base,
        minLength: text(field.validation.minLength),
        maxLength: text(field.validation.maxLength),
        pattern: field.validation.pattern ?? '',
        allowedValues: (field.validation.allowedValues ?? []).join('\n'),
      };
    case 'number':
    case 'decimal':
      return {
        ...base,
        min: text(field.validation.min),
        max: text(field.validation.max),
        allowedValues: ((field.validation.allowedValues ?? []) as (string | number)[]).join('\n'),
      };
    case 'boolean':
    case 'date':
    case 'url':
    case 'image':
      return base;
  }
}

type Built =
  | { readonly field: DataField; readonly error: null }
  | { readonly field: null; readonly error: string };

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Turns the form into a canonical field, or explains the first problem. */
function buildField(form: FieldForm): Built {
  const fail = (error: string): Built => ({ field: null, error });
  const integer = (text: string, label: string): number | null | string => {
    if (text.trim() === '') return null;
    const value = Number(text);
    return Number.isInteger(value) && value >= 0 ? value : `${label} must be a whole number`;
  };
  const number = (text: string, label: string): number | null | string => {
    if (text.trim() === '') return null;
    const value = Number(text.trim());
    return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text.trim()) && Number.isFinite(value)
      ? value
      : `${label} must be a number`;
  };
  const decimal = (text: string, label: string): string | null | { error: string } => {
    if (text.trim() === '') return null;
    return DECIMAL_PATTERN.test(text.trim())
      ? normalizeDecimal(text.trim())
      : { error: `${label} must be a decimal such as 19.99` };
  };

  const common = {
    key: form.key,
    displayName: form.displayName.trim(),
    required: form.required,
    description: form.description,
  };
  let candidate: unknown;
  switch (form.type) {
    case 'string': {
      const minLength = integer(form.minLength, 'Minimum length');
      const maxLength = integer(form.maxLength, 'Maximum length');
      if (typeof minLength === 'string') return fail(minLength);
      if (typeof maxLength === 'string') return fail(maxLength);
      const allowed = form.allowedValues.split('\n').filter((line) => line.length > 0);
      candidate = {
        ...common,
        type: 'string',
        defaultValue: form.defaultText === '' ? null : form.defaultText,
        validation: {
          minLength,
          maxLength,
          pattern: form.pattern.trim() === '' ? null : form.pattern.trim(),
          allowedValues: allowed.length === 0 ? null : allowed,
        },
      };
      break;
    }
    case 'number': {
      const values = [
        number(form.defaultText, 'The default'),
        number(form.min, 'Minimum'),
        number(form.max, 'Maximum'),
      ];
      const problem = values.find((value) => typeof value === 'string');
      if (typeof problem === 'string') return fail(problem);
      const allowed = lines(form.allowedValues).map((line) => number(line, 'Allowed values'));
      const allowedProblem = allowed.find((value) => typeof value === 'string');
      if (typeof allowedProblem === 'string') return fail(allowedProblem);
      candidate = {
        ...common,
        type: 'number',
        defaultValue: values[0],
        validation: {
          min: values[1],
          max: values[2],
          allowedValues: allowed.length === 0 ? null : allowed,
        },
      };
      break;
    }
    case 'decimal': {
      const values = [
        decimal(form.defaultText, 'The default'),
        decimal(form.min, 'Minimum'),
        decimal(form.max, 'Maximum'),
        ...lines(form.allowedValues).map((line) => decimal(line, 'Allowed values')),
      ];
      const problem = values.find((value) => value !== null && typeof value === 'object');
      if (problem && typeof problem === 'object') return fail(problem.error);
      const allowed = values.slice(3) as string[];
      candidate = {
        ...common,
        type: 'decimal',
        defaultValue: values[0],
        validation: {
          min: values[1],
          max: values[2],
          allowedValues: allowed.length === 0 ? null : allowed,
        },
      };
      break;
    }
    case 'boolean':
      candidate = {
        ...common,
        type: 'boolean',
        defaultValue: form.defaultText === '' ? null : form.defaultText === 'true',
        validation: {},
      };
      break;
    case 'date':
    case 'url':
    case 'image':
      candidate = {
        ...common,
        type: form.type,
        defaultValue: form.defaultText.trim() === '' ? null : form.defaultText.trim(),
        validation: {},
      };
      break;
  }
  const parsed = DataFieldSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    const label =
      path === 'displayName'
        ? 'Display name'
        : path === 'defaultValue'
          ? 'Default value'
          : path.startsWith('validation')
            ? `Rule ${path.split('.')[1] ?? ''}`
            : path;
    return fail(`${label ? `${label}: ` : ''}${issue?.message ?? 'Invalid field'}`);
  }
  const [problem] = checkFieldDefinition(parsed.data);
  return problem ? fail(problem.message) : { field: parsed.data, error: null };
}

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block space-y-0.5">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      {children}
      {hint ? <span className="block text-[10px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

/** Creates or edits one data field; every change is a single undo step. */
export function FieldDialog() {
  const session = useEditorSession();
  const state = useEditorUi((ui) => ui.fieldDialog);
  const document = useEditorState((s) => s.document);
  const dialog = useRef<HTMLDialogElement>(null);
  const open = state !== null;

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-label={state?.mode === 'edit' ? 'Edit data field' : 'Add data field'}
      data-testid="field-dialog"
      onClose={() => session.setUi({ fieldDialog: null })}
      className="m-auto w-[480px] max-w-[95vw] rounded-lg border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      {state ? (
        <FieldDialogBody
          key={state.mode === 'edit' ? state.key : 'create'}
          document={document}
          originalKey={state.mode === 'edit' ? state.key : null}
          onClose={() => session.setUi({ fieldDialog: null })}
        />
      ) : null}
    </dialog>
  );
}

function FieldDialogBody({
  document,
  originalKey,
  onClose,
}: {
  document: DesignDocument;
  originalKey: string | null;
  onClose: () => void;
}) {
  const session = useEditorSession();
  const original = document.dataSchema.fields.find((field) => field.key === originalKey) ?? null;
  const [form, setForm] = useState<FieldForm>(() =>
    original ? formFromField(original) : EMPTY_FORM,
  );
  const [commandError, setCommandError] = useState<string | null>(null);
  const images = usePlaceableAssets('', '');
  const usages = originalKey ? countFieldUsages(document, originalKey) : 0;
  const update = (patch: Partial<FieldForm>) => {
    setCommandError(null);
    setForm((current) => ({ ...current, ...patch }));
  };

  const keyProblem = checkNewFieldKey(document, form.key, { ignoreKey: originalKey ?? undefined });
  const built = useMemo(() => buildField(form), [form]);
  const error = keyProblem ?? built.error ?? commandError;
  const renaming = originalKey !== null && form.key !== originalKey;

  const save = () => {
    if (!built.field || keyProblem) return;
    const field = built.field;
    try {
      if (originalKey === null) {
        session.store.apply('Add field', (doc) => addDataField(doc, field));
      } else {
        session.store.apply('Edit field', (doc) => {
          const renamed = renaming ? renameDataField(doc, originalKey, field.key).document : doc;
          return updateDataField(renamed, field.key, {
            displayName: field.displayName,
            type: field.type,
            required: field.required,
            defaultValue: field.defaultValue,
            description: field.description,
            validation: field.validation,
          });
        });
      }
      session.setUi({ focusedField: field.key });
      onClose();
    } catch (caught) {
      if (caught instanceof EditorCommandError) setCommandError(caught.message);
      else throw caught;
    }
  };

  const numericRules = form.type === 'number' || form.type === 'decimal';

  return (
    <form
      className="space-y-3 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          {originalKey ? 'Edit data field' : 'Add data field'}
        </h2>
        <button
          type="button"
          aria-label="Close"
          className="rounded p-1 hover:bg-slate-100"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Row label="Display name">
          <input
            autoFocus
            data-testid="field-display-name"
            className={panelInputClass}
            value={form.displayName}
            onChange={(event) => {
              const displayName = event.target.value;
              update(
                form.keyTouched
                  ? { displayName }
                  : { displayName, key: suggestFieldKey(displayName) },
              );
            }}
          />
        </Row>
        <Row label="Key" hint="Stable identifier used by bindings, imports and integrations">
          <input
            data-testid="field-key"
            className={`${panelInputClass} font-mono`}
            value={form.key}
            spellCheck={false}
            onChange={(event) => update({ key: event.target.value, keyTouched: true })}
          />
        </Row>
      </div>
      {renaming && usages > 0 ? (
        <p
          data-testid="rename-warning"
          className="rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900"
        >
          This field is used by {usages} design propert{usages === 1 ? 'y' : 'ies'}. Renaming it
          will update all {usages} binding{usages === 1 ? '' : 's'}.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Row
          label="Type"
          hint={
            originalKey && usages > 0 ? (
              <span data-testid="type-locked-hint">Used by artwork — the type cannot change</span>
            ) : undefined
          }
        >
          <select
            data-testid="field-type"
            className={panelInputClass}
            value={form.type}
            disabled={originalKey !== null && usages > 0}
            onChange={(event) =>
              update({
                type: event.target.value as DataFieldType,
                defaultText: '',
                minLength: '',
                maxLength: '',
                pattern: '',
                allowedValues: '',
                min: '',
                max: '',
              })
            }
          >
            {DATA_FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {FIELD_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Row>
        <label className="flex items-end gap-2 pb-1.5 text-xs text-slate-700">
          <input
            type="checkbox"
            data-testid="field-required"
            className="size-3.5 accent-brand-700"
            checked={form.required}
            onChange={(event) => update({ required: event.target.checked })}
          />
          Required
        </label>
      </div>

      <Row
        label="Default value"
        hint={
          form.required && form.defaultText !== ''
            ? 'Records may omit this value; the default is used.'
            : 'Used when a record has no value.'
        }
      >
        {form.type === 'boolean' ? (
          <select
            data-testid="field-default"
            className={panelInputClass}
            value={form.defaultText}
            onChange={(event) => update({ defaultText: event.target.value })}
          >
            <option value="">No default</option>
            <option value="true">Yes (true)</option>
            <option value="false">No (false)</option>
          </select>
        ) : form.type === 'image' ? (
          <select
            data-testid="field-default"
            className={panelInputClass}
            value={form.defaultText}
            onChange={(event) => update({ defaultText: event.target.value })}
          >
            <option value="">No default image</option>
            {images.data?.items.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.filename}
              </option>
            ))}
          </select>
        ) : (
          <input
            data-testid="field-default"
            className={panelInputClass}
            type={form.type === 'date' ? 'date' : form.type === 'url' ? 'url' : 'text'}
            inputMode={
              form.type === 'number' ? 'numeric' : form.type === 'decimal' ? 'decimal' : undefined
            }
            value={form.defaultText}
            onChange={(event) => update({ defaultText: event.target.value })}
          />
        )}
      </Row>

      <Row label="Description">
        <textarea
          data-testid="field-description"
          className={`${panelInputClass} h-12 resize-y py-1`}
          value={form.description}
          onChange={(event) => update({ description: event.target.value })}
        />
      </Row>

      {form.type === 'string' || numericRules ? (
        <fieldset className="space-y-2 rounded border border-slate-200 p-2">
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Validation rules
          </legend>
          {form.type === 'string' ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Row label="Minimum length">
                  <input
                    data-testid="rule-min-length"
                    inputMode="numeric"
                    className={panelInputClass}
                    value={form.minLength}
                    onChange={(event) => update({ minLength: event.target.value })}
                  />
                </Row>
                <Row label="Maximum length">
                  <input
                    data-testid="rule-max-length"
                    inputMode="numeric"
                    className={panelInputClass}
                    value={form.maxLength}
                    onChange={(event) => update({ maxLength: event.target.value })}
                  />
                </Row>
              </div>
              <Row
                label="Pattern"
                hint="The whole value must match, e.g. [A-Z]{2}-\d{4}. Back-references and look-around are not supported."
              >
                <input
                  data-testid="rule-pattern"
                  className={`${panelInputClass} font-mono`}
                  value={form.pattern}
                  spellCheck={false}
                  onChange={(event) => update({ pattern: event.target.value })}
                />
              </Row>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Row label="Minimum">
                <input
                  data-testid="rule-min"
                  inputMode="decimal"
                  className={panelInputClass}
                  value={form.min}
                  onChange={(event) => update({ min: event.target.value })}
                />
              </Row>
              <Row label="Maximum">
                <input
                  data-testid="rule-max"
                  inputMode="decimal"
                  className={panelInputClass}
                  value={form.max}
                  onChange={(event) => update({ max: event.target.value })}
                />
              </Row>
            </div>
          )}
          <Row label="Allowed values" hint="One per line; leave empty to allow any value">
            <textarea
              data-testid="rule-allowed-values"
              className={`${panelInputClass} h-14 resize-y py-1 font-mono`}
              value={form.allowedValues}
              onChange={(event) => update({ allowedValues: event.target.value })}
            />
          </Row>
        </fieldset>
      ) : null}

      {error && (form.displayName !== '' || form.key !== '' || commandError) ? (
        <p
          role="alert"
          data-testid="field-dialog-error"
          className="rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-800"
        >
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="submit"
          data-testid="field-save"
          disabled={error !== null}
          className="rounded bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:bg-slate-300"
        >
          {originalKey ? 'Save field' : 'Add field'}
        </button>
      </div>
    </form>
  );
}
