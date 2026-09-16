'use client';

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
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
import { useDeferredValue, useState } from 'react';
import { describeError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useCan } from '../auth/session';
import { useCreateSequence, useProductionJobs, useSequences } from './api';
import { JobStatusBadge, ProductionModeBadge, formatCount } from './production-ui';

const TABS = [
  { id: 'jobs', label: 'Production jobs' },
  { id: 'sequences', label: 'Serial sequences' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const STATUS_FILTERS = [
  { id: 'all', label: 'All', value: undefined },
  { id: 'open', label: 'In preparation', value: 'DRAFT,QUEUED,EXPANDING,VALIDATING' },
  { id: 'ready', label: 'Ready', value: 'READY,READY_WITH_WARNINGS' },
  { id: 'released', label: 'Released', value: 'RELEASED,READY_FOR_RENDERING' },
  { id: 'attention', label: 'Needs attention', value: 'HAS_ERRORS,FAILED' },
] as const;

export function ProductionHomeView() {
  const params = useSearchParams();
  const router = useRouter();
  const canCreate = useCan('production-job:create');
  const requested = params.get('tab');
  const tab: TabId = TABS.some((candidate) => candidate.id === requested)
    ? (requested as TabId)
    : 'jobs';

  return (
    <>
      <PageHeader
        title="Production"
        description="Batches of tags: one approved template version and one finalized dataset version, expanded into an exact, ordered, hashed set of tags."
        actions={
          canCreate ? (
            <Link
              href="/production/new"
              className={buttonStyles()}
              data-testid="new-production-job"
            >
              New production job
            </Link>
          ) : null
        }
      />
      <nav className="mb-6 flex gap-2" aria-label="Production sections">
        {TABS.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            data-testid={`production-tab-${candidate.id}`}
            aria-current={candidate.id === tab ? 'page' : undefined}
            onClick={() => router.replace(`/production?tab=${candidate.id}`)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm',
              candidate.id === tab
                ? 'border-brand-700 bg-brand-700 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            {candidate.label}
          </button>
        ))}
      </nav>
      {tab === 'jobs' ? <JobsTab /> : <SequencesTab />}
    </>
  );
}

function JobsTab() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]['id']>('all');
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search.trim());
  const status = STATUS_FILTERS.find((candidate) => candidate.id === filter)?.value;
  const jobs = useProductionJobs({
    page,
    pageSize: 20,
    ...(status ? { status } : {}),
    ...(deferred ? { search: deferred } : {}),
  });

  return (
    <Card>
      <CardHeader
        title="Production jobs"
        description="Every job points at exact immutable inputs; released jobs never change."
        actions={
          <Input
            aria-label="Search production jobs"
            placeholder="Job number or name"
            value={search}
            data-testid="job-search"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        }
      />
      <CardBody>
        <div className="mb-4 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              data-testid={`job-filter-${candidate.id}`}
              aria-pressed={candidate.id === filter}
              onClick={() => {
                setFilter(candidate.id);
                setPage(1);
              }}
              className={cn(
                'rounded-full border px-3 py-1 text-sm',
                candidate.id === filter
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              {candidate.label}
            </button>
          ))}
        </div>
        {jobs.error ? <Alert tone="danger">{describeError(jobs.error)}</Alert> : null}
        {!jobs.data ? (
          <Spinner />
        ) : jobs.data.items.length === 0 ? (
          <EmptyState
            title="No production jobs yet"
            description="A production job turns a finalized dataset into the exact tags to produce."
          />
        ) : (
          <>
            <Table data-testid="production-jobs-table">
              <thead>
                <tr>
                  <Th>Job</Th>
                  <Th>Customer</Th>
                  <Th>Template</Th>
                  <Th>Dataset</Th>
                  <Th className="text-right">Tags</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Warnings</Th>
                  <Th>Created</Th>
                  <Th>Released</Th>
                </tr>
              </thead>
              <tbody>
                {jobs.data.items.map((job) => (
                  <tr key={job.id} data-testid={`job-row-${job.jobNumber}`}>
                    <Td>
                      <Link
                        href={`/production/${job.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {job.jobNumber}
                      </Link>
                      <p className="text-xs text-slate-500">{job.name}</p>
                    </Td>
                    <Td>{job.customer?.name ?? '—'}</Td>
                    <Td>
                      {job.templateVersion.templateCode} v{job.templateVersion.versionNumber}
                    </Td>
                    <Td>
                      {job.dataset.name}
                      <span className="text-xs text-slate-500"> v{job.dataset.versionNumber}</span>
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatCount(job.counts.instanceCount)}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <JobStatusBadge status={job.status} />
                        <ProductionModeBadge mode={job.productionMode} />
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatCount(job.counts.warningCount)}
                    </Td>
                    <Td>{formatDateTime(job.createdAt)}</Td>
                    <Td>{job.releasedAt ? formatDateTime(job.releasedAt) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span data-testid="jobs-total">{formatCount(jobs.data.total)} jobs</span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={page >= jobs.data.totalPages}
                  onClick={() => setPage((value) => value + 1)}
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

function SequencesTab() {
  const sequences = useSequences();
  const canManage = useCan('sequence:manage');
  const create = useCreateSequence();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', prefix: '', padding: 8, startValue: 1 });

  return (
    <Card>
      <CardHeader
        title="Serial sequences"
        description="Serial numbers are handed out by the server in reserved ranges. A committed range is never reused, even if a job later fails: a gap is safer than a number printed twice."
        actions={
          canManage ? (
            <Button data-testid="new-sequence" onClick={() => setOpen((value) => !value)}>
              {open ? 'Cancel' : 'New sequence'}
            </Button>
          ) : null
        }
      />
      <CardBody>
        {open ? (
          <form
            className="mb-6 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2"
            data-testid="sequence-form"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate(
                {
                  name: form.name,
                  code: form.code.toUpperCase(),
                  description: '',
                  prefix: form.prefix,
                  suffix: '',
                  padding: form.padding,
                  startValue: form.startValue,
                },
                { onSuccess: () => setOpen(false) },
              );
            }}
          >
            <label className="text-sm">
              Name
              <Input
                required
                value={form.name}
                data-testid="sequence-name"
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label className="text-sm">
              Code
              <Input
                required
                value={form.code}
                data-testid="sequence-code"
                onChange={(event) => setForm({ ...form, code: event.target.value })}
              />
            </label>
            <label className="text-sm">
              Prefix
              <Input
                value={form.prefix}
                data-testid="sequence-prefix"
                onChange={(event) => setForm({ ...form, prefix: event.target.value })}
              />
            </label>
            <label className="text-sm">
              Digits
              <Input
                type="number"
                min={0}
                max={24}
                value={form.padding}
                data-testid="sequence-padding"
                onChange={(event) => setForm({ ...form, padding: Number(event.target.value) })}
              />
            </label>
            <label className="text-sm">
              Starts at
              <Input
                type="number"
                min={1}
                value={form.startValue}
                data-testid="sequence-start"
                onChange={(event) => setForm({ ...form, startValue: Number(event.target.value) })}
              />
            </label>
            <div className="flex items-end">
              <Button type="submit" disabled={create.isPending} data-testid="save-sequence">
                Create sequence
              </Button>
            </div>
            {create.error ? (
              <div className="sm:col-span-2">
                <Alert tone="danger">{describeError(create.error)}</Alert>
              </div>
            ) : null}
          </form>
        ) : null}
        {sequences.error ? <Alert tone="danger">{describeError(sequences.error)}</Alert> : null}
        {!sequences.data ? (
          <Spinner />
        ) : sequences.data.length === 0 ? (
          <EmptyState
            title="No sequences yet"
            description="A sequence hands out the serial numbers printed on tags."
          />
        ) : (
          <Table data-testid="sequences-table">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Code</Th>
                <Th>Next serial</Th>
                <Th className="text-right">Reserved</Th>
                <Th className="text-right">Ranges</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {sequences.data.map((sequence) => (
                <tr key={sequence.id} data-testid={`sequence-row-${sequence.code}`}>
                  <Td>{sequence.name}</Td>
                  <Td>
                    <code className="font-mono text-xs">{sequence.code}</code>
                  </Td>
                  <Td>
                    <code className="font-mono text-xs" data-testid="sequence-next">
                      {sequence.nextSerial}
                    </code>
                  </Td>
                  <Td className="text-right tabular-nums">{formatCount(sequence.reservedCount)}</Td>
                  <Td className="text-right tabular-nums">
                    {formatCount(sequence.reservationCount)}
                  </Td>
                  <Td>{sequence.status === 'ACTIVE' ? 'Active' : 'Archived'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
