import { expect, test, type APIRequestContext } from '@playwright/test';
import type { ProductionInstancePageDto, ProductionJobDto } from '@smarttag/shared-types';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { E2E_DATABASE_URL } from '../environment.mjs';
import { apiAs, ORIGIN } from '../support/imports.ts';
import { createSequence, getJob, productionInputs } from '../support/production.ts';

/**
 * Production benchmark (opt-in: E2E_PRODUCTION_BENCHMARK=1). Drives the real stack through the
 * API — job creation, expansion and validation of every tag, release with serial numbers, instance
 * hashes and the manifest — and records timings, worker metrics (duration, throughput, peak
 * memory) and API latency measured while the worker is expanding.
 *
 * Results: e2e/test-results/production-performance.json.
 */
test.skip(
  process.env.E2E_PRODUCTION_BENCHMARK !== '1',
  'set E2E_PRODUCTION_BENCHMARK=1 to run the production benchmark',
);

/** Scenario A by default: 10,000 records × 10 copies = 100,000 tags. */
const RECORDS = Number(process.env.E2E_BENCHMARK_RECORDS ?? 10_000);
const COPIES = Number(process.env.E2E_BENCHMARK_COPIES ?? 10);

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0,
  );
};

async function jobMetrics(jobId: string) {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ metrics: Record<string, unknown> }>(
      'SELECT metrics FROM production_jobs WHERE id = $1',
      [jobId],
    );
    return result.rows[0]!.metrics;
  } finally {
    await client.end();
  }
}

/** Polls the job while the worker works, measuring how responsive the API stays meanwhile. */
async function waitWhileWorking(
  api: APIRequestContext,
  jobId: string,
  working: readonly string[],
): Promise<{ job: ProductionJobDto; health: number[]; detail: number[]; wallMs: number }> {
  const started = performance.now();
  const health: number[] = [];
  const detail: number[] = [];
  for (;;) {
    const h0 = performance.now();
    await api.get('/api/v1/health');
    health.push(performance.now() - h0);
    const d0 = performance.now();
    const job = await getJob(api, jobId);
    detail.push(performance.now() - d0);
    if (!working.includes(job.status)) {
      return { job, health, detail, wallMs: performance.now() - started };
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
}

test('production benchmark: expansion, validation, release and manifest', async () => {
  test.setTimeout(60 * 60_000);
  const api = await apiAs('admin');
  const label = `Benchmark ${Date.now()}`;

  // The dataset itself is built through the real import pipeline.
  const datasetStarted = performance.now();
  const inputs = await productionInputs(
    Array.from({ length: RECORDS }, () => COPIES),
    label,
  );
  const datasetMs = performance.now() - datasetStarted;
  const sequence = await createSequence(api, `BENCH${Date.now().toString().slice(-6)}`);

  const created = await api.post('/api/v1/production-jobs', {
    headers: ORIGIN,
    data: {
      name: label,
      templateVersionId: inputs.templateVersionId,
      datasetVersionId: inputs.datasetVersionId,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  let job = (await created.json()) as ProductionJobDto;

  const configured = await api.patch(`/api/v1/production-jobs/${job.id}`, {
    headers: ORIGIN,
    data: {
      expectedRevision: job.revision,
      quantity: { mode: 'FIELD', field: 'quantity', whenMissing: 'REFUSE', defaultQuantity: 1 },
      serial: { enabled: true, sequenceId: sequence.id },
    },
  });
  expect(configured.status(), await configured.text()).toBe(200);
  job = (await configured.json()) as ProductionJobDto;

  // Expansion and validation of every tag.
  const expandStarted = performance.now();
  const requested = await api.post(`/api/v1/production-jobs/${job.id}/validate`, {
    headers: ORIGIN,
    data: { expectedRevision: job.revision },
  });
  expect(requested.status(), await requested.text()).toBe(200);
  const validateRequestMs = performance.now() - expandStarted;
  const expansion = await waitWhileWorking(api, job.id, ['QUEUED', 'EXPANDING', 'VALIDATING']);
  expect(expansion.job.status, JSON.stringify(expansion.job.failure)).toBe('READY');
  expect(expansion.job.counts.instanceCount).toBe(RECORDS * COPIES);

  // Release: serial numbers, instance hashes, ordered digest and the manifest.
  const releaseStarted = performance.now();
  const released = await api.post(`/api/v1/production-jobs/${expansion.job.id}/release`, {
    headers: ORIGIN,
    data: { expectedRevision: expansion.job.revision, acknowledgeWarnings: true },
  });
  expect(released.status(), await released.text()).toBe(200);
  const releaseRequestMs = performance.now() - releaseStarted;
  const release = await waitWhileWorking(api, job.id, ['RELEASED']);
  expect(release.job.status, JSON.stringify(release.job.failure)).toBe('READY_FOR_RENDERING');

  // Reading tags: the first page, the last page (keyset) and a search.
  const firstPageStarted = performance.now();
  const firstPage = await api.get(`/api/v1/production-jobs/${job.id}/instances?pageSize=25`);
  expect(firstPage.status()).toBe(200);
  const firstPageMs = performance.now() - firstPageStarted;

  const lastCursor = RECORDS * COPIES - 25;
  const lastPageStarted = performance.now();
  const lastPage = await api.get(
    `/api/v1/production-jobs/${job.id}/instances?pageSize=25&afterSequence=${lastCursor}`,
  );
  expect(lastPage.status()).toBe(200);
  const lastPageMs = performance.now() - lastPageStarted;
  expect(((await lastPage.json()) as ProductionInstancePageDto).items).toHaveLength(25);

  const searchStarted = performance.now();
  const search = await api.get(
    `/api/v1/production-jobs/${job.id}/instances?pageSize=25&search=YT-01005000`,
  );
  expect(search.status()).toBe(200);
  const searchMs = performance.now() - searchStarted;

  const manifestStarted = performance.now();
  const manifest = await api.get(`/api/v1/production-jobs/${job.id}/manifest`);
  expect(manifest.status()).toBe(200);
  const manifestMs = performance.now() - manifestStarted;

  const metrics = await jobMetrics(job.id);
  const report = {
    measuredAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    scenario: { records: RECORDS, copiesPerRecord: COPIES, instances: RECORDS * COPIES },
    datasetPreparationMs: Math.round(datasetMs),
    validateRequestMs: Math.round(validateRequestMs),
    expansionWallMs: Math.round(expansion.wallMs),
    releaseRequestMs: Math.round(releaseRequestMs),
    releaseWallMs: Math.round(release.wallMs),
    apiLatencyDuringExpansionMs: {
      samples: expansion.health.length,
      healthP50: percentile(expansion.health, 50),
      healthP95: percentile(expansion.health, 95),
      jobDetailP50: percentile(expansion.detail, 50),
      jobDetailP95: percentile(expansion.detail, 95),
    },
    apiLatencyDuringReleaseMs: {
      samples: release.health.length,
      healthP95: percentile(release.health, 95),
      jobDetailP95: percentile(release.detail, 95),
    },
    instancePagesMs: {
      firstPage: Math.round(firstPageMs),
      lastPage: Math.round(lastPageMs),
      search: Math.round(searchMs),
      manifest: Math.round(manifestMs),
    },
    counts: release.job.counts,
    worker: metrics,
  };

  const directory = resolve(import.meta.dirname, '..', 'test-results');
  mkdirSync(directory, { recursive: true });
  const json = JSON.stringify(report, null, 2);
  writeFileSync(resolve(directory, 'production-performance.json'), json);
  process.stdout.write(`${json}${String.fromCharCode(10)}`);
  await api.dispose();
});
