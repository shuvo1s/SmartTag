'use client';

import { SYSTEM_FIELD_KEYS } from '@smarttag/document-schema';
import type { ProductionJobDto } from '@smarttag/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  Th,
  buttonStyles,
  cn,
} from '@smarttag/ui';
import Link from 'next/link';
import { useState } from 'react';
import { describeError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useCan } from '../auth/session';
import { HashValue, Metric } from '../data/data-ui';
import { ValidatedDocumentPreview } from '../document-preview/document-preview';
import { useTemplateVersion } from '../templates/api';
import { versionPath } from '../templates/routes';
import {
  manifestDownloadUrl,
  useCancelJob,
  useConfigureJob,
  useProductionInstance,
  useProductionInstances,
  useProductionJob,
  useProductionManifest,
  useProductionSamples,
  useReleaseJob,
  useRetryJob,
  useSequences,
  useValidateJob,
} from './api';
import {
  InstanceIssueList,
  InstanceStatusBadge,
  JobStatusBadge,
  ProductionModeBadge,
  formatCount,
} from './production-ui';

export function ProductionJobView({ jobId }: { jobId: string }) {
  const job = useProductionJob(jobId);
  if (job.error) return <Alert tone="danger">{describeError(job.error)}</Alert>;
  if (!job.data) return <Spinner />;
  return <JobDetail job={job.data} />;
}

function JobDetail({ job }: { job: ProductionJobDto }) {
  const [selected, setSelected] = useState<number | null>(null);
  const working = ['QUEUED', 'EXPANDING', 'VALIDATING', 'RELEASED'].includes(job.status);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/production" className="hover:underline">
            Production
          </Link>
        }
        title={`${job.jobNumber} — ${job.name}`}
        description={`${job.templateVersion.templateCode} v${job.templateVersion.versionNumber} · ${job.dataset.name} v${job.dataset.versionNumber}`}
        actions={
          <div className="flex items-center gap-2">
            <ProductionModeBadge mode={job.productionMode} />
            <JobStatusBadge status={job.status} />
          </div>
        }
      />

      {job.failure ? (
        <Alert tone="danger" data-testid="job-failure">
          {job.failure.message}
        </Alert>
      ) : null}

      {working ? <ProgressCard job={job} /> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <CountsCard job={job} />
          <ConfigurationCard job={job} />
          {job.counts.instanceCount > 0 ? (
            <InstancesCard job={job} selected={selected} onSelect={setSelected} />
          ) : null}
          {selected !== null ? (
            <InstanceCard job={job} sequence={selected} onSelect={setSelected} />
          ) : null}
        </div>
        <div className="space-y-6">
          <ActionsCard job={job} />
          <ProvenanceCard job={job} />
          {job.manifest ? <ManifestCard job={job} /> : null}
          <HistoryCard job={job} />
        </div>
      </div>
    </>
  );
}

function ProgressCard({ job }: { job: ProductionJobDto }) {
  const percent =
    job.progress.total && job.progress.total > 0
      ? Math.min(100, Math.round((job.progress.processed / job.progress.total) * 100))
      : null;
  return (
    <Card className="mb-6">
      <CardBody>
        <div className="flex items-center justify-between text-sm">
          <span data-testid="job-progress">
            {job.progress.phase === 'RELEASING'
              ? 'Finishing the release'
              : 'Expanding and validating'}
            {' — '}
            {formatCount(job.progress.processed)}
            {job.progress.total ? ` / ${formatCount(job.progress.total)}` : ''} tags
          </span>
          {percent !== null ? <span className="tabular-nums">{percent}%</span> : <Spinner />}
        </div>
        {percent !== null ? (
          <div className="mt-2 h-2 w-full rounded-full bg-slate-200">
            <div className="h-2 rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function CountsCard({ job }: { job: ProductionJobDto }) {
  return (
    <Card>
      <CardHeader
        title="Tags"
        description={
          job.validation?.layoutNote ??
          'Data, bindings, expressions, barcodes, QR codes and image assets are checked for every tag.'
        }
      />
      <CardBody>
        <div className="grid gap-3 sm:grid-cols-4">
          <Metric
            label="Tags"
            value={formatCount(job.counts.instanceCount)}
            testId="job-instances"
          />
          <Metric label="Valid" value={formatCount(job.counts.validCount)} tone="success" />
          <Metric
            label="Warnings"
            value={formatCount(job.counts.warningCount)}
            tone={job.counts.warningCount > 0 ? 'warning' : undefined}
            testId="job-warnings"
          />
          <Metric
            label="Errors"
            value={formatCount(job.counts.errorCount)}
            tone={job.counts.errorCount > 0 ? 'danger' : undefined}
            testId="job-errors"
          />
        </div>
        {job.counts.sourceWarningCount > 0 ? (
          <p className="mt-3 text-sm text-amber-800" data-testid="source-warnings">
            {formatCount(job.counts.sourceWarningCount)} tags come from data records that already
            carried warnings when they were imported.
          </p>
        ) : null}
        {job.validation && job.validation.issueCounts.length > 0 ? (
          <Table className="mt-4" data-testid="job-issue-counts">
            <thead>
              <tr>
                <Th>Issue</Th>
                <Th>Layer</Th>
                <Th className="text-right">Tags</Th>
              </tr>
            </thead>
            <tbody>
              {job.validation.issueCounts.map((issue) => (
                <tr key={`${issue.layer}-${issue.code}`}>
                  <Td>
                    <code className="font-mono text-xs">{issue.code}</code>
                  </Td>
                  <Td>{issue.layer}</Td>
                  <Td className="text-right tabular-nums">{formatCount(issue.instances)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ConfigurationCard({ job }: { job: ProductionJobDto }) {
  const configure = useConfigureJob(job.id);
  const sequences = useSequences({ status: 'ACTIVE' });
  const canConfigure = job.actions.configure;
  const quantity = job.configuration.quantity;

  return (
    <Card>
      <CardHeader
        title="Configuration"
        description="How many tags each record produces, and where their serial numbers come from."
      />
      <CardBody className="space-y-4">
        <Field label="Quantity">
          <Select
            data-testid="quantity-mode"
            disabled={!canConfigure || configure.isPending}
            value={quantity.mode === 'FIELD' ? 'FIELD' : 'ONE_PER_RECORD'}
            onChange={(event) =>
              configure.mutate({
                expectedRevision: job.revision,
                quantity:
                  event.target.value === 'FIELD'
                    ? {
                        mode: 'FIELD',
                        field: job.quantityFields[0]?.key ?? '',
                        whenMissing: 'REFUSE',
                        defaultQuantity: 1,
                      }
                    : { mode: 'ONE_PER_RECORD' },
              })
            }
          >
            <option value="ONE_PER_RECORD">One tag per record</option>
            <option value="FIELD">A quantity from the data</option>
          </Select>
        </Field>

        {quantity.mode === 'FIELD' ? (
          <Field
            label="Quantity field"
            hint="Values must be whole numbers greater than zero; anything else fails that record."
          >
            <Select
              data-testid="quantity-field"
              disabled={!canConfigure || configure.isPending}
              value={quantity.field}
              onChange={(event) =>
                configure.mutate({
                  expectedRevision: job.revision,
                  quantity: {
                    mode: 'FIELD',
                    field: event.target.value,
                    whenMissing: 'REFUSE',
                    defaultQuantity: 1,
                  },
                })
              }
            >
              {job.quantityFields.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {candidate.displayName}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field
          label="Serial numbers"
          hint="Numbers are reserved when the job is released, never before."
        >
          <Select
            data-testid="serial-sequence"
            disabled={!canConfigure || configure.isPending}
            value={job.configuration.serial.enabled ? job.configuration.serial.sequenceId : ''}
            onChange={(event) =>
              configure.mutate({
                expectedRevision: job.revision,
                serial: event.target.value
                  ? { enabled: true, sequenceId: event.target.value }
                  : { enabled: false },
              })
            }
          >
            <option value="">No serial numbers</option>
            {sequences.data?.map((sequence) => (
              <option key={sequence.id} value={sequence.id}>
                {sequence.name} ({sequence.code}) — next {sequence.nextSerial}
              </option>
            ))}
          </Select>
        </Field>

        {job.serialPreview ? (
          <Alert tone="info" data-testid="serial-preview">
            These tags would use {job.serialPreview.first} to {job.serialPreview.last}. Nothing is
            reserved until the job is released.
          </Alert>
        ) : null}

        {job.systemFields.length > 0 ? (
          <p className="text-sm text-slate-600" data-testid="system-fields">
            This artwork prints production values:{' '}
            {job.systemFields
              .map((key) => (key === SYSTEM_FIELD_KEYS.SERIAL ? 'serial number' : key))
              .join(', ')}
            .
          </p>
        ) : null}

        {configure.error ? (
          <Alert tone="danger" data-testid="configure-error">
            {describeError(configure.error)}
          </Alert>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ActionsCard({ job }: { job: ProductionJobDto }) {
  const validate = useValidateJob(job.id);
  const release = useReleaseJob(job.id);
  const cancel = useCancelJob(job.id);
  const retry = useRetryJob(job.id);
  const canRelease = useCan('production-job:release');
  const [acknowledged, setAcknowledged] = useState(false);
  const needsAcknowledgement =
    job.counts.warningCount > 0 && job.configuration.warningPolicy === 'ACKNOWLEDGE';

  return (
    <Card>
      <CardHeader title="Actions" />
      <CardBody className="space-y-3">
        {job.actions.validate ? (
          <Button
            className="w-full"
            data-testid="validate-job"
            disabled={validate.isPending}
            onClick={() => validate.mutate({ expectedRevision: job.revision })}
          >
            {job.counts.instanceCount > 0 ? 'Expand and validate again' : 'Expand and validate'}
          </Button>
        ) : null}

        {job.status === 'FAILED' ? (
          <Button
            className="w-full"
            variant="secondary"
            data-testid="retry-job"
            onClick={() => retry.mutate({ expectedRevision: job.revision })}
          >
            Retry
          </Button>
        ) : null}

        {job.actions.release ? (
          <div className="space-y-2">
            {needsAcknowledgement ? (
              <label className="flex items-start gap-2 text-sm text-amber-900">
                <input
                  type="checkbox"
                  data-testid="acknowledge-warnings"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>
                  This job contains {formatCount(job.counts.warningCount)} tags with warnings and no
                  blocking errors. I reviewed them.
                </span>
              </label>
            ) : null}
            <Button
              className="w-full"
              data-testid="release-job"
              disabled={release.isPending || (needsAcknowledgement && !acknowledged)}
              onClick={() =>
                release.mutate({
                  expectedRevision: job.revision,
                  acknowledgeWarnings: acknowledged,
                })
              }
            >
              Release for production
            </Button>
            <p className="text-xs text-slate-500">
              Releasing reserves the serial numbers and freezes the job. It does not print, impose
              or produce a PDF.
            </p>
          </div>
        ) : job.counts.errorCount > 0 ? (
          <Alert tone="danger" data-testid="release-blocked">
            {formatCount(job.counts.errorCount)} tags have errors. Fix the data or the template and
            validate again; tags are never dropped to make a job releasable.
          </Alert>
        ) : !canRelease && job.status.startsWith('READY') ? (
          <Alert tone="info" data-testid="release-not-permitted">
            Releasing production needs the production release permission.
          </Alert>
        ) : null}

        {job.actions.cancel ? (
          <Button
            className="w-full"
            variant="secondary"
            data-testid="cancel-job"
            onClick={() => cancel.mutate({ expectedRevision: job.revision })}
          >
            Cancel job
          </Button>
        ) : null}

        {[validate.error, release.error, cancel.error, retry.error]
          .filter((error) => error)
          .map((error, index) => (
            <Alert key={index} tone="danger" data-testid="action-error">
              {describeError(error)}
            </Alert>
          ))}
      </CardBody>
    </Card>
  );
}

function ProvenanceCard({ job }: { job: ProductionJobDto }) {
  return (
    <Card>
      <CardHeader title="Exact inputs" description="What this job produces, and nothing else." />
      <CardBody className="space-y-3">
        <DescriptionList
          items={[
            {
              term: 'Template version',
              description: (
                <Link
                  href={versionPath(job.template.id, job.templateVersion.id)}
                  className="text-brand-700 hover:underline"
                >
                  {job.template.code} v{job.templateVersion.versionNumber} (
                  {job.templateVersion.status})
                </Link>
              ),
            },
            {
              term: 'Dataset version',
              description: (
                <Link
                  href={`/dataset-versions/${job.datasetVersion.id}`}
                  className="text-brand-700 hover:underline"
                >
                  {job.dataset.name} v{job.datasetVersion.versionNumber} (
                  {formatCount(job.datasetVersion.rowCount)} records)
                </Link>
              ),
            },
            {
              term: 'Created',
              description: `${formatDateTime(job.createdAt)} by ${job.createdBy.displayName}`,
            },
            {
              term: 'Released',
              description: job.releasedAt
                ? `${formatDateTime(job.releasedAt)} by ${job.releasedBy?.displayName ?? '—'}`
                : 'Not released',
            },
          ]}
        />
        <div className="space-y-2 border-t border-slate-200 pt-3">
          <HashValue
            label="Template version hash"
            value={job.templateVersionHash}
            testId="job-template-hash"
          />
          <HashValue
            label="Dataset hash"
            value={job.datasetVersion.datasetHash}
            testId="job-dataset-hash"
          />
          <HashValue label="Data schema hash" value={job.dataSchemaHash} />
          <HashValue
            label="Instances digest"
            value={job.instancesDigest}
            testId="job-instances-digest"
          />
          <HashValue label="Production job hash" value={job.productionJobHash} testId="job-hash" />
        </div>
        {job.reservation ? (
          <div className="border-t border-slate-200 pt-3 text-sm" data-testid="job-reservation">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Serial numbers
            </p>
            <p className="mt-1">
              {job.reservation.sequenceName} ({job.reservation.sequenceCode}):{' '}
              <code className="font-mono text-xs">{job.reservation.firstSerial}</code> –{' '}
              <code className="font-mono text-xs">{job.reservation.lastSerial}</code>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Reserved for this job for good; these numbers are never reused.
            </p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ManifestCard({ job }: { job: ProductionJobDto }) {
  const manifest = useProductionManifest(job.id, true);
  return (
    <Card>
      <CardHeader
        title="Production manifest"
        description="The machine-readable record of this job, for the rendering phase and for auditing."
      />
      <CardBody className="space-y-3">
        {manifest.data ? (
          <>
            {manifest.data.verified.valid ? (
              <Alert tone="success" data-testid="manifest-verified">
                Verified: the stored file matches its checksum and this job.
              </Alert>
            ) : (
              <Alert tone="danger" data-testid="manifest-invalid">
                {manifest.data.verified.issues.map((issue) => issue.message).join(' ')}
              </Alert>
            )}
            <HashValue
              label="Manifest checksum"
              value={manifest.data.checksumSha256}
              testId="manifest-checksum"
            />
          </>
        ) : (
          <Spinner />
        )}
        <a
          className={buttonStyles({ variant: 'secondary' })}
          href={manifestDownloadUrl(job.id)}
          data-testid="download-manifest"
        >
          Download manifest
        </a>
      </CardBody>
    </Card>
  );
}

function HistoryCard({ job }: { job: ProductionJobDto }) {
  return (
    <Card>
      <CardHeader title="History" />
      <CardBody>
        <ol className="space-y-3 text-sm" data-testid="job-history">
          {job.events.map((event) => (
            <li key={event.id} className="border-l-2 border-slate-200 pl-3">
              <p className="font-medium text-slate-900">{event.type}</p>
              <p className="text-slate-600">{event.message}</p>
              <p className="text-xs text-slate-400">
                {formatDateTime(event.createdAt)}
                {event.createdBy ? ` · ${event.createdBy.displayName}` : ''}
              </p>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

const PAGE_SIZE = 25;

function InstancesCard({
  job,
  selected,
  onSelect,
}: {
  job: ProductionJobDto;
  selected: number | null;
  onSelect: (sequence: number) => void;
}) {
  const [cursor, setCursor] = useState<number[]>([]);
  const [status, setStatus] = useState<'VALID' | 'WARNING' | 'ERROR' | undefined>();
  const [search, setSearch] = useState('');
  const after = cursor.at(-1);
  const instances = useProductionInstances(job.id, {
    page: 1,
    pageSize: PAGE_SIZE,
    ...(status ? { status } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(after ? { afterSequence: after } : {}),
  });
  const samples = useProductionSamples(job.id, job.counts.instanceCount > 0);

  return (
    <Card>
      <CardHeader
        title="Tags"
        description="In production order: record by record, copy by copy."
        actions={
          <Input
            aria-label="Search tags"
            placeholder="Serial or row"
            value={search}
            data-testid="instance-search"
            onChange={(event) => {
              setSearch(event.target.value);
              setCursor([]);
            }}
          />
        }
      />
      <CardBody>
        {samples.data && samples.data.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="instance-samples">
            <span className="text-xs uppercase tracking-wide text-slate-500">Preview samples:</span>
            {samples.data.map((sample) => (
              <button
                key={sample.sequence}
                type="button"
                title={sample.reason}
                data-testid={`sample-${sample.sequence}`}
                onClick={() => onSelect(sample.sequence)}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
              >
                {sample.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mb-3 flex flex-wrap gap-2">
          {[
            { id: undefined, label: 'All' },
            { id: 'VALID' as const, label: 'Valid' },
            { id: 'WARNING' as const, label: 'Warnings' },
            { id: 'ERROR' as const, label: 'Errors' },
          ].map((filter) => (
            <button
              key={filter.label}
              type="button"
              data-testid={`instance-filter-${filter.id ?? 'all'}`}
              aria-pressed={status === filter.id}
              onClick={() => {
                setStatus(filter.id);
                setCursor([]);
              }}
              className={cn(
                'rounded-full border px-3 py-1 text-sm',
                status === filter.id
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {instances.error ? <Alert tone="danger">{describeError(instances.error)}</Alert> : null}
        {!instances.data ? (
          <Spinner />
        ) : (
          <>
            <Table data-testid="instances-table">
              <thead>
                <tr>
                  <Th className="text-right">Tag</Th>
                  <Th className="text-right">Record</Th>
                  <Th className="text-right">Row</Th>
                  <Th className="text-right">Copy</Th>
                  <Th>Serial</Th>
                  <Th>Status</Th>
                  <Th>Hash</Th>
                </tr>
              </thead>
              <tbody>
                {instances.data.items.map((instance) => (
                  <tr
                    key={instance.sequence}
                    data-testid={`instance-row-${instance.sequence}`}
                    className={cn(
                      'cursor-pointer hover:bg-slate-50',
                      selected === instance.sequence && 'bg-brand-50',
                    )}
                    onClick={() => onSelect(instance.sequence)}
                  >
                    <Td className="text-right tabular-nums">{instance.sequence}</Td>
                    <Td className="text-right tabular-nums">{instance.datasetRecordSequence}</Td>
                    <Td className="text-right tabular-nums">{instance.sourceRowNumber}</Td>
                    <Td className="text-right tabular-nums">
                      {instance.copyIndex} / {instance.copies}
                    </Td>
                    <Td>
                      <code className="font-mono text-xs">{instance.serial ?? '—'}</code>
                    </Td>
                    <Td>
                      <InstanceStatusBadge status={instance.status} />
                    </Td>
                    <Td>
                      <code className="font-mono text-xs">
                        {instance.instanceHash ? `${instance.instanceHash.slice(0, 12)}…` : '—'}
                      </code>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span data-testid="instances-total">{formatCount(instances.data.total)} tags</span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  data-testid="instances-previous"
                  disabled={cursor.length === 0}
                  onClick={() => setCursor((value) => value.slice(0, -1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  data-testid="instances-next"
                  disabled={instances.data.nextCursor === null}
                  onClick={() =>
                    setCursor((value) =>
                      instances.data?.nextCursor ? [...value, instances.data.nextCursor] : value,
                    )
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function InstanceCard({
  job,
  sequence,
  onSelect,
}: {
  job: ProductionJobDto;
  sequence: number;
  onSelect: (sequence: number) => void;
}) {
  const instance = useProductionInstance(job.id, sequence);
  const version = useTemplateVersion(job.templateVersion.id);
  const [showPreview, setShowPreview] = useState(true);

  return (
    <Card data-testid="instance-detail">
      <CardHeader
        title={`Tag ${sequence}`}
        description="One physical tag: the data record it prints, the values production adds, and how it was checked."
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              data-testid="instance-previous"
              disabled={!instance.data?.previousSequence}
              onClick={() =>
                instance.data?.previousSequence && onSelect(instance.data.previousSequence)
              }
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              data-testid="instance-next"
              disabled={!instance.data?.nextSequence}
              onClick={() => instance.data?.nextSequence && onSelect(instance.data.nextSequence)}
            >
              Next
            </Button>
          </div>
        }
      />
      <CardBody className="space-y-4">
        {!instance.data ? (
          <Spinner />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <InstanceStatusBadge status={instance.data.status} />
              {instance.data.serial ? (
                <Badge tone="info" data-testid="instance-serial">
                  {instance.data.serial}
                </Badge>
              ) : (
                <span className="text-xs text-slate-500">
                  Serial numbers are allocated when the job is released.
                </span>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <HashValue label="Resolved input hash" value={instance.data.resolvedInputHash} />
              <HashValue
                label="Instance hash"
                value={instance.data.instanceHash}
                testId="instance-hash"
              />
            </div>

            <InstanceIssueList issues={instance.data.issues} />
            {instance.data.recordIssues.length > 0 ? (
              <div data-testid="source-record-issues">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                  From the imported data
                </p>
                <InstanceIssueList issues={instance.data.recordIssues} />
              </div>
            ) : null}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Preview
                </p>
                <button
                  type="button"
                  className="text-xs text-brand-700 hover:underline"
                  onClick={() => setShowPreview((value) => !value)}
                >
                  {showPreview ? 'Hide' : 'Show'}
                </button>
              </div>
              {showPreview ? (
                version.data ? (
                  <div data-testid="instance-preview">
                    <ValidatedDocumentPreview
                      document={version.data.document}
                      record={instance.data.record}
                      systemValues={{
                        [SYSTEM_FIELD_KEYS.SERIAL]: instance.data.context.serial,
                        [SYSTEM_FIELD_KEYS.INSTANCE_INDEX]: instance.data.context.instanceIndex,
                        [SYSTEM_FIELD_KEYS.COPY_INDEX]: instance.data.context.copyIndex,
                        [SYSTEM_FIELD_KEYS.SOURCE_ROW]: instance.data.context.sourceRow,
                        [SYSTEM_FIELD_KEYS.JOB_NUMBER]: instance.data.context.jobNumber,
                      }}
                      layoutChecks
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      Layout (text overflow, missing glyphs) is checked here, in the browser, for
                      this tag only — the server checks data, bindings, barcodes and assets for
                      every tag.
                    </p>
                  </div>
                ) : (
                  <Spinner />
                )
              ) : null}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
