import {
  VARIABLE_DATA_FIELDS,
  createVariableDataHangTagDocument,
} from '@smarttag/document-utils/fixtures';
import {
  cleanupDataImports,
  processInspectJob,
  processValidateJob,
  type ImportProcessingSettings,
} from '@smarttag/import-processing';
import type { MappingDefinition } from '@smarttag/import-core';
import type { ObjectStorage } from '@smarttag/object-storage';
import {
  ImportInspectJobSchema,
  ImportValidateJobSchema,
  JOB_NAMES,
  QUEUE_NAMES,
  type DataImportDto,
  type TemplateDto,
  type TemplateVersionDetailDto,
} from '@smarttag/shared-types';
import { buildCsv } from '@smarttag/tabular-sources/testing';
import { Queue, Worker } from 'bullmq';
import type TestAgent from 'supertest/lib/agent';
import { expect } from 'vitest';
import { APP_CONFIG, type AppConfig } from '../../src/config/env.schema';
import { OBJECT_STORAGE } from '../../src/modules/assets/storage/storage.module';
import { API, hangTagRequest, type TestApp } from './helpers';

export const PROCESSING = new Set(['UPLOADED', 'INSPECTING', 'VALIDATING']);

export function importSettings(t: TestApp): ImportProcessingSettings {
  return t.app.get<AppConfig>(APP_CONFIG).imports;
}

export function importStorage(t: TestApp): ObjectStorage {
  return t.app.get<ObjectStorage>(OBJECT_STORAGE);
}

/**
 * The same processing the worker runs, consuming the real import queue (Redis + BullMQ) in the
 * test process: API enqueue → Redis → worker → database.
 */
export async function startImportWorker(t: TestApp): Promise<{ close(): Promise<void> }> {
  const config = t.app.get<AppConfig>(APP_CONFIG);
  const connection = { url: config.redis!.url, maxRetriesPerRequest: null };
  const queue = new Queue(QUEUE_NAMES.IMPORTS, { connection });
  await queue.obliterate({ force: true });
  const deps = { prisma: t.prisma, storage: importStorage(t), settings: config.imports };
  const worker = new Worker(
    QUEUE_NAMES.IMPORTS,
    async (job) => {
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      switch (job.name) {
        case JOB_NAMES.IMPORT_INSPECT:
          return processInspectJob(
            { ...deps, finalAttempt },
            ImportInspectJobSchema.parse(job.data),
          );
        case JOB_NAMES.IMPORT_VALIDATE:
          return processValidateJob(
            { ...deps, finalAttempt },
            ImportValidateJobSchema.parse(job.data),
          );
        case JOB_NAMES.DATA_CLEANUP:
          return cleanupDataImports(deps);
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
  };
}

export async function waitForImport(
  agent: TestAgent,
  importId: string,
  timeoutMs = 30_000,
): Promise<DataImportDto> {
  const started = Date.now();
  for (;;) {
    const response = await agent.get(`${API}/data-imports/${importId}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const dto = response.body as DataImportDto;
    if (!PROCESSING.has(dto.status)) return dto;
    if (Date.now() - started > timeoutMs) throw new Error(`import ${importId} still ${dto.status}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** A saved variable-data template (Phase 3 fixture) owned by the designer; returns its draft. */
export async function createVariableDataTemplate(
  designer: TestAgent,
  code = 'HT-VDP',
): Promise<{ template: TemplateDto; version: TemplateVersionDetailDto }> {
  const template = (await designer.post(`${API}/templates`).send(hangTagRequest({ code })))
    .body as TemplateDto;
  const saved = await designer
    .patch(`${API}/template-versions/${template.currentVersion!.id}`)
    .send({
      document: createVariableDataHangTagDocument({ documentId: template.id }),
      expectedRevision: 1,
    });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  return { template, version: saved.body as TemplateVersionDetailDto };
}

export const HEADERS = [
  'STYLE_NO',
  'PRODUCT NAME',
  'Color',
  'SIZE_CODE',
  'RETAIL',
  'EAN_CODE',
  'IMAGE',
];

export function hangTagCsv(rows: readonly (readonly string[])[], delimiter = ','): Buffer {
  return Buffer.from(buildCsv([HEADERS, ...rows], delimiter), 'utf8');
}

export const GOOD_ROWS = [
  ['YT-2045', 'Premium Cotton Shirt', 'Navy', 'XL', '39,95', '9501234567891', ''],
  ['YT-2046', 'Linen Shirt', 'White', 'M', '1.234,50', '9501234567891', ''],
  ['YT-2047', 'Denim Jacket', 'Blue', 'L', '89,00', '9501234567891', ''],
];

/** Maps HEADERS to the fixture fields with a decimal comma. */
export function hangTagMapping(columns: DataImportDto['columns']): MappingDefinition {
  const byHeader = (header: string) => {
    const column = columns.find((candidate) => candidate.header === header);
    if (!column) throw new Error(`no column ${header}`);
    return { index: column.index, header: column.header };
  };
  const entry = (field: string, header: string) => ({
    field,
    column: byHeader(header),
    number: null,
    dateFormat: null,
    boolean: null,
  });
  return {
    version: 1,
    entries: [
      entry('style', 'STYLE_NO'),
      entry('product_name', 'PRODUCT NAME'),
      entry('color', 'Color'),
      entry('size', 'SIZE_CODE'),
      entry('price', 'RETAIL'),
      entry('gtin', 'EAN_CODE'),
      entry('product_image', 'IMAGE'),
    ],
    parsing: {
      trimWhitespace: true,
      emptyValues: [],
      number: { decimalSeparator: ',', thousandsSeparator: '.' },
      dateFormat: 'YYYY-MM-DD',
      boolean: { trueValues: ['true'], falseValues: ['false'] },
    },
  };
}

export async function uploadCsv(
  agent: TestAgent,
  versionId: string,
  content: Buffer,
  filename = 'tags.csv',
) {
  return agent
    .post(`${API}/template-versions/${versionId}/imports`)
    .attach('file', content, { filename, contentType: 'text/csv' });
}

/** Upload → inspection → mapping, returning the import ready to validate. */
export async function mappedImport(
  agent: TestAgent,
  versionId: string,
  content: Buffer,
  buildMapping: (columns: DataImportDto['columns']) => MappingDefinition = hangTagMapping,
): Promise<DataImportDto> {
  const uploaded = await uploadCsv(agent, versionId, content);
  expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
  const inspected = await waitForImport(agent, (uploaded.body as DataImportDto).id);
  expect(inspected.status, JSON.stringify(inspected.failure)).toBe('MAPPING_REQUIRED');
  const mapped = await agent.patch(`${API}/data-imports/${inspected.id}/mapping`).send({
    expectedRevision: inspected.revision,
    mapping: buildMapping(inspected.columns),
    profile: null,
  });
  expect(mapped.status, JSON.stringify(mapped.body)).toBe(200);
  return mapped.body as DataImportDto;
}

export async function validatedImport(
  agent: TestAgent,
  versionId: string,
  content: Buffer,
  buildMapping?: (columns: DataImportDto['columns']) => MappingDefinition,
): Promise<DataImportDto> {
  const mapped = await mappedImport(agent, versionId, content, buildMapping);
  expect(mapped.status).toBe('READY_TO_VALIDATE');
  const requested = await agent
    .post(`${API}/data-imports/${mapped.id}/validate`)
    .send({ expectedRevision: mapped.revision });
  expect(requested.status, JSON.stringify(requested.body)).toBe(200);
  return waitForImport(agent, mapped.id);
}

export const FIELD_KEYS = VARIABLE_DATA_FIELDS.map((field) => field.key);
