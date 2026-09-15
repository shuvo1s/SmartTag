'use client';

import type { DataSchema } from '@smarttag/document-schema';
import type { DataImportDto } from '@smarttag/shared-types';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Table,
  Td,
  Textarea,
  Th,
  buttonStyles,
} from '@smarttag/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { describeError } from '@/lib/api-client';
import { useCan } from '../auth/session';
import { useCreateMappingProfile, useDatasets, useFinalizeImport, useImportCommand } from './api';
import { Metric, layerLabel } from './data-ui';
import { RecordsReview } from './records-review';
import { formatCount, progressPercent } from './wizard';

export function ValidateStep({ dto, canEdit }: { dto: DataImportDto; canEdit: boolean }) {
  const validate = useImportCommand(dto.id, 'validate');
  const retry = useImportCommand(dto.id, 'retry');
  const validating = dto.status === 'VALIDATING';
  const percent = progressPercent(dto.progress.processedRows, dto.progress.totalRows);
  const canStart = ['READY_TO_VALIDATE', 'READY', 'READY_WITH_WARNINGS', 'HAS_ERRORS'].includes(
    dto.status,
  );

  return (
    <Card>
      <CardHeader
        title="Validate"
        description="Every row is read with the mapping and rules, then validated by the same engine as the designer's test data: field types and rules, bindings and expressions, barcodes, QR codes and image assets."
      />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric
            label="Data rows"
            value={dto.dataRowCount === null ? '—' : formatCount(dto.dataRowCount)}
          />
          <Metric label="Mapped fields" value={dto.mappingValidation?.mappedFields.length ?? 0} />
          <Metric
            label="Ignored columns"
            value={dto.mappingValidation?.ignoredColumns.length ?? 0}
          />
        </div>
        {dto.templateVersion.changedSinceImport ? (
          <Alert tone="danger">
            The template version was edited after this import started. Start a new import for the
            current design.
          </Alert>
        ) : null}
        {validating ? (
          <div data-testid="validation-progress" aria-live="polite">
            <p className="text-sm font-medium text-slate-800">Validating</p>
            <p className="text-sm text-slate-700" data-testid="validation-progress-text">
              {formatCount(dto.progress.processedRows)}
              {dto.progress.totalRows !== null
                ? ` / ${formatCount(dto.progress.totalRows)}`
                : ''}{' '}
              rows
              {percent !== null ? ` · ${percent}%` : ''}
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200">
              <div
                className="h-full bg-brand-700 transition-all"
                style={{ width: `${percent ?? 5}%` }}
              />
            </div>
          </div>
        ) : null}
        {dto.failure?.stage === 'VALIDATION' ? (
          <Alert tone="danger" title="Validation failed">
            <p data-testid="import-failure" data-code={dto.failure.code}>
              {dto.failure.message}
            </p>
            {dto.failure.retryable && canEdit ? (
              <Button
                className="mt-2"
                size="sm"
                variant="secondary"
                data-testid="retry-import"
                loading={retry.isPending}
                onClick={() => retry.mutate({ expectedRevision: dto.revision })}
              >
                Retry validation
              </Button>
            ) : null}
          </Alert>
        ) : null}
        {validate.error ? <Alert tone="danger">{describeError(validate.error)}</Alert> : null}
        <Button
          data-testid="start-validation"
          disabled={!canEdit || !canStart || validating}
          loading={validate.isPending || validating}
          onClick={() => validate.mutate({ expectedRevision: dto.revision })}
        >
          {dto.validation
            ? 'Validate again'
            : `Validate ${dto.dataRowCount === null ? '' : formatCount(dto.dataRowCount)} rows`}
        </Button>
      </CardBody>
    </Card>
  );
}

export function ReviewStep({
  dto,
  schema,
  canEdit,
  onChangeMapping,
  onContinue,
}: {
  dto: DataImportDto;
  schema: DataSchema;
  canEdit: boolean;
  onChangeMapping: () => void;
  onContinue: () => void;
}) {
  const canManageProfiles = useCan('mapping-profile:manage');
  const createProfile = useCreateMappingProfile();
  const [profileName, setProfileName] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const validation = dto.validation;
  if (!validation) return <Alert tone="info">Validation results are not available yet.</Alert>;
  const { summary } = validation;
  const fieldName = (key: string) =>
    schema.fields.find((field) => field.key === key)?.displayName ?? key;
  const columnLabel = (index: number) => {
    const column = dto.columns[index];
    return column
      ? `${column.header || 'No header'} — Column ${column.letter}`
      : `Column ${index + 1}`;
  };

  return (
    <div className="space-y-6">
      <Card data-testid="validation-summary">
        <CardHeader
          title="Validation summary"
          actions={
            <>
              {canEdit && dto.status !== 'FINALIZED' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="change-mapping"
                  onClick={onChangeMapping}
                >
                  Change mapping
                </Button>
              ) : null}
              {canManageProfiles && dto.mapping ? (
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="save-profile"
                  onClick={() => setProfileOpen(true)}
                >
                  Save as mapping profile
                </Button>
              ) : null}
              {dto.status !== 'HAS_ERRORS' ? (
                <Button size="sm" data-testid="continue-to-save" onClick={onContinue}>
                  {dto.status === 'FINALIZED' ? 'View dataset' : 'Continue to save'}
                </Button>
              ) : null}
            </>
          }
        />
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Rows" value={formatCount(validation.rowCount)} testId="summary-rows" />
            <Metric
              label="Valid"
              value={formatCount(validation.validCount)}
              tone="success"
              testId="summary-valid"
            />
            <Metric
              label="Warnings"
              value={formatCount(validation.warningCount)}
              tone={validation.warningCount ? 'warning' : undefined}
              testId="summary-warnings"
            />
            <Metric
              label="Errors"
              value={formatCount(validation.errorCount)}
              tone={validation.errorCount ? 'danger' : undefined}
              testId="summary-errors"
            />
            <Metric
              label="Duplicates"
              value={formatCount(validation.duplicateRowCount)}
              testId="summary-duplicates"
            />
            <Metric
              label="Blank rows skipped"
              value={formatCount(validation.blankRowCount)}
              testId="summary-blank"
            />
          </div>
          {profileOpen ? (
            <div className="rounded border border-slate-200 p-3" data-testid="profile-dialog">
              <Field
                label="Profile name"
                hint="Saved for this organization; reusable for files with the same columns and data schema."
              >
                <Input
                  data-testid="profile-name"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                />
              </Field>
              {createProfile.error ? (
                <Alert tone="danger" className="mt-2">
                  {describeError(createProfile.error)}
                </Alert>
              ) : null}
              {createProfile.data ? (
                <Alert tone="success" className="mt-2">
                  <span data-testid="profile-saved">
                    Saved “{createProfile.data.name}” (revision {createProfile.data.currentRevision}
                    ).
                  </span>
                </Alert>
              ) : (
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    data-testid="confirm-save-profile"
                    disabled={!profileName.trim()}
                    loading={createProfile.isPending}
                    onClick={() =>
                      createProfile.mutate({ name: profileName.trim(), importId: dto.id })
                    }
                  >
                    Save profile
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setProfileOpen(false)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-3 text-sm">
            <div>
              <p className="font-medium text-slate-800">
                Mapped fields ({summary.mappedFields.length})
              </p>
              <p className="text-slate-600" data-testid="summary-mapped-fields">
                {summary.mappedFields.map(fieldName).join(', ') || '—'}
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-800">
                Ignored source columns ({summary.ignoredColumns.length})
              </p>
              <p className="text-slate-600">
                {summary.ignoredColumns.map((column) => columnLabel(column.index)).join(', ') ||
                  '—'}
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-800">Unmapped required fields</p>
              <p className="text-slate-600" data-testid="summary-unmapped-required">
                {summary.unmappedRequiredFields.map(fieldName).join(', ') || 'None'}
              </p>
            </div>
          </div>
          {summary.issueCounts.length > 0 ? (
            <Table data-testid="issue-counts">
              <thead>
                <tr>
                  <Th>Issue</Th>
                  <Th>Layer</Th>
                  <Th>Severity</Th>
                  <Th>Rows</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.issueCounts.map((count) => (
                  <tr
                    key={`${count.layer}-${count.code}-${count.severity}`}
                    data-testid={`issue-count-${count.code}`}
                  >
                    <Td className="font-mono text-xs">{count.code}</Td>
                    <Td>{layerLabel(count.layer)}</Td>
                    <Td>{count.severity === 'ERROR' ? 'Error' : 'Warning'}</Td>
                    <Td>{formatCount(count.rows)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
          <Alert tone="info" title="Data validation and layout preview">
            Server validation checked data, bindings and expressions, barcodes, QR codes and image
            assets for all {formatCount(validation.rowCount)} rows. Text overflow needs the
            production fonts and is checked in the preview of each row you open; it has not been
            checked for every row.
          </Alert>
        </CardBody>
      </Card>
      <RecordsReview
        scope={{ kind: 'import', id: dto.id }}
        templateVersionId={dto.templateVersion.id}
        fields={schema.fields}
      />
    </div>
  );
}

export function SaveStep({ dto }: { dto: DataImportDto }) {
  const router = useRouter();
  const canFinalize = useCan('dataset:finalize');
  const finalize = useFinalizeImport(dto.id);
  const datasets = useDatasets({ page: 1, pageSize: 100 });
  const [mode, setMode] = useState<'NEW' | 'EXISTING'>(dto.targetDataset ? 'EXISTING' : 'NEW');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [datasetId, setDatasetId] = useState(dto.targetDataset?.id ?? '');
  const [acknowledged, setAcknowledged] = useState(false);
  const validation = dto.validation;

  if (dto.status === 'FINALIZED' && dto.finalizedVersion) {
    return (
      <Alert tone="success" title="Dataset version saved">
        <Link
          className={buttonStyles({ size: 'sm' })}
          href={`/dataset-versions/${dto.finalizedVersion.id}`}
          data-testid="open-dataset-version"
        >
          Open {dto.finalizedVersion.datasetName} — Version {dto.finalizedVersion.versionNumber}
        </Link>
      </Alert>
    );
  }
  if (!validation || dto.status === 'HAS_ERRORS') {
    return (
      <Alert tone="danger" title="This data cannot be saved as a dataset">
        <p data-testid="finalize-blocked">
          {validation
            ? `${formatCount(validation.errorCount)} rows have errors.`
            : 'The import has not been validated.'}{' '}
          Rows are never dropped: correct the source file and upload it again, or change the mapping
          or rules and validate again.
        </p>
      </Alert>
    );
  }
  const warnings = validation.warningCount;
  const ready = mode === 'NEW' ? name.trim().length > 0 : datasetId !== '';

  return (
    <Card>
      <CardHeader
        title="Save dataset"
        description={`Creates an immutable dataset version with ${formatCount(validation.rowCount)} rows for ${dto.templateVersion.templateName} version ${dto.templateVersion.versionNumber}.`}
      />
      <CardBody className="max-w-2xl space-y-4">
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="dataset-mode"
              data-testid="dataset-mode-new"
              checked={mode === 'NEW'}
              onChange={() => setMode('NEW')}
            />
            New dataset
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="dataset-mode"
              data-testid="dataset-mode-existing"
              checked={mode === 'EXISTING'}
              onChange={() => setMode('EXISTING')}
            />
            New version of an existing dataset
          </label>
        </div>
        {mode === 'NEW' ? (
          <>
            <Field label="Dataset name" required>
              <Input
                data-testid="dataset-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
              />
            </Field>
            <Field label="Description">
              <Textarea
                data-testid="dataset-description"
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
              />
            </Field>
          </>
        ) : (
          <Field label="Dataset">
            <Select
              data-testid="dataset-select"
              value={datasetId}
              onChange={(event) => setDatasetId(event.target.value)}
            >
              <option value="">Choose a dataset…</option>
              {datasets.data?.items.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name} (next: version {dataset.versionCount + 1})
                </option>
              ))}
            </Select>
          </Field>
        )}
        {warnings > 0 ? (
          <Alert tone="warning" title={`This dataset contains ${formatCount(warnings)} warnings.`}>
            <p>No blocking errors were found.</p>
            <label className="mt-2 flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                data-testid="acknowledge-warnings"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I reviewed the warnings and want to save this dataset version
            </label>
          </Alert>
        ) : (
          <Alert tone="success">No warnings and no errors.</Alert>
        )}
        {finalize.error ? <Alert tone="danger">{describeError(finalize.error)}</Alert> : null}
        {!canFinalize ? (
          <Alert tone="info">Saving datasets requires the data operator role.</Alert>
        ) : null}
        <Button
          data-testid="finalize-dataset"
          disabled={!canFinalize || !ready || (warnings > 0 && !acknowledged)}
          loading={finalize.isPending}
          onClick={() =>
            finalize.mutate(
              {
                expectedRevision: dto.revision,
                acknowledgeWarnings: acknowledged,
                dataset:
                  mode === 'NEW'
                    ? { mode, name: name.trim(), description: description.trim() }
                    : { mode, datasetId },
              },
              { onSuccess: (version) => router.push(`/dataset-versions/${version.id}`) },
            )
          }
        >
          Save dataset version
        </Button>
      </CardBody>
    </Card>
  );
}
