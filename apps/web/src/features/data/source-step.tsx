'use client';

import {
  CSV_DELIMITERS,
  CSV_ENCODINGS,
  describeDelimiter,
  type SourceSettings,
} from '@smarttag/import-core';
import type { DataImportDto } from '@smarttag/shared-types';
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
  Select,
  Spinner,
  cn,
} from '@smarttag/ui';
import { useState } from 'react';
import { describeError } from '@/lib/api-client';
import { useImportCommand, useUpdateSourceSettings } from './api';
import { formatBytes, formatCount } from './wizard';

const DELIMITER_VALUE: Record<string, string> = {
  ',': 'comma',
  ';': 'semicolon',
  '\t': 'tab',
  '|': 'pipe',
};
const VALUE_DELIMITER = Object.fromEntries(
  Object.entries(DELIMITER_VALUE).map(([key, value]) => [value, key]),
);

/** Keyed by the import revision in the wizard, so local settings reset after every change. */
export function SourceStep({
  dto,
  canEdit,
  onContinue,
}: {
  dto: DataImportDto;
  canEdit: boolean;
  onContinue: () => void;
}) {
  const [settings, setSettings] = useState<SourceSettings>(dto.sourceSettings);
  const update = useUpdateSourceSettings(dto.id);
  const retry = useImportCommand(dto.id, 'retry');
  const inspecting = dto.status === 'UPLOADED' || dto.status === 'INSPECTING';
  const changed = JSON.stringify(settings) !== JSON.stringify(dto.sourceSettings);
  const failedInspection = dto.status === 'FAILED' && dto.failure?.stage === 'INSPECTION';
  const editable =
    canEdit &&
    !inspecting &&
    dto.status !== 'CANCELLED' &&
    dto.status !== 'FINALIZED' &&
    dto.status !== 'VALIDATING';
  const inspection = dto.inspection;
  const sheet =
    inspection &&
    (settings.format === 'CSV'
      ? inspection.sheets[0]
      : inspection.sheets.find((candidate) => candidate.name === settings.sheetName));

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-1">
        <CardHeader title="Source file" />
        <CardBody className="space-y-4">
          <DescriptionList
            items={[
              {
                term: 'File',
                description: <span data-testid="source-filename">{dto.source.filename}</span>,
              },
              { term: 'Format', description: dto.source.format },
              { term: 'Size', description: formatBytes(dto.source.sizeBytes) },
              {
                term: 'Detected data rows',
                description: (
                  <span data-testid="source-row-count">
                    {dto.dataRowCount === null ? '—' : formatCount(dto.dataRowCount)}
                  </span>
                ),
              },
              { term: 'Columns', description: dto.columns.length || '—' },
              ...(inspection?.csv
                ? [
                    {
                      term: 'Encoding',
                      description: `${inspection.csv.encoding}${inspection.csv.bom ? ' (byte order mark)' : ''}`,
                    },
                    {
                      term: 'Delimiter candidates',
                      description:
                        inspection.csv.delimiterCandidates.map(describeDelimiter).join(', ') ||
                        'single column',
                    },
                  ]
                : []),
              ...(inspection?.workbook
                ? [
                    {
                      term: 'Date system',
                      description: inspection.workbook.date1904 ? '1904 (Mac)' : '1900 (Windows)',
                    },
                  ]
                : []),
            ]}
          />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">SHA-256</p>
            <code className="block break-all font-mono text-xs" data-testid="source-checksum">
              {dto.source.checksumSha256}
            </code>
          </div>

          {settings.format === 'CSV' ? (
            <>
              <Field label="Encoding" hint="A byte order mark in the file always wins.">
                <Select
                  data-testid="source-encoding"
                  disabled={!editable}
                  value={settings.encoding}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      encoding: event.target.value as typeof settings.encoding,
                    })
                  }
                >
                  {CSV_ENCODINGS.map((encoding) => (
                    <option key={encoding} value={encoding}>
                      {encoding}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Delimiter">
                <Select
                  data-testid="source-delimiter"
                  disabled={!editable}
                  value={settings.delimiter ? DELIMITER_VALUE[settings.delimiter] : ''}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      delimiter:
                        (VALUE_DELIMITER[event.target.value] as typeof settings.delimiter) ?? null,
                    })
                  }
                >
                  <option value="">Choose…</option>
                  {CSV_DELIMITERS.map((delimiter) => (
                    <option key={delimiter} value={DELIMITER_VALUE[delimiter]}>
                      {describeDelimiter(delimiter)}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : (
            <Field
              label="Worksheet"
              hint="Choose the sheet with the data; the first sheet is never assumed."
            >
              <Select
                data-testid="source-sheet"
                disabled={!editable}
                value={settings.sheetName ?? ''}
                onChange={(event) =>
                  setSettings({ ...settings, sheetName: event.target.value || null })
                }
              >
                <option value="">Choose a worksheet…</option>
                {inspection?.sheets.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>
                    {candidate.name} — {formatCount(candidate.nonBlankRows)} rows
                    {candidate.visible ? '' : ' (hidden)'}
                    {candidate.issues.some((issue) => issue.severity === 'ERROR')
                      ? ' — unusable'
                      : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field
            label="Header row"
            hint={`One of the first ${sheet?.previewRows.length ?? dto.limits.previewRows} rows.`}
          >
            <Input
              data-testid="source-header-row"
              type="number"
              min={1}
              max={dto.limits.previewRows}
              disabled={!editable}
              value={settings.headerRow}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  headerRow: Math.max(1, Number(event.target.value) || 1),
                })
              }
            />
          </Field>

          {update.error ? <Alert tone="danger">{describeError(update.error)}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              data-testid="apply-source-settings"
              variant={changed ? 'primary' : 'secondary'}
              disabled={!editable || !changed}
              loading={update.isPending}
              onClick={() => update.mutate({ expectedRevision: dto.revision, settings })}
            >
              Apply settings
            </Button>
            <Button
              data-testid="continue-to-mapping"
              disabled={
                changed ||
                inspecting ||
                dto.sourceProblems.length > 0 ||
                dto.columns.length === 0 ||
                failedInspection
              }
              onClick={onContinue}
            >
              Continue to mapping
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader
          title="Source preview"
          description={
            sheet
              ? `Rows 1–${sheet.previewRows.length} of "${sheet.name}". The header row is highlighted.`
              : undefined
          }
        />
        <CardBody className="space-y-3">
          {inspecting ? (
            <div
              className="flex items-center gap-3 text-sm text-slate-700"
              data-testid="inspection-progress"
            >
              <Spinner /> Inspecting the file in the background…
            </div>
          ) : null}
          {dto.failure ? (
            <Alert tone="danger" title="The file could not be read" className="whitespace-pre-line">
              <p data-testid="import-failure" data-code={dto.failure.code}>
                {dto.failure.message}
              </p>
              {dto.failure.retryable && canEdit ? (
                <Button
                  className="mt-2"
                  size="sm"
                  variant="secondary"
                  loading={retry.isPending}
                  data-testid="retry-import"
                  onClick={() => retry.mutate({ expectedRevision: dto.revision })}
                >
                  Retry
                </Button>
              ) : !dto.failure.retryable &&
                failedInspection &&
                dto.failure.code !== 'ENCODING_INVALID' ? (
                <p className="mt-2">Correct the file and upload it again as a new import.</p>
              ) : null}
            </Alert>
          ) : null}
          {dto.sourceProblems.length > 0 && !inspecting ? (
            <Alert tone="warning" title="Source settings needed">
              <ul className="list-disc pl-5" data-testid="source-problems">
                {dto.sourceProblems.map((problem) => (
                  <li key={problem.code + problem.message}>{problem.message}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          {inspection?.issues.map((issue) => (
            <Alert key={issue.code} tone={issue.severity === 'ERROR' ? 'danger' : 'warning'}>
              {issue.message}
            </Alert>
          ))}
          {sheet?.issues.map((issue) => (
            <Alert key={issue.code} tone={issue.severity === 'ERROR' ? 'danger' : 'info'}>
              {issue.message}
            </Alert>
          ))}
          {sheet ? (
            <div className="max-h-[32rem] overflow-auto rounded border border-slate-200">
              <table className="min-w-full text-xs" data-testid="source-preview">
                <tbody>
                  {sheet.previewRows.map((row) => (
                    <tr
                      key={row.rowNumber}
                      data-testid={`source-preview-row-${row.rowNumber}`}
                      className={cn(
                        row.rowNumber === settings.headerRow
                          ? 'bg-brand-50 font-semibold'
                          : row.rowNumber < settings.headerRow
                            ? 'text-slate-400'
                            : '',
                      )}
                    >
                      <td className="sticky left-0 border-r border-slate-200 bg-slate-50 px-2 py-1 text-right font-mono text-slate-500">
                        {row.rowNumber}
                      </td>
                      {Array.from(
                        { length: Math.max(sheet.columnCount, row.cells.length) },
                        (_, index) => {
                          const cell = row.cells[index];
                          return (
                            <td
                              key={index}
                              className="max-w-56 truncate border-r border-slate-100 px-2 py-1"
                              title={cell?.text}
                            >
                              {cell?.text}
                              {cell?.formula ? <Badge className="ml-1">fx</Badge> : null}
                            </td>
                          );
                        },
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !inspecting && !dto.failure ? (
            <p className="text-sm text-slate-500">Choose the worksheet to see its rows.</p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
