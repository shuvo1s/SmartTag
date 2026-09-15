import { expect, test, type APIRequestContext } from '@playwright/test';
import type { DataImportDto, DatasetVersionDetailDto } from '@smarttag/shared-types';
import { buildCsv, buildXlsxWorkbook } from '@smarttag/tabular-sources/testing';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { E2E_DATABASE_URL } from '../environment.mjs';
import { HEADERS, ORIGIN, apiAs, getImport, importTemplate } from '../support/imports.ts';

/**
 * Import benchmark (opt-in: E2E_IMPORT_BENCHMARK=1). Drives the real stack through the API —
 * upload, background inspection, mapping, background validation, finalization — and records
 * timings, worker metrics (duration, throughput, peak RSS of the worker process) and API latency
 * measured while the worker validates. Results: e2e/test-results/import-performance.json.
 */
test.skip(
  process.env.E2E_IMPORT_BENCHMARK !== '1',
  'set E2E_IMPORT_BENCHMARK=1 to run the import benchmark',
);

const CSV_ROWS = Number(process.env.E2E_BENCHMARK_CSV_ROWS ?? 100_000);
const XLSX_ROWS = Number(process.env.E2E_BENCHMARK_XLSX_ROWS ?? 25_000);
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const COLORS = ['Navy', 'White', 'Black', 'Olive', 'Sand'];

function row(index: number): string[] {
  return [
    `YT-${String(index % 10_000).padStart(4, '0')}`,
    `Premium Cotton Shirt ${index}`,
    COLORS[index % COLORS.length]!,
    SIZES[index % SIZES.length]!,
    `${(index % 9_000) + 1},${String(index % 100).padStart(2, '0')}`,
    '9501234567891',
    '',
  ];
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};

async function waitFor(
  api: APIRequestContext,
  importId: string,
  done: (dto: DataImportDto) => boolean,
) {
  for (;;) {
    const dto = await getImport(api, importId);
    if (done(dto)) return dto;
    if (dto.status === 'FAILED') throw new Error(JSON.stringify(dto.failure));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
}

async function workerMetrics(importId: string) {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ processing: Record<string, unknown> }>(
      'SELECT processing FROM data_imports WHERE id = $1',
      [importId],
    );
    return result.rows[0]!.processing;
  } finally {
    await client.end();
  }
}

async function benchmark(
  label: string,
  file: { name: string; mimeType: string; buffer: Buffer },
  mappingFor: (dto: DataImportDto) => DataImportDto['mapping'],
  settings: ((dto: DataImportDto) => DataImportDto['sourceSettings']) | null,
) {
  const api = await apiAs('admin');
  const draft = await importTemplate();
  const t0 = performance.now();
  const uploaded = await api.post(`/api/v1/template-versions/${draft.versionId}/imports`, {
    headers: ORIGIN,
    multipart: { file },
    timeout: 120_000,
  });
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  const uploadMs = performance.now() - t0;
  let dto = (await uploaded.json()) as DataImportDto;
  dto = await waitFor(
    api,
    dto.id,
    (candidate) => !['UPLOADED', 'INSPECTING'].includes(candidate.status),
  );
  const inspectionWallMs = performance.now() - t0;
  if (settings) {
    const changed = await api.patch(`/api/v1/data-imports/${dto.id}/source-settings`, {
      headers: ORIGIN,
      data: { expectedRevision: dto.revision, settings: settings(dto) },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    dto = (await changed.json()) as DataImportDto;
  }
  const mapped = await api.patch(`/api/v1/data-imports/${dto.id}/mapping`, {
    headers: ORIGIN,
    data: { expectedRevision: dto.revision, mapping: mappingFor(dto), profile: null },
  });
  expect(mapped.status(), await mapped.text()).toBe(200);
  dto = (await mapped.json()) as DataImportDto;

  const v0 = performance.now();
  const requested = await api.post(`/api/v1/data-imports/${dto.id}/validate`, {
    headers: ORIGIN,
    data: { expectedRevision: dto.revision },
  });
  expect(requested.status()).toBe(200);
  const validateRequestMs = performance.now() - v0;
  const healthLatencies: number[] = [];
  const detailLatencies: number[] = [];
  let finished: DataImportDto | null = null;
  while (!finished) {
    const h0 = performance.now();
    await api.get('/api/v1/health');
    healthLatencies.push(performance.now() - h0);
    const d0 = performance.now();
    const current = await getImport(api, dto.id);
    detailLatencies.push(performance.now() - d0);
    if (current.status === 'FAILED') throw new Error(JSON.stringify(current.failure));
    if (!['VALIDATING'].includes(current.status)) finished = current;
    else await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  const validationWallMs = performance.now() - v0;
  expect(finished.validation?.rowCount).toBeGreaterThan(0);

  const p0 = performance.now();
  const lastPage = Math.max(1, Math.ceil(finished.validation!.rowCount / 50));
  const page = await api.get(`/api/v1/data-imports/${dto.id}/rows?page=${lastPage}&pageSize=50`);
  expect(page.status()).toBe(200);
  const lastPageMs = performance.now() - p0;
  const s0 = performance.now();
  await api.get(
    `/api/v1/data-imports/${dto.id}/rows?search=shirt%20${Math.floor(finished.validation!.rowCount / 2)}&pageSize=50`,
  );
  const searchMs = performance.now() - s0;

  const f0 = performance.now();
  const finalized = await api.post(`/api/v1/data-imports/${dto.id}/finalize`, {
    headers: ORIGIN,
    data: {
      expectedRevision: finished.revision,
      acknowledgeWarnings: true,
      dataset: { mode: 'NEW', name: `Benchmark ${label} ${Date.now()}` },
    },
  });
  expect(finalized.status(), await finalized.text()).toBe(200);
  const finalizeMs = performance.now() - f0;
  const version = (await finalized.json()) as DatasetVersionDetailDto;
  const metrics = await workerMetrics(dto.id);
  await api.dispose();
  return {
    label,
    rows: version.rowCount,
    fileBytes: file.buffer.length,
    status: finished.status,
    validCount: version.validCount,
    warningCount: version.warningCount,
    uploadRequestMs: Math.round(uploadMs),
    inspectionWallMs: Math.round(inspectionWallMs),
    workerInspection: metrics.inspection,
    validateRequestMs: Math.round(validateRequestMs),
    validationWallMs: Math.round(validationWallMs),
    workerValidation: metrics.validation,
    apiLatencyDuringValidationMs: {
      samples: healthLatencies.length,
      healthP50: Math.round(percentile(healthLatencies, 50)),
      healthP95: Math.round(percentile(healthLatencies, 95)),
      healthMax: Math.round(Math.max(...healthLatencies)),
      importDetailP50: Math.round(percentile(detailLatencies, 50)),
      importDetailP95: Math.round(percentile(detailLatencies, 95)),
    },
    lastRowsPageMs: Math.round(lastPageMs),
    searchRowsMs: Math.round(searchMs),
    finalizeRequestMs: Math.round(finalizeMs),
  };
}

function standardMapping(dto: DataImportDto, decimalComma: boolean): DataImportDto['mapping'] {
  const entry = (field: string, index: number) => ({
    field,
    column: { index, header: dto.columns[index]!.header },
    number: null,
    dateFormat: null,
    boolean: null,
  });
  return {
    version: 1,
    entries: [
      entry('style', 0),
      entry('product_name', 1),
      entry('color', 2),
      entry('size', 3),
      entry('price', 4),
      entry('gtin', 5),
    ],
    parsing: {
      trimWhitespace: true,
      emptyValues: [],
      number: decimalComma
        ? { decimalSeparator: ',', thousandsSeparator: 'NONE' }
        : { decimalSeparator: '.', thousandsSeparator: 'NONE' },
      dateFormat: 'YYYY-MM-DD',
      boolean: { trueValues: ['true'], falseValues: ['false'] },
    },
  };
}

test('import benchmark: CSV and XLSX through upload, inspection, validation and finalization', async () => {
  test.setTimeout(30 * 60_000);
  const results = [];

  const csvText = buildCsv([
    [...HEADERS],
    ...Array.from({ length: CSV_ROWS }, (_, index) => row(index)),
  ]);
  results.push(
    await benchmark(
      'csv',
      { name: 'benchmark.csv', mimeType: 'text/csv', buffer: Buffer.from(csvText, 'utf8') },
      (dto) => standardMapping(dto, true),
      null,
    ),
  );

  const workbook = buildXlsxWorkbook({
    sheets: [
      { name: 'Readme', rows: [['Benchmark workbook']] },
      {
        name: 'Tags',
        rows: [
          [...HEADERS],
          ...Array.from({ length: XLSX_ROWS }, (_, index) => {
            const values = row(index);
            return [
              values[0]!,
              values[1]!,
              values[2]!,
              values[3]!,
              (index % 9_000) + 1 + (index % 100) / 100,
              9501234567891,
              null,
            ];
          }),
        ],
      },
    ],
  });
  results.push(
    await benchmark(
      'xlsx',
      {
        name: 'benchmark.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: workbook,
      },
      (dto) => standardMapping(dto, false),
      () => ({ format: 'XLSX', sheetName: 'Tags', headerRow: 1 }),
    ),
  );

  const report = {
    measuredAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    results,
  };
  const directory = resolve(import.meta.dirname, '..', 'test-results');
  mkdirSync(directory, { recursive: true });
  const json = JSON.stringify(report, null, 2);
  writeFileSync(resolve(directory, 'import-performance.json'), json);
  process.stdout.write(`${json}${String.fromCharCode(10)}`);
});
