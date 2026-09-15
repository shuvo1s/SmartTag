'use client';

import { parseDesignDocument } from '@smarttag/document-schema';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  EmptyState,
  Input,
  PageHeader,
  Spinner,
  Table,
  Td,
  Th,
  buttonStyles,
  cn,
} from '@smarttag/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDeferredValue, useMemo, useState } from 'react';
import { API_BASE_PATH, describeError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useCan } from '../auth/session';
import { useTemplateVersion } from '../templates/api';
import { versionPath } from '../templates/routes';
import {
  useDataImports,
  useDataset,
  useDatasetVersion,
  useDatasets,
  useMappingProfile,
  useMappingProfiles,
  useUpdateMappingProfile,
} from './api';
import { HashValue, ImportStatusBadge, Metric, layerLabel } from './data-ui';
import { RecordsReview } from './records-review';
import { formatBytes, formatCount } from './wizard';

const TABS = [
  { id: 'datasets', label: 'Datasets' },
  { id: 'imports', label: 'Imports' },
  { id: 'profiles', label: 'Mapping profiles' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function DataHomeView() {
  const params = useSearchParams();
  const router = useRouter();
  const canImport = useCan('dataset:create');
  const requested = params.get('tab');
  const tab: TabId = TABS.some((candidate) => candidate.id === requested)
    ? (requested as TabId)
    : 'datasets';

  return (
    <>
      <PageHeader
        title="Data"
        description="Validated production data for exact template versions. Imports turn CSV and Excel files into immutable dataset versions."
        actions={
          canImport ? (
            <Link href="/data-imports/new" className={buttonStyles()} data-testid="new-import">
              Import data
            </Link>
          ) : null
        }
      />
      <div
        role="tablist"
        aria-label="Data"
        className="mb-4 inline-flex rounded-md border border-slate-300 bg-white p-0.5"
      >
        {TABS.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={tab === candidate.id}
            data-testid={`data-tab-${candidate.id}`}
            onClick={() => router.replace(`/datasets?tab=${candidate.id}`)}
            className={cn(
              'rounded px-4 py-1.5 text-sm',
              tab === candidate.id
                ? 'bg-brand-700 text-white'
                : 'text-slate-700 hover:bg-slate-100',
            )}
          >
            {candidate.label}
          </button>
        ))}
      </div>
      {tab === 'datasets' ? (
        <DatasetsTable />
      ) : tab === 'imports' ? (
        <ImportsTable />
      ) : (
        <ProfilesTable />
      )}
    </>
  );
}

function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
      <span>
        Page {page} of {totalPages}
      </span>
      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}

function DatasetsTable() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const deferred = useDeferredValue(search.trim());
  const datasets = useDatasets({ page, pageSize: 25, search: deferred || undefined });
  return (
    <Card>
      <div className="border-b border-slate-200 px-4 py-3">
        <Input
          type="search"
          className="h-9 max-w-xs"
          placeholder="Search datasets"
          aria-label="Search datasets"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>
      {datasets.error ? (
        <Alert tone="danger" className="m-4">
          {describeError(datasets.error)}
        </Alert>
      ) : !datasets.data ? (
        <div className="p-6">
          <Spinner />
        </div>
      ) : datasets.data.items.length === 0 ? (
        <EmptyState
          title="No datasets yet"
          description="Import a CSV or Excel file and save the validated result as a dataset."
        />
      ) : (
        <>
          <Table data-testid="datasets-table">
            <thead>
              <tr>
                <Th>Dataset</Th>
                <Th>Version</Th>
                <Th>Template</Th>
                <Th>Source</Th>
                <Th>Rows</Th>
                <Th>Valid</Th>
                <Th>Warnings</Th>
                <Th>Errors</Th>
                <Th>Status</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {datasets.data.items.map((dataset) => {
                const latest = dataset.latestVersion;
                return (
                  <tr key={dataset.id} data-testid={`dataset-row-${dataset.name}`}>
                    <Td>
                      <Link
                        className="font-medium text-brand-700 hover:underline"
                        href={`/datasets/${dataset.id}`}
                      >
                        {dataset.name}
                      </Link>
                    </Td>
                    <Td>
                      {latest ? (
                        <Link className="hover:underline" href={`/dataset-versions/${latest.id}`}>
                          Version {latest.versionNumber}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>
                      {latest
                        ? `${latest.templateVersion.templateCode} v${latest.templateVersion.versionNumber}`
                        : '—'}
                    </Td>
                    <Td className="max-w-48 truncate">{latest ? latest.source.filename : '—'}</Td>
                    <Td>{latest ? formatCount(latest.rowCount) : '—'}</Td>
                    <Td>{latest ? formatCount(latest.validCount) : '—'}</Td>
                    <Td>{latest ? formatCount(latest.warningCount) : '—'}</Td>
                    <Td>{latest ? formatCount(latest.errorCount) : '—'}</Td>
                    <Td>
                      {latest ? (
                        <Badge tone="success">Finalized</Badge>
                      ) : (
                        <Badge>No versions</Badge>
                      )}
                    </Td>
                    <Td>{formatDateTime(latest?.finalizedAt ?? dataset.createdAt)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pager page={datasets.data.page} totalPages={datasets.data.totalPages} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

function ImportsTable() {
  const [page, setPage] = useState(1);
  const imports = useDataImports({ page, pageSize: 25 });
  return (
    <Card>
      {imports.error ? (
        <Alert tone="danger" className="m-4">
          {describeError(imports.error)}
        </Alert>
      ) : !imports.data ? (
        <div className="p-6">
          <Spinner />
        </div>
      ) : imports.data.items.length === 0 ? (
        <EmptyState title="No imports yet" />
      ) : (
        <>
          <Table data-testid="imports-table">
            <thead>
              <tr>
                <Th>Source</Th>
                <Th>Template</Th>
                <Th>Status</Th>
                <Th>Rows</Th>
                <Th>Errors</Th>
                <Th>Dataset</Th>
                <Th>By</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {imports.data.items.map((item) => (
                <tr key={item.id} data-testid={`import-row-${item.id}`}>
                  <Td className="max-w-56 truncate">
                    <Link
                      className="font-medium text-brand-700 hover:underline"
                      href={`/data-imports/${item.id}`}
                    >
                      {item.source.filename}
                    </Link>
                    <span className="ml-2 text-xs text-slate-500">
                      {item.source.format} · {formatBytes(item.source.sizeBytes)}
                    </span>
                  </Td>
                  <Td>
                    {item.templateVersion.templateCode} v{item.templateVersion.versionNumber}
                  </Td>
                  <Td>
                    <ImportStatusBadge status={item.status} />
                  </Td>
                  <Td>{item.rowCount === null ? '—' : formatCount(item.rowCount)}</Td>
                  <Td>{item.errorCount === null ? '—' : formatCount(item.errorCount)}</Td>
                  <Td>
                    {item.datasetVersion ? (
                      <Link
                        className="hover:underline"
                        href={`/dataset-versions/${item.datasetVersion.id}`}
                      >
                        {item.datasetVersion.datasetName} v{item.datasetVersion.versionNumber}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>{item.createdBy.displayName}</Td>
                  <Td>{formatDateTime(item.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pager page={imports.data.page} totalPages={imports.data.totalPages} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

function ProfilesTable() {
  const profiles = useMappingProfiles();
  return (
    <Card>
      {profiles.error ? (
        <Alert tone="danger" className="m-4">
          {describeError(profiles.error)}
        </Alert>
      ) : !profiles.data ? (
        <div className="p-6">
          <Spinner />
        </div>
      ) : profiles.data.length === 0 ? (
        <EmptyState
          title="No mapping profiles yet"
          description="Save a mapping from an import's review step to reuse it for files with the same columns."
        />
      ) : (
        <Table data-testid="profiles-table">
          <thead>
            <tr>
              <Th>Profile</Th>
              <Th>Status</Th>
              <Th>Revision</Th>
              <Th>Fields</Th>
              <Th>Format</Th>
              <Th>Data schema</Th>
              <Th>Updated</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {profiles.data.map((profile) => (
              <tr key={profile.id}>
                <Td>
                  <Link
                    className="font-medium text-brand-700 hover:underline"
                    href={`/mapping-profiles/${profile.id}`}
                  >
                    {profile.name}
                  </Link>
                </Td>
                <Td>
                  <Badge tone={profile.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {profile.status === 'ACTIVE' ? 'Active' : 'Archived'}
                  </Badge>
                </Td>
                <Td>{profile.currentRevision}</Td>
                <Td>{profile.definition.mapping.entries.length}</Td>
                <Td>{profile.sourceFormat ?? '—'}</Td>
                <Td className="font-mono text-xs">{profile.dataSchemaHash.slice(0, 12)}</Td>
                <Td>{formatDateTime(profile.updatedAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export function DatasetDetailView({ datasetId }: { datasetId: string }) {
  const dataset = useDataset(datasetId);
  const canImport = useCan('dataset:create');
  if (dataset.error) return <Alert tone="danger">{describeError(dataset.error)}</Alert>;
  if (!dataset.data) return <Spinner />;
  const d = dataset.data;
  const latest = d.versions[0];
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/datasets" className="hover:underline">
            Data
          </Link>
        }
        title={d.name}
        description={d.description || undefined}
        actions={
          canImport && latest ? (
            <Link
              className={buttonStyles({ variant: 'secondary' })}
              href={`/data-imports/new?versionId=${latest.templateVersion.id}&datasetId=${d.id}`}
            >
              Import revised data
            </Link>
          ) : null
        }
      />
      <Card>
        <CardHeader
          title="Versions"
          description="Every version is immutable. Corrections are imported as a new version."
        />
        <Table data-testid="dataset-versions-table">
          <thead>
            <tr>
              <Th>Version</Th>
              <Th>Template</Th>
              <Th>Source</Th>
              <Th>Rows</Th>
              <Th>Warnings</Th>
              <Th>Dataset hash</Th>
              <Th>Finalized</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {d.versions.map((version) => (
              <tr key={version.id}>
                <Td>
                  <Link
                    className="font-medium text-brand-700 hover:underline"
                    href={`/dataset-versions/${version.id}`}
                  >
                    Version {version.versionNumber}
                  </Link>
                </Td>
                <Td>
                  {version.templateVersion.templateCode} v{version.templateVersion.versionNumber}
                </Td>
                <Td>{version.source.filename}</Td>
                <Td>{formatCount(version.rowCount)}</Td>
                <Td>{formatCount(version.warningCount)}</Td>
                <Td className="font-mono text-xs">{version.datasetHash.slice(0, 16)}</Td>
                <Td>
                  {formatDateTime(version.finalizedAt)} · {version.finalizedBy.displayName}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}

export function DatasetVersionView({ versionId }: { versionId: string }) {
  const version = useDatasetVersion(versionId);
  const template = useTemplateVersion(version.data?.templateVersion.id ?? null);
  const canReadSource = useCan('dataset:read-source');
  const schema = useMemo(() => {
    if (!template.data) return null;
    const parsed = parseDesignDocument(template.data.document);
    return parsed.valid ? parsed.document.dataSchema : null;
  }, [template.data]);
  if (version.error) return <Alert tone="danger">{describeError(version.error)}</Alert>;
  if (!version.data) return <Spinner />;
  const v = version.data;
  const fieldName = (key: string) =>
    schema?.fields.find((field) => field.key === key)?.displayName ?? key;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/datasets/${v.dataset.id}`} className="hover:underline">
            {v.dataset.name}
          </Link>
        }
        title={
          <span className="inline-flex items-center gap-3">
            Version {v.versionNumber}{' '}
            <Badge tone="success" data-testid="dataset-version-status">
              Finalized · immutable
            </Badge>
          </span>
        }
        description={`${formatCount(v.rowCount)} rows · finalized ${formatDateTime(v.finalizedAt)} by ${v.finalizedBy.displayName}`}
        actions={
          canReadSource && v.sourceFile.status === 'STORED' ? (
            <a
              className={buttonStyles({ variant: 'secondary' })}
              href={`${API_BASE_PATH}/dataset-versions/${v.id}/source`}
              data-testid="download-source"
            >
              Download original file
            </a>
          ) : null
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Rows" value={formatCount(v.rowCount)} testId="version-rows" />
        <Metric label="Valid" value={formatCount(v.validCount)} tone="success" />
        <Metric
          label="Warnings"
          value={formatCount(v.warningCount)}
          tone={v.warningCount ? 'warning' : undefined}
        />
        <Metric label="Errors" value={formatCount(v.errorCount)} />
        <Metric label="Duplicates" value={formatCount(v.duplicateRowCount)} />
        <Metric label="Blank rows skipped" value={formatCount(v.blankRowCount)} />
      </div>
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Provenance" />
          <CardBody className="space-y-4">
            <DescriptionList
              items={[
                {
                  term: 'Template version',
                  description: (
                    <Link
                      className="underline"
                      href={versionPath(v.templateVersion.templateId, v.templateVersion.id)}
                      data-testid="version-template"
                    >
                      {v.templateVersion.templateName} ({v.templateVersion.templateCode}) v
                      {v.templateVersion.versionNumber}
                    </Link>
                  ),
                },
                {
                  term: 'Source file',
                  description: `${v.sourceFile.filename} · ${v.sourceFile.format} · ${formatBytes(v.sourceFile.sizeBytes)}`,
                },
                {
                  term: 'Uploaded',
                  description: `${formatDateTime(v.sourceFile.uploadedAt)} · ${v.sourceFile.uploadedBy.displayName}`,
                },
                {
                  term: 'Mapping profile',
                  description: v.mappingProfile
                    ? `${v.mappingProfile.name} (revision ${v.mappingProfile.revision})`
                    : 'Manual mapping',
                },
                {
                  term: 'Parser',
                  description: `${v.importConfiguration.parser.id} ${v.importConfiguration.parser.version} (${Object.entries(
                    v.importConfiguration.parser.libraries,
                  )
                    .map(([name, value]) => `${name} ${value}`)
                    .join(', ')})`,
                },
                { term: 'Normalization', description: v.importConfiguration.normalizationVersion },
                {
                  term: 'Warnings acknowledged',
                  description: formatDateTime(v.warningsAcknowledgedAt),
                },
              ]}
            />
            <HashValue label="Dataset hash" value={v.datasetHash} testId="dataset-hash" />
            <HashValue label="Records digest" value={v.recordsDigest} />
            <HashValue label="Template version hash" value={v.templateVersion.documentHash} />
            <HashValue label="Data schema hash" value={v.dataSchemaHash} />
            <HashValue
              label="Source file SHA-256"
              value={v.sourceChecksumSha256}
              testId="source-checksum"
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Mapping snapshot"
            description="Exactly the mapping and rules used; later profile changes never alter it."
          />
          <CardBody className="space-y-3">
            <Table data-testid="mapping-snapshot">
              <thead>
                <tr>
                  <Th>Field</Th>
                  <Th>Source column</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {v.mappingSnapshot.entries.map((entry) => (
                  <tr key={entry.field}>
                    <Td>
                      {fieldName(entry.field)}{' '}
                      <span className="text-xs text-slate-500">({entry.field})</span>
                    </Td>
                    <Td>
                      {entry.column.header || 'No header'} — Column{' '}
                      {v.importConfiguration.columns[entry.column.index]?.letter ??
                        entry.column.index + 1}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="text-sm text-slate-600">
              Numbers: decimal “{v.mappingSnapshot.parsing.number.decimalSeparator}”, thousands{' '}
              {v.mappingSnapshot.parsing.number.thousandsSeparator}. Dates:{' '}
              {v.mappingSnapshot.parsing.dateFormat}. True/false:{' '}
              {v.mappingSnapshot.parsing.boolean.trueValues.join('/')} /{' '}
              {v.mappingSnapshot.parsing.boolean.falseValues.join('/')}.
            </p>
            {v.validationSummary.issueCounts.length > 0 ? (
              <ul className="list-disc pl-5 text-sm">
                {v.validationSummary.issueCounts.map((count) => (
                  <li key={`${count.layer}-${count.code}`}>
                    {layerLabel(count.layer)} {count.code}: {formatCount(count.rows)} rows
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
      </div>
      {schema ? (
        <RecordsReview
          scope={{ kind: 'version', id: v.id }}
          templateVersionId={v.templateVersion.id}
          fields={schema.fields}
        />
      ) : template.error ? (
        <Alert tone="danger">{describeError(template.error)}</Alert>
      ) : (
        <Spinner />
      )}
    </>
  );
}

export function MappingProfileView({ profileId }: { profileId: string }) {
  const profile = useMappingProfile(profileId);
  const canManage = useCan('mapping-profile:manage');
  const update = useUpdateMappingProfile(profileId);
  if (profile.error) return <Alert tone="danger">{describeError(profile.error)}</Alert>;
  if (!profile.data) return <Spinner />;
  const p = profile.data;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/datasets?tab=profiles" className="hover:underline">
            Mapping profiles
          </Link>
        }
        title={p.name}
        description={p.description || undefined}
        actions={
          canManage ? (
            <Button
              variant="secondary"
              loading={update.isPending}
              onClick={() =>
                update.mutate({
                  expectedRevision: p.currentRevision,
                  status: p.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE',
                })
              }
            >
              {p.status === 'ACTIVE' ? 'Archive' : 'Reactivate'}
            </Button>
          ) : null
        }
      />
      {update.error ? (
        <Alert tone="danger" className="mb-4">
          {describeError(update.error)}
        </Alert>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title={`Revision ${p.currentRevision}`}
            description={p.status === 'ACTIVE' ? 'Active' : 'Archived — not suggested for imports'}
          />
          <CardBody className="space-y-3">
            <HashValue label="Data schema hash" value={p.dataSchemaHash} />
            <HashValue label="Header signature" value={p.headerSignature} />
            <Table>
              <thead>
                <tr>
                  <Th>Field</Th>
                  <Th>Source header</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {p.definition.mapping.entries.map((entry) => (
                  <tr key={entry.field}>
                    <Td>{entry.field}</Td>
                    <Td>
                      {entry.column.header || '(no header)'} · position {entry.column.index + 1}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="History"
            description="Revisions are immutable; datasets keep the exact mapping they were imported with."
          />
          <Table>
            <thead>
              <tr>
                <Th>Revision</Th>
                <Th>Name</Th>
                <Th>By</Th>
                <Th>When</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {p.revisions.map((revision) => (
                <tr key={revision.revision}>
                  <Td>{revision.revision}</Td>
                  <Td>{revision.name}</Td>
                  <Td>{revision.createdBy.displayName}</Td>
                  <Td>{formatDateTime(revision.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}

/** Used by the template version page: whether importing is possible for this status. */
export function canImportInto(status: string): boolean {
  return status !== 'RETIRED';
}
