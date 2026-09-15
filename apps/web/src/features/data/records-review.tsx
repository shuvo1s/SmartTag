'use client';

import type { DataField } from '@smarttag/document-schema';
import type { RowStatus } from '@smarttag/import-core';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Spinner,
  Table,
  Td,
  Th,
  cn,
} from '@smarttag/ui';
import { useDeferredValue, useMemo, useState } from 'react';
import { describeError } from '@/lib/api-client';
import { ValidatedDocumentPreview } from '../document-preview/document-preview';
import { useTemplateVersion } from '../templates/api';
import { useRecord, useRecords, type RecordScope } from './api';
import { RowIssueList, RowStatusBadge } from './data-ui';
import { formatCount } from './wizard';

const PAGE_SIZE = 50;
type Filter = 'ALL' | RowStatus | 'DUPLICATES';

const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'VALID', label: 'Valid' },
  { id: 'WARNING', label: 'Warnings' },
  { id: 'ERROR', label: 'Errors' },
  { id: 'DUPLICATES', label: 'Duplicates' },
];

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

/**
 * Server-paginated row review (never all rows in the DOM) with status filters, search, issue
 * details and a visual preview of the selected row rendered by the Phase 3 resolver and renderer.
 */
export function RecordsReview({
  scope,
  templateVersionId,
  fields,
}: {
  scope: RecordScope;
  templateVersionId: string;
  fields: readonly DataField[];
}) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const query = {
    status: filter === 'VALID' || filter === 'WARNING' || filter === 'ERROR' ? filter : undefined,
    duplicates: filter === 'DUPLICATES' ? ('true' as const) : undefined,
    search: deferredSearch || undefined,
  };
  const records = useRecords(scope, { ...query, page, pageSize: PAGE_SIZE });
  const record = useRecord(scope, selected, query);
  const fieldNames = useMemo(
    () => new Map(fields.map((field) => [field.key, field.displayName])),
    [fields],
  );
  const fieldName = (key: string) => fieldNames.get(key) ?? key;
  // The first string fields identify a row for people.
  const primary = fields.filter((field) => field.type === 'string').slice(0, 3);

  const counts = records.data?.counts;
  const countFor = (id: Filter) =>
    !counts
      ? null
      : id === 'ALL'
        ? counts.all
        : id === 'VALID'
          ? counts.valid
          : id === 'WARNING'
            ? counts.warning
            : id === 'ERROR'
              ? counts.error
              : counts.duplicates;

  return (
    <div className="grid gap-6 2xl:grid-cols-5">
      <Card className="2xl:col-span-3">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div
            role="tablist"
            aria-label="Row filter"
            className="inline-flex rounded-md border border-slate-300 bg-white p-0.5"
          >
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                data-testid={`row-filter-${item.id.toLowerCase()}`}
                onClick={() => {
                  setFilter(item.id);
                  setPage(1);
                  setSelected(null);
                }}
                className={cn(
                  'rounded px-3 py-1 text-sm',
                  filter === item.id
                    ? 'bg-brand-700 text-white'
                    : 'text-slate-700 hover:bg-slate-100',
                )}
              >
                {item.label}
                {countFor(item.id) !== null ? (
                  <span className="ml-1 opacity-75">{formatCount(countFor(item.id)!)}</span>
                ) : null}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="row-search">
            Search rows
          </label>
          <Input
            id="row-search"
            data-testid="row-search"
            type="search"
            className="h-9 max-w-xs"
            placeholder="Search values or row number"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        {records.error ? (
          <Alert tone="danger" className="m-4">
            {describeError(records.error)}
          </Alert>
        ) : !records.data ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : (
          <>
            <Table data-testid="records-table">
              <thead>
                <tr>
                  <Th>Row</Th>
                  <Th>Status</Th>
                  {primary.map((field) => (
                    <Th key={field.key}>{field.displayName}</Th>
                  ))}
                  <Th>Errors</Th>
                  <Th>Warnings</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.data.items.map((item) => (
                  <tr
                    key={item.sequence}
                    data-testid={`record-row-${item.rowNumber}`}
                    data-status={item.status}
                    className={cn(
                      'cursor-pointer hover:bg-slate-50',
                      selected === item.sequence && 'bg-brand-50',
                    )}
                    onClick={() => setSelected(item.sequence)}
                  >
                    <Td className="font-mono">
                      {item.rowNumber}
                      {item.duplicateOf ? (
                        <span
                          className="ml-2 text-xs text-slate-500"
                          title={`Same data as row ${item.duplicateOf.rowNumber}`}
                        >
                          duplicate
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <RowStatusBadge status={item.status} />
                    </Td>
                    {primary.map((field) => (
                      <Td key={field.key} className="max-w-48 truncate">
                        {displayValue(item.record[field.key])}
                      </Td>
                    ))}
                    <Td>{item.errorCount || '—'}</Td>
                    <Td>{item.warningCount || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {records.data.items.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No rows match.</p>
            ) : null}
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
              <span data-testid="records-total">
                {formatCount(records.data.total)} rows · page {records.data.page} of{' '}
                {records.data.totalPages}
              </span>
              <span className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= records.data.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </span>
            </div>
          </>
        )}
      </Card>

      <div className="space-y-6 2xl:col-span-2">
        <Card data-testid="row-inspector">
          <CardHeader
            title={record.data ? `Row ${record.data.record.rowNumber}` : 'Row details'}
            description={
              record.data ? undefined : 'Select a row to see its values, issues and preview.'
            }
            actions={
              record.data ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="row-previous"
                    disabled={record.data.previousSequence === null}
                    onClick={() => setSelected(record.data.previousSequence)}
                  >
                    ← Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="row-next"
                    disabled={record.data.nextSequence === null}
                    onClick={() => setSelected(record.data.nextSequence)}
                  >
                    Next →
                  </Button>
                </>
              ) : null
            }
          />
          {record.data ? (
            <CardBody className="space-y-4">
              <div className="flex items-center gap-2">
                <RowStatusBadge status={record.data.record.status} />
                {record.data.record.duplicateOf ? (
                  <span className="text-xs text-slate-600">
                    Same normalized data as row {record.data.record.duplicateOf.rowNumber} (kept;
                    never removed)
                  </span>
                ) : null}
              </div>
              <RowIssueList issues={record.data.record.issues} fieldName={fieldName} />
              <details>
                <summary className="cursor-pointer text-sm font-medium text-brand-700">
                  Normalized values
                </summary>
                <dl
                  className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm"
                  data-testid="row-values"
                >
                  {fields.map((field) => (
                    <div key={field.key} className="contents">
                      <dt className="text-slate-500">{field.displayName}</dt>
                      <dd
                        className="break-all font-mono text-xs text-slate-900"
                        data-testid={`row-value-${field.key}`}
                      >
                        {displayValue(record.data.record.record[field.key])}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            </CardBody>
          ) : null}
        </Card>
        {record.data ? (
          <RowPreview
            templateVersionId={templateVersionId}
            record={record.data.record.record}
            rowNumber={record.data.record.rowNumber}
          />
        ) : null}
      </div>
    </div>
  );
}

function RowPreview({
  templateVersionId,
  record,
  rowNumber,
}: {
  templateVersionId: string;
  record: Readonly<Record<string, unknown>>;
  rowNumber: number;
}) {
  const version = useTemplateVersion(templateVersionId);
  return (
    <Card data-testid="row-preview">
      <CardHeader
        title={`Preview — row ${rowNumber}`}
        description="Visual/layout preview of this row only, rendered with the template's fonts. Server validation checks data, bindings, barcodes and assets for every row; text overflow is checked here for previewed rows."
      />
      <CardBody>
        {version.error ? (
          <Alert tone="danger">{describeError(version.error)}</Alert>
        ) : !version.data ? (
          <Spinner />
        ) : (
          <ValidatedDocumentPreview document={version.data.document} record={record} layoutChecks />
        )}
      </CardBody>
    </Card>
  );
}
