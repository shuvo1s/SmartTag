'use client';

import {
  createSampleRecord,
  fieldValueToExpression,
  validateDataRecord,
} from '@smarttag/data-core';
import {
  analyzeBindingExpression,
  checkPropertyBinding,
  fieldLookup,
  type BindablePropertyKind,
  type DataSchema,
} from '@smarttag/document-schema';
import {
  EXPRESSION_FUNCTIONS,
  evaluateExpression,
  valueToText,
  type ExpressionValue,
} from '@smarttag/expression-core';
import { cn } from '@smarttag/ui';
import { AlertCircle, Check } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { panelInputClass } from './editor-inputs';
import { usePreviewState } from './editor-session';

function describePreviewValue(value: ExpressionValue): string {
  if (value.type === 'null') return '(no value)';
  if (value.type === 'boolean') return value.value ? 'true (shown)' : 'false (hidden)';
  if (value.type === 'image') return `image ${value.value}`;
  const text = valueToText(value) ?? '';
  return text === '' ? '(empty text)' : text;
}

/**
 * Expression input with field and function insertion, live validation against the data schema and
 * a preview of the result for the current test record (or sample values). The expression is
 * applied to the document only when it is valid — as one undo step — so a half-typed expression
 * never breaks saving; the draft stays visible with its errors until corrected or discarded.
 */
export function ExpressionEditor({
  property,
  kind,
  expression,
  dataSchema,
  disabled,
  onApply,
}: {
  property: string;
  kind: BindablePropertyKind;
  expression: string;
  dataSchema: DataSchema;
  disabled: boolean;
  onApply: (expression: string) => void;
}) {
  const [draft, setDraft] = useState(expression);
  const [shown, setShown] = useState(expression);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const preview = usePreviewState();
  // Follow external changes (undo, rename) unless the user is editing.
  if (!focused && shown !== expression && draft === shown) {
    setShown(expression);
    setDraft(expression);
  }

  const fields = useMemo(() => fieldLookup(dataSchema.fields), [dataSchema]);
  const problems = useMemo(
    () =>
      draft.trim() === ''
        ? [{ message: 'Enter an expression', range: null }]
        : checkPropertyBinding(property, kind, { mode: 'EXPRESSION', expression: draft }, fields),
    [draft, property, kind, fields],
  );
  const valid = problems.length === 0;
  const dirty = draft !== expression;

  const result = useMemo(() => {
    if (!valid) return null;
    const analysis = analyzeBindingExpression(draft, fields);
    if (!analysis.ok) return null;
    const hasTestData = Object.values(preview.record).some(
      (value) => value !== null && value !== '',
    );
    const record = hasTestData ? preview.record : createSampleRecord(dataSchema);
    const normalized = validateDataRecord(dataSchema, record).normalizedRecord;
    const evaluated = evaluateExpression(analysis.ast, {
      fieldValue: (key) => {
        const field = fields.get(key);
        return field ? fieldValueToExpression(field, normalized[key] ?? null) : undefined;
      },
    });
    return { evaluated, source: hasTestData ? 'test data' : 'sample values' };
  }, [valid, draft, fields, preview.record, dataSchema]);

  const apply = () => {
    if (valid && dirty && !disabled) {
      onApply(draft);
      setShown(draft);
    }
  };

  const insert = (text: string) => {
    const element = input.current;
    const start = element?.selectionStart ?? draft.length;
    const end = element?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  return (
    <div className="space-y-1.5" data-testid={`expression-editor-${property}`}>
      <label className="block">
        <span className="sr-only">Expression</span>
        <textarea
          ref={input}
          data-testid={`expression-input-${property}`}
          aria-label="Expression"
          aria-invalid={!valid}
          spellCheck={false}
          className={cn(
            panelInputClass,
            'h-16 resize-y py-1 font-mono text-[11px]',
            valid ? '' : 'border-red-400 focus:border-red-500 focus:ring-red-500',
          )}
          value={draft}
          disabled={disabled}
          placeholder='concat("SIZE: ", size)'
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            apply();
          }}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              apply();
            } else if (event.key === 'Escape') {
              setDraft(expression);
            }
          }}
        />
      </label>
      <div className="flex gap-1">
        <select
          aria-label="Insert field"
          data-testid={`insert-field-${property}`}
          className={cn(panelInputClass, 'text-[11px]')}
          value=""
          disabled={disabled}
          onChange={(event) => event.target.value && insert(event.target.value)}
        >
          <option value="">Insert field…</option>
          {dataSchema.fields.map((field) => (
            <option key={field.key} value={field.key}>
              {field.displayName} ({field.key})
            </option>
          ))}
        </select>
        <select
          aria-label="Insert function"
          data-testid={`insert-function-${property}`}
          className={cn(panelInputClass, 'text-[11px]')}
          value=""
          disabled={disabled}
          onChange={(event) => event.target.value && insert(`${event.target.value}(`)}
        >
          <option value="">Insert function…</option>
          {EXPRESSION_FUNCTIONS.map((fn) => (
            <option key={fn.name} value={fn.name} title={`${fn.description} e.g. ${fn.example}`}>
              {fn.signature}
            </option>
          ))}
        </select>
      </div>
      {!valid ? (
        <ul data-testid={`expression-issues-${property}`} className="space-y-0.5">
          {problems.map((problem, index) => (
            <li
              key={index}
              className="flex items-start gap-1 rounded bg-red-50 px-1.5 py-1 text-[11px] text-red-800"
            >
              <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span>
                {'code' in problem ? (
                  <span className="font-mono text-[10px]">{problem.code} </span>
                ) : null}
                {problem.message}
                {problem.range ? ` (character ${problem.range.start + 1})` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {result ? (
        <p
          data-testid={`expression-preview-${property}`}
          className="rounded bg-slate-50 px-1.5 py-1 text-[11px] text-slate-700"
        >
          <span className="text-slate-500">Preview ({result.source}): </span>
          {result.evaluated.ok ? (
            <span
              className="whitespace-pre-wrap font-medium"
              data-testid={`expression-result-${property}`}
            >
              {describePreviewValue(result.evaluated.value)}
            </span>
          ) : (
            <span className="text-red-700">{result.evaluated.error.message}</span>
          )}
          {result.evaluated.ok && result.evaluated.missingFields.length > 0 ? (
            <span className="block text-amber-700">
              No value for {result.evaluated.missingFields.join(', ')}
            </span>
          ) : null}
        </p>
      ) : null}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-400">
          {dirty
            ? valid
              ? 'Not applied yet · Ctrl/⌘ Enter'
              : 'Fix the expression to apply it'
            : ''}
        </span>
        <button
          type="button"
          data-testid={`expression-apply-${property}`}
          disabled={disabled || !valid || !dirty}
          onMouseDown={(event) => event.preventDefault()}
          onClick={apply}
          className="flex h-6 items-center gap-1 rounded bg-brand-700 px-2 text-[11px] font-medium text-white hover:bg-brand-800 disabled:bg-slate-300"
        >
          <Check className="size-3" /> Apply
        </button>
      </div>
    </div>
  );
}
