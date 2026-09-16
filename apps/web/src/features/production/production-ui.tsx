'use client';

import type { InstanceIssue, InstanceStatus, ProductionJobStatus } from '@smarttag/production-core';
import { Badge, cn, type Tone } from '@smarttag/ui';

const JOB_STATUS: Record<ProductionJobStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  QUEUED: { label: 'Queued', tone: 'info' },
  EXPANDING: { label: 'Expanding', tone: 'info' },
  VALIDATING: { label: 'Validating', tone: 'info' },
  READY: { label: 'Ready', tone: 'success' },
  READY_WITH_WARNINGS: { label: 'Ready with warnings', tone: 'warning' },
  HAS_ERRORS: { label: 'Has errors', tone: 'danger' },
  RELEASED: { label: 'Releasing', tone: 'info' },
  READY_FOR_RENDERING: { label: 'Ready for rendering', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export function JobStatusBadge({ status }: { status: ProductionJobStatus }) {
  return (
    <Badge tone={JOB_STATUS[status].tone} data-testid="job-status" data-status={status}>
      {JOB_STATUS[status].label}
    </Badge>
  );
}

const INSTANCE_STATUS: Record<InstanceStatus, { label: string; tone: Tone }> = {
  VALID: { label: 'Valid', tone: 'success' },
  WARNING: { label: 'Warning', tone: 'warning' },
  ERROR: { label: 'Error', tone: 'danger' },
};

export function InstanceStatusBadge({ status }: { status: InstanceStatus }) {
  return <Badge tone={INSTANCE_STATUS[status].tone}>{INSTANCE_STATUS[status].label}</Badge>;
}

/** "Non-production" is never mistaken for released production. */
export function ProductionModeBadge({ mode }: { mode: 'PRODUCTION' | 'NON_PRODUCTION' }) {
  if (mode === 'PRODUCTION') return null;
  return (
    <Badge tone="warning" data-testid="non-production-badge">
      Non-production
    </Badge>
  );
}

const LAYER_LABELS: Record<string, string> = {
  PRODUCTION: 'Production',
  IMPORT: 'Import',
  DATA: 'Data',
  BINDING: 'Binding',
  OBJECT: 'Artwork',
  LAYOUT: 'Layout',
};

export function instanceLayerLabel(layer: string): string {
  return LAYER_LABELS[layer] ?? layer;
}

/** The issues of one tag: what is wrong, where, and the code behind it. */
export function InstanceIssueList({ issues }: { issues: readonly InstanceIssue[] }) {
  if (issues.length === 0) return <p className="text-sm text-emerald-800">No issues.</p>;
  return (
    <ul className="space-y-2" data-testid="instance-issues">
      {issues.map((issue, index) => (
        <li
          key={index}
          data-testid="instance-issue"
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
            <span>{instanceLayerLabel(issue.layer)}</span>
            <code className="font-mono normal-case">{issue.code}</code>
          </div>
          <p className="mt-1">{issue.message}</p>
        </li>
      ))}
    </ul>
  );
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}
