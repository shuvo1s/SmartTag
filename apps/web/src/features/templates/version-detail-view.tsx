'use client';

import { formatDimensions } from '@smarttag/document-utils';
import { canEditVersionContent } from '@smarttag/shared-types';
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  PageHeader,
  Spinner,
  buttonStyles,
} from '@smarttag/ui';
import Link from 'next/link';
import { describeError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useSession } from '../auth/session';
import { ValidatedDocumentPreview } from '../document-preview/document-preview';
import { useTemplate, useTemplateVersion } from './api';
import { designerPath } from './routes';
import { VersionStatusBadge } from './status-badges';

export function VersionDetailView({
  templateId,
  versionId,
}: {
  templateId: string;
  versionId: string;
}) {
  const template = useTemplate(templateId);
  const version = useTemplateVersion(versionId);
  const session = useSession();

  if (version.error ?? template.error) {
    return <Alert tone="danger">{describeError(version.error ?? template.error)}</Alert>;
  }
  if (!version.data || !template.data) {
    return <Spinner />;
  }
  const v = version.data;
  const editable = canEditVersionContent(v.status, session.permissions);
  const canImport =
    session.permissions.includes('dataset:create') &&
    v.status !== 'RETIRED' &&
    v.summary.dataFieldCount > 0;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/templates/${templateId}`} className="hover:underline">
            {template.data.name}
          </Link>
        }
        title={
          <span className="inline-flex items-center gap-3">
            Version {v.versionNumber} <VersionStatusBadge status={v.status} />
          </span>
        }
        description={v.changeSummary || undefined}
        actions={
          <span className="flex gap-2">
            {canImport ? (
              <Link
                href={`/data-imports/new?versionId=${v.id}`}
                data-testid="import-data"
                className={buttonStyles({ variant: 'secondary' })}
              >
                Import data
              </Link>
            ) : null}
            <Link
              href={`/developer/playground?versionId=${v.id}`}
              className={buttonStyles({ variant: 'secondary' })}
            >
              Open in playground
            </Link>
            <Link
              href={designerPath(templateId, v.id)}
              data-testid="open-designer"
              className={buttonStyles({ variant: editable ? 'primary' : 'secondary' })}
            >
              {editable ? 'Edit in designer' : 'Open designer (view only)'}
            </Link>
          </span>
        }
      />

      {v.status !== 'DRAFT' ? (
        <Alert tone="info" className="mb-4">
          This version is {v.status.toLowerCase().replace('_', ' ')} and its content is immutable.
          Create a new version to make changes.
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader title="Version record" />
          <CardBody>
            <DescriptionList
              items={[
                { term: 'Schema version', description: v.schemaVersion },
                { term: 'Revision', description: v.revision },
                {
                  term: 'Trim size',
                  description: formatDimensions(
                    v.summary.widthPt,
                    v.summary.heightPt,
                    v.summary.displayUnit,
                  ),
                },
                { term: 'Pages', description: v.summary.pageCount },
                {
                  term: 'Created',
                  description: `${formatDateTime(v.createdAt)} · ${v.createdBy.displayName}`,
                },
                { term: 'Submitted', description: formatDateTime(v.submittedAt) },
                {
                  term: 'Approved',
                  description: v.approvedAt
                    ? `${formatDateTime(v.approvedAt)} · ${v.approvedBy?.displayName ?? ''}`
                    : '—',
                },
                { term: 'Retired', description: formatDateTime(v.retiredAt) },
                {
                  term: 'Bound data fields',
                  description: v.summary.boundFieldKeys.join(', ') || '—',
                },
              ]}
            />
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Document hash (SHA-256, RFC 8785)
              </p>
              <code className="mt-1 block break-all font-mono text-xs text-slate-800">
                {v.documentHash}
              </code>
            </div>
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Preview" />
          <CardBody>
            <ValidatedDocumentPreview document={v.document} />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Canonical document JSON"
          description="Exactly as stored. This is the authoritative representation of the design."
        />
        <CardBody>
          <details>
            <summary className="cursor-pointer text-sm font-medium text-brand-700">
              Show JSON
            </summary>
            <pre className="mt-3 max-h-[32rem] overflow-auto rounded bg-slate-900 p-4 text-xs text-slate-100">
              {JSON.stringify(v.document, null, 2)}
            </pre>
          </details>
        </CardBody>
      </Card>
    </>
  );
}
