'use client';

import type { DatasetDetailDto } from '@smarttag/shared-types';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Select,
} from '@smarttag/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { describeError } from '@/lib/api-client';
import { useCan } from '../auth/session';
import { useDataset, useDatasets } from '../data/api';
import { useTemplateVersions, useTemplates } from '../templates/api';
import { useCreateProductionJob } from './api';

/**
 * Step 1 of a production job: choose exactly which artwork and which data to produce. The server
 * checks that the template version is approved, the dataset version finalized, and that both share
 * the same data schema; nothing is created until they fit.
 */
export function NewProductionJobView() {
  const router = useRouter();
  const canCreate = useCan('production-job:create');
  const [templateId, setTemplateId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [datasetVersionId, setDatasetVersionId] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'PRODUCTION' | 'NON_PRODUCTION'>('PRODUCTION');
  const templates = useTemplates({ page: 1, pageSize: 100, status: 'ACTIVE' });
  const versions = useTemplateVersions(templateId);
  const datasets = useDatasets({ page: 1, pageSize: 100 });
  const dataset: { data?: DatasetDetailDto } = useDataset(datasetId);
  const create = useCreateProductionJob();

  if (!canCreate) {
    return <Alert tone="info">Creating production jobs requires production permissions.</Alert>;
  }

  const usableVersions = (versions.data ?? []).filter((version) =>
    mode === 'PRODUCTION' ? version.status === 'APPROVED' : version.status !== 'RETIRED',
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/production" className="hover:underline">
            Production
          </Link>
        }
        title="New production job"
        description="A production job combines one approved template version with one finalized dataset version. Both are recorded with their hashes, so the job always produces exactly the same tags."
      />
      <Card className="max-w-3xl">
        <CardHeader title="Inputs" />
        <CardBody className="space-y-4">
          <Field label="Job name" required>
            <Input
              data-testid="job-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="FW26 hang tags"
            />
          </Field>

          <Field
            label="Mode"
            hint="Non-production jobs may use unapproved artwork and are marked everywhere; they are never released production."
          >
            <Select
              data-testid="job-mode"
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as 'PRODUCTION' | 'NON_PRODUCTION');
                setVersionId('');
              }}
            >
              <option value="PRODUCTION">Production</option>
              <option value="NON_PRODUCTION">Non-production (trial)</option>
            </Select>
          </Field>

          <Field label="Template" required>
            <Select
              data-testid="job-template"
              value={templateId}
              onChange={(event) => {
                setTemplateId(event.target.value);
                setVersionId('');
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
            hint={
              mode === 'PRODUCTION'
                ? 'Only approved versions can be produced.'
                : 'Any version that is not retired.'
            }
          >
            <Select
              data-testid="job-template-version"
              value={versionId}
              disabled={!templateId}
              onChange={(event) => setVersionId(event.target.value)}
            >
              <option value="">Choose a version…</option>
              {usableVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  Version {version.versionNumber} ({version.status})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Dataset" required>
            <Select
              data-testid="job-dataset"
              value={datasetId}
              onChange={(event) => {
                setDatasetId(event.target.value);
                setDatasetVersionId('');
              }}
            >
              <option value="">Choose a dataset…</option>
              {datasets.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Dataset version" required hint="Only finalized versions can be produced.">
            <Select
              data-testid="job-dataset-version"
              value={datasetVersionId}
              disabled={!datasetId}
              onChange={(event) => setDatasetVersionId(event.target.value)}
            >
              <option value="">Choose a version…</option>
              {(dataset.data?.versions ?? []).map((version) => (
                <option key={version.id} value={version.id}>
                  Version {version.versionNumber} — {version.rowCount.toLocaleString('en-US')}{' '}
                  records
                </option>
              ))}
            </Select>
          </Field>

          {create.error ? (
            <Alert tone="danger" data-testid="create-job-error">
              {describeError(create.error)}
            </Alert>
          ) : null}

          <div className="flex gap-3">
            <Button
              data-testid="create-job"
              disabled={!name || !versionId || !datasetVersionId || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    name,
                    description: '',
                    templateVersionId: versionId,
                    datasetVersionId,
                    customerId: null,
                    brandId: null,
                    productionMode: mode,
                  },
                  { onSuccess: (job) => router.push(`/production/${job.id}`) },
                )
              }
            >
              Create job
            </Button>
            <Link href="/production" className="text-sm text-slate-600 hover:underline">
              Cancel
            </Link>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
