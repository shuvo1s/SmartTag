import type { ObjectStorage } from '@smarttag/object-storage';
import {
  processExpandJob,
  processReleaseJob,
  type ProductionProcessingSettings,
} from '@smarttag/production-processing';
import {
  JOB_NAMES,
  ProductionExpandJobSchema,
  ProductionReleaseJobSchema,
  QUEUE_NAMES,
  type DatasetVersionDetailDto,
  type ProductionJobDto,
  type SequenceDto,
  type TemplateVersionDetailDto,
} from '@smarttag/shared-types';
import { Queue, Worker } from 'bullmq';
import type TestAgent from 'supertest/lib/agent';
import { expect } from 'vitest';
import { APP_CONFIG, type AppConfig } from '../../src/config/env.schema';
import { OBJECT_STORAGE } from '../../src/modules/assets/storage/storage.module';
import { API, type TestApp } from './helpers';
import {
  HEADERS,
  createVariableDataTemplate,
  hangTagMapping,
  validatedImport,
} from './import-helpers';
import { buildCsv } from '@smarttag/tabular-sources/testing';
import {
  createVariableDataHangTagDocument,
  VARIABLE_DATA_FIELDS,
} from '@smarttag/document-utils/fixtures';
import type { DataImportDto } from '@smarttag/shared-types';
import type { MappingDefinition } from '@smarttag/import-core';
import { hangTagRequest } from './helpers';
import type { DesignDocument } from '@smarttag/document-schema';
import type { TemplateDto } from '@smarttag/shared-types';

/** Statuses in which a production job is still being worked on. */
export const WORKING = new Set(['QUEUED', 'EXPANDING', 'VALIDATING', 'RELEASED']);

export function productionSettings(t: TestApp): ProductionProcessingSettings {
  return t.app.get<AppConfig>(APP_CONFIG).production;
}

export function productionStorage(t: TestApp): ObjectStorage {
  return t.app.get<ObjectStorage>(OBJECT_STORAGE);
}

/**
 * The same processing the worker runs, consuming the real production queue (Redis + BullMQ) in the
 * test process: API enqueue → Redis → worker → database.
 */
export interface TestWorker {
  close(): Promise<void>;
  pause(): Promise<void>;
  resume(): void;
}

export async function startProductionWorker(t: TestApp): Promise<TestWorker> {
  const config = t.app.get<AppConfig>(APP_CONFIG);
  const connection = { url: config.redis!.url, maxRetriesPerRequest: null };
  const queue = new Queue(QUEUE_NAMES.PRODUCTION, { connection });
  await queue.obliterate({ force: true });
  const deps = { prisma: t.prisma, storage: productionStorage(t), settings: config.production };
  const worker = new Worker(
    QUEUE_NAMES.PRODUCTION,
    async (job) => {
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      switch (job.name) {
        case JOB_NAMES.PRODUCTION_EXPAND:
          return processExpandJob(
            { ...deps, finalAttempt },
            ProductionExpandJobSchema.parse(job.data),
          );
        case JOB_NAMES.PRODUCTION_RELEASE:
          return processReleaseJob(
            { ...deps, finalAttempt },
            ProductionReleaseJobSchema.parse(job.data),
          );
        default:
          throw new Error(`unexpected job ${job.name}`);
      }
    },
    { connection, concurrency: 2 },
  );
  await worker.waitUntilReady();
  return {
    close: async () => {
      await worker.close();
      await queue.close();
    },
    pause: () => worker.pause(),
    resume: () => worker.resume(),
  };
}

export async function waitForJob(
  agent: TestAgent,
  jobId: string,
  until: (job: ProductionJobDto) => boolean = (job) => !WORKING.has(job.status),
  timeoutMs = 30_000,
): Promise<ProductionJobDto> {
  const started = Date.now();
  for (;;) {
    const response = await agent.get(`${API}/production-jobs/${jobId}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const dto = response.body as ProductionJobDto;
    if (until(dto)) return dto;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`production job ${jobId} still ${dto.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Waits until the release work has finished (serials, hashes and manifest written). */
export function waitForRendering(agent: TestAgent, jobId: string): Promise<ProductionJobDto> {
  return waitForJob(agent, jobId, (job) => job.status !== 'RELEASED');
}

/**
 * An approved template version of the variable-data hang tag. Approval goes through the real
 * lifecycle endpoints: submit as the designer, approve as the approver.
 */
export async function approvedTemplateVersion(
  designer: TestAgent,
  approver: TestAgent,
  code = 'HT-PROD',
): Promise<TemplateVersionDetailDto> {
  const { version } = await createVariableDataTemplate(designer, code);
  const submitted = await designer
    .post(`${API}/template-versions/${version.id}/transitions`)
    .send({ targetStatus: 'IN_REVIEW' });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  const approved = await approver
    .post(`${API}/template-versions/${version.id}/transitions`)
    .send({ targetStatus: 'APPROVED' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return approved.body as TemplateVersionDetailDto;
}

/** Column headers of the production CSV: the hang tag columns plus a quantity column. */
export const PRODUCTION_HEADERS = [...HEADERS, 'QTY'];

/** The hang tag document with an extra optional `quantity` field. */
export function quantityDocument(documentId: string): DesignDocument {
  const document = createVariableDataHangTagDocument({ documentId });
  return {
    ...document,
    dataSchema: {
      fields: [
        ...VARIABLE_DATA_FIELDS,
        {
          key: 'quantity',
          displayName: 'Quantity',
          // Text on purpose: the dataset may then hold values production has to refuse.
          type: 'string',
          required: false,
          description: 'Number of tags to produce for this row',
          defaultValue: null,
          validation: { minLength: null, maxLength: null, pattern: null, allowedValues: null },
        },
      ],
    },
  } as DesignDocument;
}

/** An approved template version whose schema has a quantity field. */
export async function approvedQuantityTemplate(
  designer: TestAgent,
  approver: TestAgent,
  code = 'HT-QTY',
): Promise<TemplateVersionDetailDto> {
  const template = (await designer.post(`${API}/templates`).send(hangTagRequest({ code })))
    .body as TemplateDto;
  const saved = await designer
    .patch(`${API}/template-versions/${template.currentVersion!.id}`)
    .send({ document: quantityDocument(template.id), expectedRevision: 1 });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const submitted = await designer
    .post(`${API}/template-versions/${template.currentVersion!.id}/transitions`)
    .send({ targetStatus: 'IN_REVIEW' });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  const approved = await approver
    .post(`${API}/template-versions/${template.currentVersion!.id}/transitions`)
    .send({ targetStatus: 'APPROVED' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return approved.body as TemplateVersionDetailDto;
}

/** The hang tag mapping plus the quantity column. */
export function quantityMapping(columns: DataImportDto['columns']): MappingDefinition {
  const base = hangTagMapping(columns);
  const column = columns.find((candidate) => candidate.header === 'QTY');
  if (!column) throw new Error('no QTY column');
  return {
    ...base,
    entries: [
      ...base.entries,
      {
        field: 'quantity',
        column: { index: column.index, header: column.header },
        number: null,
        dateFormat: null,
        boolean: null,
      },
    ],
  };
}

export function productionCsv(rows: readonly (readonly string[])[]): Buffer {
  return Buffer.from(buildCsv([PRODUCTION_HEADERS, ...rows]), 'utf8');
}

/** Rows of the production CSV; the last column is the quantity. */
export function quantityRows(quantities: readonly (string | number)[]): string[][] {
  return quantities.map((quantity, index) => [
    `YT-${2045 + index}`,
    `Product ${index + 1}`,
    'Navy',
    'XL',
    '39,95',
    '9501234567891',
    '',
    String(quantity),
  ]);
}

/** Imports rows for a template version and finalizes them into a dataset version. */
export async function finalizedDataset(
  agent: TestAgent,
  versionId: string,
  rows: readonly (readonly string[])[],
  datasetName: string,
): Promise<DatasetVersionDetailDto> {
  const validated = await validatedImport(agent, versionId, productionCsv(rows), quantityMapping);
  expect(['READY', 'READY_WITH_WARNINGS'], JSON.stringify(validated.failure)).toContain(
    validated.status,
  );
  const finalized = await agent.post(`${API}/data-imports/${validated.id}/finalize`).send({
    expectedRevision: validated.revision,
    acknowledgeWarnings: true,
    dataset: { mode: 'NEW', name: datasetName, description: '', customerId: null },
  });
  expect(finalized.status, JSON.stringify(finalized.body)).toBe(200);
  return finalized.body as DatasetVersionDetailDto;
}

export async function createSequence(
  agent: TestAgent,
  overrides: Partial<{
    name: string;
    code: string;
    prefix: string;
    suffix: string;
    padding: number;
    startValue: number;
  }> = {},
): Promise<SequenceDto> {
  const response = await agent.post(`${API}/sequences`).send({
    name: overrides.name ?? 'Hang tags',
    code: overrides.code ?? 'YT-HANGTAG',
    prefix: overrides.prefix ?? 'YT-',
    suffix: overrides.suffix ?? '',
    padding: overrides.padding ?? 8,
    startValue: overrides.startValue ?? 1_000_001,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as SequenceDto;
}

/** Creates a job and returns it; the caller configures and validates it. */
export async function createJob(
  agent: TestAgent,
  templateVersionId: string,
  datasetVersionId: string,
  overrides: Record<string, unknown> = {},
): Promise<ProductionJobDto> {
  const response = await agent.post(`${API}/production-jobs`).send({
    name: 'FW26 hang tags',
    templateVersionId,
    datasetVersionId,
    ...overrides,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as ProductionJobDto;
}

export async function configureJob(
  agent: TestAgent,
  job: ProductionJobDto,
  configuration: Record<string, unknown>,
): Promise<ProductionJobDto> {
  const response = await agent
    .patch(`${API}/production-jobs/${job.id}`)
    .send({ expectedRevision: job.revision, ...configuration });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as ProductionJobDto;
}

/** Configure → validate → wait, returning the expanded job. */
export async function expandedJob(
  agent: TestAgent,
  job: ProductionJobDto,
  configuration: Record<string, unknown> = {},
): Promise<ProductionJobDto> {
  const configured =
    Object.keys(configuration).length > 0 ? await configureJob(agent, job, configuration) : job;
  const requested = await agent
    .post(`${API}/production-jobs/${configured.id}/validate`)
    .send({ expectedRevision: configured.revision });
  expect(requested.status, JSON.stringify(requested.body)).toBe(200);
  return waitForJob(agent, configured.id);
}
