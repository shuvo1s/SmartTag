'use client';

import { TEMPLATE_STATUSES, type TemplateStatus } from '@smarttag/shared-types';
import {
  Alert,
  Button,
  Card,
  Input,
  PageHeader,
  Select,
  Spinner,
  buttonStyles,
} from '@smarttag/ui';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { describeError } from '@/lib/api-client';
import { useCan } from '../auth/session';
import { useTemplates } from './api';
import { TemplatesTable } from './templates-table';

const PAGE_SIZE = 20;

export function TemplatesListView() {
  const canCreate = useCan('template:create');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TemplateStatus | ''>('ACTIVE');
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());
  const templates = useTemplates({
    page,
    pageSize: PAGE_SIZE,
    search: deferredSearch || undefined,
    status: status || undefined,
  });

  return (
    <>
      <PageHeader
        title="Templates"
        description="Long-lived designs. Each template keeps an immutable history of versions."
        actions={
          canCreate ? (
            <Link href="/templates/new" className={buttonStyles()}>
              New template
            </Link>
          ) : null
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
          <label className="sr-only" htmlFor="template-search">
            Search templates
          </label>
          <Input
            id="template-search"
            type="search"
            placeholder="Search by name or code"
            className="h-9 max-w-xs"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <label className="sr-only" htmlFor="template-status">
            Status
          </label>
          <Select
            id="template-status"
            className="h-9 w-40"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as TemplateStatus | '');
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {TEMPLATE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value === 'ACTIVE' ? 'Active' : 'Archived'}
              </option>
            ))}
          </Select>
          {templates.isFetching ? <Spinner className="size-4 text-slate-400" /> : null}
        </div>

        {templates.error ? (
          <div className="p-4">
            <Alert tone="danger">{describeError(templates.error)}</Alert>
          </div>
        ) : templates.data ? (
          <>
            <TemplatesTable templates={templates.data.items} />
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
              <span>
                {templates.data.total} template{templates.data.total === 1 ? '' : 's'}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span>
                  Page {templates.data.page} of {templates.data.totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= templates.data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex justify-center p-10 text-brand-700">
            <Spinner />
          </div>
        )}
      </Card>
    </>
  );
}
