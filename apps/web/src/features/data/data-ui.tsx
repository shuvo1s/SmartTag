'use client';

import { describeTarget } from '@smarttag/data-core';
import type { DataImportStatus, RowIssue, RowStatus } from '@smarttag/import-core';
import { Badge, cn, type Tone } from '@smarttag/ui';
import type { ReactNode } from 'react';
import { WIZARD_STEPS, type WizardStepId } from './wizard';

const IMPORT_STATUS: Record<DataImportStatus, { label: string; tone: Tone }> = {
  UPLOADED: { label: 'Uploaded', tone: 'info' },
  INSPECTING: { label: 'Inspecting', tone: 'info' },
  MAPPING_REQUIRED: { label: 'Mapping required', tone: 'warning' },
  READY_TO_VALIDATE: { label: 'Ready to validate', tone: 'info' },
  VALIDATING: { label: 'Validating', tone: 'info' },
  READY: { label: 'Ready', tone: 'success' },
  READY_WITH_WARNINGS: { label: 'Ready with warnings', tone: 'warning' },
  HAS_ERRORS: { label: 'Has errors', tone: 'danger' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  FINALIZED: { label: 'Finalized', tone: 'success' },
};

export function ImportStatusBadge({ status }: { status: DataImportStatus }) {
  return (
    <Badge tone={IMPORT_STATUS[status].tone} data-testid="import-status" data-status={status}>
      {IMPORT_STATUS[status].label}
    </Badge>
  );
}

const ROW_STATUS: Record<RowStatus, { label: string; tone: Tone }> = {
  VALID: { label: 'Valid', tone: 'success' },
  WARNING: { label: 'Warning', tone: 'warning' },
  ERROR: { label: 'Error', tone: 'danger' },
};

export function RowStatusBadge({ status }: { status: RowStatus }) {
  return <Badge tone={ROW_STATUS[status].tone}>{ROW_STATUS[status].label}</Badge>;
}

const LAYER_LABELS: Record<RowIssue['layer'], string> = {
  IMPORT: 'Import',
  DATA: 'Data',
  BINDING: 'Binding',
  OBJECT: 'Artwork',
  LAYOUT: 'Layout',
};

export function layerLabel(layer: string): string {
  return LAYER_LABELS[layer as RowIssue['layer']] ?? layer;
}

/** Row issues, grouped for people: where (field, column or artwork), what, and the code. */
export function RowIssueList({
  issues,
  fieldName,
}: {
  issues: readonly RowIssue[];
  fieldName: (key: string) => string;
}) {
  if (issues.length === 0) {
    return <p className="text-sm text-emerald-800">No issues.</p>;
  }
  return (
    <ul className="space-y-2" data-testid="row-issues">
      {issues.map((issue, index) => (
        <li
          key={index}
          data-testid="row-issue"
          data-code={issue.code}
          data-layer={issue.layer}
          className={cn(
            'rounded border px-3 py-2 text-sm',
            issue.severity === 'ERROR'
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-amber-200 bg-amber-50 text-amber-900',
          )}
        >
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide">
            <span>{issue.severity === 'ERROR' ? 'Error' : 'Warning'}</span>
            <span>·</span>
            <span>{layerLabel(issue.layer)}</span>
            {issue.field ? (
              <>
                <span>·</span>
                <span className="normal-case">{fieldName(issue.field)}</span>
              </>
            ) : null}
            {'column' in issue && issue.column ? (
              <>
                <span>·</span>
                <span className="normal-case">
                  {issue.column.header || 'No header'} — Column {issue.column.letter}
                </span>
              </>
            ) : null}
            <span className="ml-auto font-mono normal-case text-slate-500">{issue.code}</span>
          </div>
          <p className="mt-1">
            {issue.target ? `${describeTarget(issue.target)}: ${issue.message}` : issue.message}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function WizardStepper({
  current,
  available,
  completedIndex,
  onSelect,
}: {
  current: WizardStepId;
  available: ReadonlySet<WizardStepId>;
  completedIndex: number;
  onSelect: (step: WizardStepId) => void;
}) {
  return (
    <nav aria-label="Import steps" className="mb-6">
      <ol className="flex flex-wrap gap-2" data-testid="wizard-steps">
        {WIZARD_STEPS.map((step, index) => {
          const isCurrent = step.id === current;
          const enabled = available.has(step.id) && step.id !== 'upload';
          return (
            <li key={step.id}>
              <button
                type="button"
                data-testid={`wizard-step-${step.id}`}
                aria-current={isCurrent ? 'step' : undefined}
                disabled={!enabled}
                onClick={() => onSelect(step.id)}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm',
                  isCurrent
                    ? 'border-brand-700 bg-brand-700 text-white'
                    : enabled
                      ? 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                      : 'border-slate-200 bg-slate-50 text-slate-400',
                )}
              >
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full text-xs',
                    isCurrent
                      ? 'bg-white/20'
                      : index <= completedIndex
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-200 text-slate-600',
                  )}
                >
                  {index <= completedIndex && !isCurrent ? '✓' : index + 1}
                </span>
                {step.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Metric({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-md border px-4 py-3',
        tone === 'danger'
          ? 'border-red-200 bg-red-50'
          : tone === 'warning'
            ? 'border-amber-200 bg-amber-50'
            : tone === 'success'
              ? 'border-emerald-200 bg-emerald-50'
              : 'border-slate-200 bg-white',
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

export function HashValue({
  label,
  value,
  testId,
}: {
  label: string;
  value: string | null;
  testId?: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <code
        className="mt-0.5 block break-all font-mono text-xs text-slate-800"
        data-testid={testId}
      >
        {value ?? '—'}
      </code>
    </div>
  );
}
