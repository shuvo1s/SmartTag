'use client';

import { describeTarget, type DataIssue } from '@smarttag/data-core';
import type { DataFieldType } from '@smarttag/document-schema';
import { cn } from '@smarttag/ui';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import type { EditorSession } from './editor-session';

export const FIELD_TYPE_LABELS: Readonly<Record<DataFieldType, string>> = {
  string: 'Text',
  number: 'Number',
  decimal: 'Decimal',
  boolean: 'Yes/No',
  date: 'Date',
  url: 'URL',
  image: 'Image',
};

export function FieldTypeBadge({ type }: { type: DataFieldType }) {
  return (
    <span
      className="rounded bg-slate-100 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-slate-600"
      data-field-type={type}
    >
      {FIELD_TYPE_LABELS[type]}
    </span>
  );
}

export function RequiredBadge() {
  return (
    <span className="rounded bg-rose-50 px-1 py-px text-[10px] font-medium text-rose-700">
      Required
    </span>
  );
}

const LAYER_LABELS: Readonly<Record<DataIssue['layer'], string>> = {
  DATA: 'Data',
  BINDING: 'Binding',
  OBJECT: 'Object',
  LAYOUT: 'Layout',
};

/** Selects the artwork an issue refers to (switching pages) or highlights its data field. */
export function revealIssue(session: EditorSession, issue: DataIssue): void {
  if (issue.target) {
    session.store.setActivePage(issue.target.pageId);
    session.store.setSelection([issue.target.objectId]);
    if (session.getUi().leftPanel !== 'data') session.setUi({ leftPanel: 'data' });
  }
  if (issue.field) session.setUi({ focusedField: issue.field });
}

/**
 * Structured issues grouped by severity, each naming its layer, field or artwork property.
 * Reusable for any single-record validation (Test Data now, imported rows later).
 */
export function IssueList({
  issues,
  session,
  testId = 'preview-issues',
  limit = 50,
}: {
  issues: readonly DataIssue[];
  session: EditorSession;
  testId?: string;
  limit?: number;
}) {
  if (issues.length === 0) return null;
  const ordered = [
    ...issues.filter((issue) => issue.severity === 'ERROR'),
    ...issues.filter((issue) => issue.severity === 'WARNING'),
  ];
  return (
    <ul className="space-y-1" data-testid={testId}>
      {ordered.slice(0, limit).map((issue, index) => {
        const Icon = issue.severity === 'ERROR' ? AlertCircle : AlertTriangle;
        return (
          <li key={index}>
            <button
              type="button"
              data-testid="preview-issue"
              data-code={issue.code}
              data-layer={issue.layer}
              data-severity={issue.severity}
              onClick={() => revealIssue(session, issue)}
              className={cn(
                'flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-slate-100',
                issue.severity === 'ERROR' ? 'text-red-800' : 'text-amber-800',
              )}
            >
              <Icon className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="font-semibold">{LAYER_LABELS[issue.layer]}</span>
                {issue.target ? (
                  <span className="text-slate-500"> · {describeTarget(issue.target)}</span>
                ) : issue.field ? (
                  <span className="font-mono text-slate-500"> · {issue.field}</span>
                ) : null}
                <span className="block text-slate-700">{issue.message}</span>
              </span>
            </button>
          </li>
        );
      })}
      {ordered.length > limit ? (
        <li className="px-1.5 text-[11px] text-slate-500">
          {ordered.length - limit} more issues not shown
        </li>
      ) : null}
    </ul>
  );
}

/** Quotes text as an expression string literal. */
export function expressionStringLiteral(text: string): string {
  const escaped = text
    .split(String.fromCharCode(92))
    .join(String.fromCharCode(92, 92))
    .replace(/"/g, String.fromCharCode(92) + '"')
    .replace(/\n/g, String.fromCharCode(92) + 'n')
    .replace(/\t/g, String.fromCharCode(92) + 't');
  return `"${escaped}"`;
}
