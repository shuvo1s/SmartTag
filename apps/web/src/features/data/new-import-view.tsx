'use client';

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  PageHeader,
  Select,
  Spinner,
} from '@smarttag/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { describeError } from '@/lib/api-client';
import { useCan } from '../auth/session';
import { useTemplateVersion, useTemplateVersions, useTemplates } from '../templates/api';
import { useDatasets, useUploadImport } from './api';
import { WizardStepper } from './data-ui';
import { formatBytes } from './wizard';

const ACCEPT =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Step 1 of the import wizard: an exact template version and a CSV or XLSX file. */
export function NewImportView() {
  const router = useRouter();
  const params = useSearchParams();
  const canCreate = useCan('dataset:create');
  const [templateId, setTemplateId] = useState('');
  const [chosenVersionId, setChosenVersionId] = useState(params.get('versionId') ?? '');
  const [datasetId, setDatasetId] = useState(params.get('datasetId') ?? '');
  const [file, setFile] = useState<File | null>(null);
  const preselected = useTemplateVersion(params.get('versionId'));
  const templates = useTemplates({ page: 1, pageSize: 100, status: 'ACTIVE' });
  const versions = useTemplateVersions(templateId || preselected.data?.templateId || '');
  const datasets = useDatasets({ page: 1, pageSize: 100 });
  const upload = useUploadImport();
  const effectiveTemplateId = templateId || preselected.data?.templateId || '';

  if (!canCreate) {
    return <Alert tone="info">Importing data requires permission to create datasets.</Alert>;
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/datasets" className="hover:underline">
            Data
          </Link>
        }
        title="Import data"
        description="Bring production data from a CSV file or an Excel workbook into one exact template version. Nothing is saved as a dataset until you validate, review and confirm."
      />
      <WizardStepper
        current="upload"
        available={new Set(['upload'])}
        completedIndex={-1}
        onSelect={() => undefined}
      />
      <Card className="max-w-3xl">
        <CardHeader title="Upload" />
        <CardBody className="space-y-4">
          <Field label="Template" required>
            <Select
              data-testid="import-template"
              value={effectiveTemplateId}
              onChange={(event) => {
                setTemplateId(event.target.value);
                setChosenVersionId('');
              }}
            >
              <option value="">Choose a template…</option>
              {templates.data?.items.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Template version"
            required
            hint="Imports always target an exact version: its data schema and hash are recorded with the dataset."
          >
            <Select
              data-testid="import-version"
              value={chosenVersionId}
              onChange={(event) => setChosenVersionId(event.target.value)}
              disabled={!effectiveTemplateId}
            >
              <option value="">Choose a version…</option>
              {versions.data
                ?.filter((version) => version.status !== 'RETIRED')
                .map((version) => (
                  <option key={version.id} value={version.id}>
                    Version {version.versionNumber} —{' '}
                    {version.status.toLowerCase().replace('_', ' ')} —{' '}
                    {version.summary.dataFieldCount} data fields
                  </option>
                ))}
            </Select>
          </Field>
          <Field
            label="Dataset (optional)"
            hint="Pre-select an existing dataset to add a new version to; you can also choose when saving."
          >
            <Select
              data-testid="import-dataset"
              value={datasetId}
              onChange={(event) => setDatasetId(event.target.value)}
            >
              <option value="">Decide later</option>
              {datasets.data?.items.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="File"
            required
            hint="CSV (.csv) or Excel workbook (.xlsx). Legacy .xls, macro-enabled and binary workbooks are not supported."
          >
            <input
              data-testid="import-file"
              type="file"
              accept={ACCEPT}
              className="block w-full text-sm"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          {file ? (
            <p className="text-sm text-slate-600">
              {file.name} · {formatBytes(file.size)}
            </p>
          ) : null}
          {upload.error ? (
            <Alert tone="danger" title="Upload refused">
              <span data-testid="upload-error">{describeError(upload.error)}</span>
            </Alert>
          ) : null}
          {preselected.isLoading ? <Spinner /> : null}
          <Button
            data-testid="start-import"
            disabled={!chosenVersionId || !file}
            loading={upload.isPending}
            onClick={() =>
              file &&
              upload.mutate(
                { versionId: chosenVersionId, file, targetDatasetId: datasetId || null },
                { onSuccess: (dto) => router.push(`/data-imports/${dto.id}`) },
              )
            }
          >
            Upload and inspect
          </Button>
        </CardBody>
      </Card>
    </>
  );
}
