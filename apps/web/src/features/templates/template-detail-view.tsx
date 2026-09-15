'use client';

import {
  DOCUMENT_TYPE_DEFINITIONS,
  formatDimensions,
  formatLength,
} from '@smarttag/document-utils';
import { canEditVersionContent } from '@smarttag/shared-types';
import {
  Alert,
  Button,
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
import { formatDateTime, shortHash } from '@/lib/format';
import { useSession } from '../auth/session';
import { ValidatedDocumentPreview } from '../document-preview/document-preview';
import {
  useCreateVersion,
  useTemplate,
  useTemplateVersion,
  useTemplateVersions,
  useTransitionVersion,
  useUpdateTemplate,
} from './api';
import { designerPath } from './routes';
import { TemplateStatusBadge, VersionStatusBadge } from './status-badges';
import { VersionsTable } from './versions-table';

export function TemplateDetailView({ templateId }: { templateId: string }) {
  const session = useSession();
  const template = useTemplate(templateId);
  const versions = useTemplateVersions(templateId);
  const currentVersion = useTemplateVersion(template.data?.currentVersion?.id ?? null);
  const transition = useTransitionVersion();
  const createVersion = useCreateVersion(templateId);
  const updateTemplate = useUpdateTemplate(templateId);
  const can = (permission: (typeof session.permissions)[number]) =>
    session.permissions.includes(permission);

  if (template.error) {
    return <Alert tone="danger">{describeError(template.error)}</Alert>;
  }
  if (!template.data) {
    return <Spinner />;
  }

  const data = template.data;
  const summary = data.currentVersion?.summary;
  const mutationError = transition.error ?? createVersion.error ?? updateTemplate.error;
  const editableCurrentVersion =
    data.currentVersion && canEditVersionContent(data.currentVersion.status, session.permissions)
      ? data.currentVersion
      : null;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/templates" className="hover:underline">
            Templates
          </Link>
        }
        title={data.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <code className="font-mono text-xs">{data.code}</code>
            <TemplateStatusBadge status={data.status} />
            <span>{DOCUMENT_TYPE_DEFINITIONS[data.documentType].label}</span>
          </span>
        }
        actions={
          <>
            {editableCurrentVersion ? (
              <Link
                href={designerPath(data.id, editableCurrentVersion.id)}
                data-testid="template-edit-in-designer"
                className={buttonStyles({ variant: 'primary' })}
              >
                Edit v{editableCurrentVersion.versionNumber} in designer
              </Link>
            ) : null}
            {data.currentVersion && can('template-version:create') && data.status === 'ACTIVE' ? (
              <Button
                variant="secondary"
                loading={createVersion.isPending}
                onClick={() =>
                  createVersion.mutate({
                    basedOnVersionId: data.currentVersion!.id,
                    changeSummary: `Based on v${data.currentVersion!.versionNumber}`,
                  })
                }
              >
                New version from v{data.currentVersion.versionNumber}
              </Button>
            ) : null}
            {can('template:archive') ? (
              <Button
                variant="secondary"
                loading={updateTemplate.isPending}
                onClick={() =>
                  updateTemplate.mutate({
                    status: data.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE',
                  })
                }
              >
                {data.status === 'ACTIVE' ? 'Archive' : 'Restore'}
              </Button>
            ) : null}
          </>
        }
      />

      {mutationError ? (
        <Alert tone="danger" className="mb-4">
          {describeError(mutationError)}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              items={[
                {
                  term: 'Customer',
                  description: data.customer
                    ? `${data.customer.name} (${data.customer.code})`
                    : '—',
                },
                {
                  term: 'Brand',
                  description: data.brand ? `${data.brand.name} (${data.brand.code})` : '—',
                },
                { term: 'Description', description: data.description || '—' },
                { term: 'Latest version', description: `v${data.latestVersionNumber}` },
                {
                  term: 'Created',
                  description: `${formatDateTime(data.createdAt)} by ${data.createdBy.displayName}`,
                },
                { term: 'Last updated', description: formatDateTime(data.updatedAt) },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Physical format"
            description={
              data.currentVersion ? (
                <>
                  From current version v{data.currentVersion.versionNumber}{' '}
                  <VersionStatusBadge status={data.currentVersion.status} />
                </>
              ) : undefined
            }
          />
          <CardBody>
            {summary ? (
              <DescriptionList
                items={[
                  {
                    term: 'Trim size',
                    description: formatDimensions(
                      summary.widthPt,
                      summary.heightPt,
                      summary.displayUnit,
                    ),
                  },
                  {
                    term: 'Trim size (points)',
                    description: formatDimensions(summary.widthPt, summary.heightPt, 'pt'),
                  },
                  {
                    term: 'Bleed',
                    description: formatLength(summary.bleedPt.top, summary.displayUnit),
                  },
                  {
                    term: 'Safe margin',
                    description: formatLength(summary.safeAreaPt.top, summary.displayUnit),
                  },
                  { term: 'Orientation', description: summary.orientation.toLowerCase() },
                  {
                    term: 'Pages',
                    description: summary.pageSides.map((side) => side.toLowerCase()).join(' + '),
                  },
                  { term: 'Artwork objects', description: summary.objectCount },
                  {
                    term: 'Data fields bound',
                    description: summary.boundFieldKeys.join(', ') || '—',
                  },
                  {
                    term: 'Document hash',
                    description: (
                      <code className="font-mono text-xs" title={data.currentVersion?.documentHash}>
                        {shortHash(data.currentVersion?.documentHash ?? '')}
                      </code>
                    ),
                  },
                ]}
              />
            ) : (
              <p className="text-sm text-slate-500">No version yet.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Versions"
          description="Approved versions are immutable. Changes are made in a new version; production always references an exact version."
        />
        {versions.error ? (
          <CardBody>
            <Alert tone="danger">{describeError(versions.error)}</Alert>
          </CardBody>
        ) : versions.data ? (
          <VersionsTable
            versions={versions.data}
            currentVersionId={data.currentVersion?.id ?? null}
            permissions={session.permissions}
            pendingVersionId={transition.isPending ? transition.variables?.versionId : null}
            onTransition={(versionId, targetStatus) =>
              transition.mutate({ versionId, targetStatus })
            }
          />
        ) : (
          <CardBody>
            <Spinner />
          </CardBody>
        )}
      </Card>

      {data.currentVersion ? (
        <Card className="mt-6">
          <CardHeader
            title={`Preview — v${data.currentVersion.versionNumber}`}
            description="Rendered from the stored canonical document."
            actions={
              <Link
                href={`/developer/playground?versionId=${data.currentVersion.id}`}
                className={buttonStyles({ variant: 'secondary', size: 'sm' })}
              >
                Open in playground
              </Link>
            }
          />
          <CardBody>
            {currentVersion.data ? (
              <ValidatedDocumentPreview document={currentVersion.data.document} />
            ) : (
              <Spinner />
            )}
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
