'use client';

import type { FieldValidationResult, TestValue } from '@smarttag/data-core';
import type { DataField } from '@smarttag/document-schema';
import { cn } from '@smarttag/ui';
import { AlertCircle, AlertTriangle, CheckCircle2, Eye } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { FIELD_TYPE_LABELS, IssueList, RequiredBadge } from './data-ui';
import { useAssetsById, usePlaceableAssets } from './editor-api';
import { panelInputClass } from './editor-inputs';
import { useEditorSession, useEditorState, useEditorUi, usePreviewState } from './editor-session';

/**
 * One sample record for Data preview, entered with controls that match each field type. Test data
 * is editor context only: it is never saved with the template and never changes its hash.
 */
export function TestDataPanel() {
  const session = useEditorSession();
  const document = useEditorState((state) => state.document);
  const preview = usePreviewState();
  const focused = useEditorUi((ui) => ui.focusedField);
  const [jsonOpen, setJsonOpen] = useState(false);
  const result = useMemo(() => {
    void preview.version;
    return session.preview.compute(document);
  }, [session, document, preview.version]);

  const { summary } = result;
  const fieldResult = (key: string): FieldValidationResult | undefined =>
    summary.fields.find((field) => field.key === key);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="test-data-panel">
      <div className="space-y-2 border-b border-slate-200 p-2">
        {preview.mode !== 'DATA' ? (
          <button
            type="button"
            data-testid="enable-data-preview"
            onClick={() => session.preview.setMode('DATA')}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-sky-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-800"
          >
            <Eye className="size-3.5" /> Show test data on the artwork
          </button>
        ) : null}
        <div
          data-testid="data-validation-summary"
          className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Data validation
          </p>
          <p className="text-[11px] text-slate-700">
            <span data-testid="summary-checked">{summary.fieldsChecked}</span> fields checked
          </p>
          <div className="mt-0.5 flex gap-3 text-[11px]">
            <span className="flex items-center gap-1 text-green-700">
              <CheckCircle2 className="size-3" aria-hidden />
              <span data-testid="summary-valid">{summary.valid}</span> valid
            </span>
            <span className="flex items-center gap-1 text-amber-700">
              <AlertTriangle className="size-3" aria-hidden />
              <span data-testid="summary-warnings">{summary.warnings}</span> warning
              {summary.warnings === 1 ? '' : 's'}
            </span>
            <span className="flex items-center gap-1 text-red-700">
              <AlertCircle className="size-3" aria-hidden />
              <span data-testid="summary-errors">{summary.errors}</span> error
              {summary.errors === 1 ? '' : 's'}
            </span>
          </div>
          <p
            data-testid="production-valid"
            data-valid={result.productionValid}
            className={cn(
              'mt-0.5 text-[10px]',
              result.productionValid ? 'text-green-700' : 'text-red-700',
            )}
          >
            {result.productionValid
              ? 'No blocking issues for this record'
              : 'This record has blocking issues'}
          </p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            data-testid="fill-sample"
            onClick={() => session.preview.fillSample(document)}
            className="flex-1 rounded border border-slate-300 px-1.5 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
          >
            Fill sample values
          </button>
          <button
            type="button"
            data-testid="clear-test-data"
            onClick={() => session.preview.replaceRecord({})}
            className="rounded border border-slate-300 px-1.5 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
          >
            Clear
          </button>
          <button
            type="button"
            data-testid="test-data-json-toggle"
            aria-pressed={jsonOpen}
            onClick={() => setJsonOpen(!jsonOpen)}
            className={cn(
              'rounded border border-slate-300 px-1.5 py-1 text-[11px] hover:bg-slate-100',
              jsonOpen ? 'bg-slate-200 text-slate-900' : 'text-slate-700',
            )}
          >
            JSON
          </button>
        </div>
        {jsonOpen ? <JsonRecordEditor record={preview.record} /> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="divide-y divide-slate-100" aria-label="Test data values">
          {document.dataSchema.fields.map((field) => (
            <TestValueRow
              key={field.key}
              field={field}
              value={preview.record[field.key] ?? null}
              result={fieldResult(field.key)}
              source={result.record.fields.find((status) => status.key === field.key)?.source}
              focused={focused === field.key}
            />
          ))}
        </ul>
        {document.dataSchema.fields.length === 0 ? (
          <p className="p-3 text-xs text-slate-500">Add data fields to enter test data.</p>
        ) : null}
        {result.issues.length > 0 ? (
          <div className="border-t border-slate-200 p-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Issues · {result.issues.length}
            </p>
            <IssueList issues={result.issues} session={session} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Loads image assets named by the test record so previews show them and foreign ids fail. */
export function useImageAvailability(
  fields: readonly DataField[],
  record: Readonly<Record<string, TestValue>>,
) {
  const session = useEditorSession();
  const ids = fields
    .filter((field) => field.type === 'image')
    .map((field) => record[field.key])
    .filter(
      (value): value is string =>
        typeof value === 'string' &&
        /^[0-9a-f-]{36}$/i.test(value) &&
        !session.assets.has(value.toLowerCase()),
    )
    .map((value) => value.toLowerCase());
  const assets = useAssetsById(ids);
  useEffect(() => {
    if (!assets.data) return;
    session.registerAssets(assets.data);
    session.markAssetsUnavailable(ids.filter((id, index) => assets.data[index] === null));
    // ids are derived from the record; the query result is the trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets.data, session]);
}

function StateIcon({ result }: { result: FieldValidationResult | undefined }) {
  if (result?.state === 'ERROR') {
    return <AlertCircle className="size-3.5 shrink-0 text-red-600" aria-label="Error" />;
  }
  if (result?.state === 'WARNING') {
    return <AlertTriangle className="size-3.5 shrink-0 text-amber-600" aria-label="Warning" />;
  }
  return <CheckCircle2 className="size-3.5 shrink-0 text-green-600" aria-label="Valid" />;
}

function TestValueRow({
  field,
  value,
  result,
  source,
  focused,
}: {
  field: DataField;
  value: TestValue;
  result: FieldValidationResult | undefined;
  source: 'RECORD' | 'DEFAULT' | 'NONE' | undefined;
  focused: boolean;
}) {
  const session = useEditorSession();
  const set = (next: TestValue) => session.preview.setValue(field.key, next);
  const inputId = `test-input-${field.key}`;
  const firstIssue = result?.issues[0];

  return (
    <li
      data-testid={`test-row-${field.key}`}
      data-state={result?.state ?? 'VALID'}
      className={cn('space-y-1 px-2 py-1.5', focused ? 'bg-brand-50' : '')}
    >
      <div className="flex items-center gap-1.5">
        <StateIcon result={result} />
        <label
          htmlFor={inputId}
          className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-800"
        >
          {field.displayName}
        </label>
        {field.required ? <RequiredBadge /> : null}
        <span className="text-[10px] text-slate-400">{FIELD_TYPE_LABELS[field.type]}</span>
      </div>
      <TestValueInput field={field} id={inputId} value={value} onChange={set} />
      {source === 'DEFAULT' ? (
        <p className="text-[10px] text-slate-500">Using the default value</p>
      ) : null}
      {firstIssue ? (
        <p
          data-testid={`test-field-issue-${field.key}`}
          data-code={firstIssue.code}
          className={cn(
            'text-[10px]',
            firstIssue.severity === 'ERROR' ? 'text-red-700' : 'text-amber-700',
          )}
        >
          {firstIssue.message}
        </p>
      ) : null}
    </li>
  );
}

function TestValueInput({
  field,
  id,
  value,
  onChange,
}: {
  field: DataField;
  id: string;
  value: TestValue;
  onChange: (value: TestValue) => void;
}) {
  const text = value === null ? '' : String(value);
  const common = { id, 'data-testid': id, className: panelInputClass };
  switch (field.type) {
    case 'boolean':
      return (
        <select
          {...common}
          value={value === true ? 'true' : value === false ? 'false' : ''}
          onChange={(event) =>
            onChange(event.target.value === '' ? null : event.target.value === 'true')
          }
        >
          <option value="">— no value —</option>
          <option value="true">Yes (true)</option>
          <option value="false">No (false)</option>
        </select>
      );
    case 'image':
      return <ImageValueInput id={id} value={text} onChange={onChange} />;
    case 'date':
      return (
        <input
          {...common}
          type="date"
          value={text}
          onChange={(event) => onChange(event.target.value || null)}
        />
      );
    case 'url':
      return (
        <input
          {...common}
          type="url"
          placeholder="https://"
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'number':
    case 'decimal':
      // Text entry keeps exactly what was typed ("39.90"); validation decides whether it is a number.
      return (
        <input
          {...common}
          type="text"
          inputMode={field.type === 'number' ? 'numeric' : 'decimal'}
          placeholder={field.type === 'decimal' ? '0.00' : '0'}
          className={cn(panelInputClass, 'tabular-nums')}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'string':
      return (
        <input
          {...common}
          type="text"
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

function ImageValueInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: TestValue) => void;
}) {
  const assets = usePlaceableAssets('', '');
  const items = assets.data?.items ?? [];
  const known = value === '' || items.some((asset) => asset.id === value);
  return (
    <select
      id={id}
      data-testid={id}
      className={panelInputClass}
      value={value}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">— no image —</option>
      {!known ? <option value={value}>Asset {value}</option> : null}
      {items.map((asset) => (
        <option key={asset.id} value={asset.id}>
          {asset.filename}
        </option>
      ))}
    </select>
  );
}

function JsonRecordEditor({ record }: { record: Readonly<Record<string, TestValue>> }) {
  const session = useEditorSession();
  const [text, setText] = useState(() => JSON.stringify(record, null, 2));
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setError('The test record must be a JSON object');
        return;
      }
      // Used as parsed: JSON.parse keeps keys such as "__proto__" as plain own properties, which
      // the shared validator reports; nothing is merged into existing objects.
      session.preview.replaceRecord(parsed as Readonly<Record<string, TestValue>>);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Invalid JSON');
    }
  };
  return (
    <div className="space-y-1">
      <label htmlFor="test-data-json" className="sr-only">
        Test record JSON
      </label>
      <textarea
        id="test-data-json"
        data-testid="test-data-json"
        spellCheck={false}
        className={cn(panelInputClass, 'h-40 resize-y py-1 font-mono text-[11px]')}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-[11px] text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        data-testid="apply-test-json"
        onClick={apply}
        className="w-full rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-900"
      >
        Use this record
      </button>
    </div>
  );
}
