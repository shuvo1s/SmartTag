import type { DbClient } from '@smarttag/database';
import {
  DEFAULT_IMPORT_LIMITS,
  IMPORT_LIMIT_BOUNDS,
  type ProcessedRow,
  type RowIssue,
  type SourceColumn,
} from '@smarttag/import-core';
import { ObjectNotFoundError, type ObjectStorage } from '@smarttag/object-storage';
import type { MappingValidationDto } from '@smarttag/shared-types';
import { SourceReadError } from '@smarttag/tabular-sources';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  IMPORT_LIMIT_VARIABLES,
  MemorySampler,
  ValidationSummaryBuilder,
  failureOf,
  loadImportSettings,
  lookupImageAvailability,
  sourceFromStorage,
} from '../src';

describe('import settings from the environment', () => {
  it('defaults to the documented limits and batch settings', () => {
    expect(loadImportSettings({})).toEqual({
      limits: DEFAULT_IMPORT_LIMITS,
      validationBatchSize: 500,
      abandonedAfterHours: 336,
      pendingUploadAfterMinutes: 60,
      stalledAfterMinutes: 30,
    });
  });

  it('every limit has its own variable and accepts values within its bounds', () => {
    const variables = Object.values(IMPORT_LIMIT_VARIABLES);
    expect(new Set(variables).size).toBe(Object.keys(DEFAULT_IMPORT_LIMITS).length);
    const settings = loadImportSettings({
      IMPORT_MAX_ROWS: String(IMPORT_LIMIT_BOUNDS.maxRows.max),
      IMPORT_MAX_FILE_BYTES: String(IMPORT_LIMIT_BOUNDS.maxFileBytes.min),
      IMPORT_VALIDATION_BATCH_SIZE: '1000',
      IMPORT_MAX_COLUMNS: '',
    });
    expect(settings.limits).toEqual({
      ...DEFAULT_IMPORT_LIMITS,
      maxRows: IMPORT_LIMIT_BOUNDS.maxRows.max,
      maxFileBytes: IMPORT_LIMIT_BOUNDS.maxFileBytes.min,
    });
    expect(settings.validationBatchSize).toBe(1000);
  });

  it('refuses values outside the bounds, naming the variable', () => {
    expect(() =>
      loadImportSettings({ IMPORT_MAX_ROWS: String(IMPORT_LIMIT_BOUNDS.maxRows.max + 1) }),
    ).toThrow(/IMPORT_MAX_ROWS/);
    expect(() => loadImportSettings({ IMPORT_XLSX_MAX_COMPRESSION_RATIO: 'lots' })).toThrow(
      /IMPORT_XLSX_MAX_COMPRESSION_RATIO/,
    );
    expect(() => loadImportSettings({ IMPORT_VALIDATION_BATCH_SIZE: '1' })).toThrow(
      /IMPORT_VALIDATION_BATCH_SIZE/,
    );
  });
});

function storageWith(objects: Record<string, Buffer>): ObjectStorage {
  return {
    driver: 'memory',
    putObject: () => Promise.reject(new Error('read only')),
    objectExists: (key) => Promise.resolve(key in objects),
    deleteObject: () => Promise.reject(new Error('read only')),
    getObject: (key) => {
      const body = objects[key];
      if (!body) return Promise.reject(new ObjectNotFoundError(key));
      // Small chunks, so size checks run while streaming.
      const chunks = Array.from({ length: Math.ceil(body.length / 4) }, (_, index) =>
        body.subarray(index * 4, index * 4 + 4),
      );
      return Promise.resolve({ body: Readable.from(chunks), contentLength: body.length });
    },
  };
}

describe('reading uploads from object storage', () => {
  const limits = { ...DEFAULT_IMPORT_LIMITS, maxFileBytes: 16 };

  it('reads the stored bytes', async () => {
    const storage = storageWith({ 'a.csv': Buffer.from('A,B\n1,2\n') });
    const source = sourceFromStorage(storage, 'a.csv', 8, limits);
    expect((await source.readAll()).toString('utf8')).toBe('A,B\n1,2\n');
    expect(source.sizeBytes).toBe(8);
  });

  it('a removed upload is a readable failure, not an internal error', async () => {
    const source = sourceFromStorage(storageWith({}), 'gone.csv', 8, limits);
    const error = await source.readAll().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SourceReadError);
    expect(error).toMatchObject({
      code: 'MALFORMED_FILE',
      message: 'The uploaded file is no longer available. Upload it again.',
    });
  });

  it('never buffers more than the upload limit, even if the recorded size is wrong', async () => {
    const storage = storageWith({ 'big.csv': Buffer.alloc(40, 65) });
    await expect(sourceFromStorage(storage, 'big.csv', 40, limits).readAll()).rejects.toMatchObject(
      { code: 'FILE_LIMIT_EXCEEDED' },
    );
    await expect(sourceFromStorage(storage, 'big.csv', 10, limits).readAll()).rejects.toMatchObject(
      { code: 'FILE_LIMIT_EXCEEDED' },
    );
  });
});

describe('image asset lookup', () => {
  const ORG = '0192b8a0-0000-7000-8000-00000000000a';
  const MINE = '0192b8a0-0000-7000-8000-000000000001';
  const OTHER = '0192b8a0-0000-7000-8000-000000000002';

  function fakeDb(found: readonly string[]) {
    const calls: unknown[] = [];
    const db = {
      asset: {
        findMany: (args: unknown) => {
          calls.push(args);
          return Promise.resolve(found.map((id) => ({ id })));
        },
      },
    } as unknown as DbClient;
    return { db, calls };
  }

  it('queries once per batch, scoped to the organization and to placeable images', async () => {
    const { db, calls } = fakeDb([MINE]);
    const availability = await lookupImageAvailability(db, ORG, [MINE, OTHER, MINE]);
    expect(Object.fromEntries(availability)).toEqual({
      [MINE]: 'AVAILABLE',
      [OTHER]: 'UNAVAILABLE',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      where: {
        organizationId: ORG,
        id: { in: [MINE, OTHER] },
        assetType: { not: 'FONT' },
        mimeType: { in: expect.arrayContaining(['image/png']) as unknown },
      },
    });
  });

  it('does not query without ids', async () => {
    const { db, calls } = fakeDb([]);
    expect((await lookupImageAvailability(db, ORG, [])).size).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe('job failures', () => {
  it('source problems are final and keep their explanation', () => {
    expect(
      failureOf(new SourceReadError('WORKBOOK_LIMIT_EXCEEDED', 'The workbook is too large.')),
    ).toEqual({
      code: 'WORKBOOK_LIMIT_EXCEEDED',
      message: 'The workbook is too large.',
      retryable: false,
    });
  });

  it('unexpected errors are retryable and never expose internal details', () => {
    const failure = failureOf(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret'));
    expect(failure).toMatchObject({ code: 'PROCESSING_ERROR', retryable: true });
    expect(failure.message).not.toMatch(/ECONNREFUSED|secret|10\.0\.0\.5/);
  });
});

describe('validation summary', () => {
  const issue = (
    layer: RowIssue['layer'],
    code: string,
    severity: RowIssue['severity'],
    field: string | null,
  ) => ({ layer, code, severity, field, message: code, target: null }) as unknown as RowIssue;

  const processed = (issues: readonly RowIssue[]): ProcessedRow => ({
    rowNumber: 2,
    status: issues.some((candidate) => candidate.severity === 'ERROR')
      ? 'ERROR'
      : issues.length
        ? 'WARNING'
        : 'VALID',
    normalizedRecord: {},
    issues,
    errorCount: issues.filter((candidate) => candidate.severity === 'ERROR').length,
    warningCount: issues.filter((candidate) => candidate.severity === 'WARNING').length,
    recordHashPayload: '{}',
    resolvedInputHashPayload: null,
    searchText: '',
  });

  const mapping: MappingValidationDto = {
    complete: true,
    issues: [],
    mappedFields: ['price', 'gtin'],
    ignoredColumns: [2, 9],
    unmappedRequiredFields: [],
    unmappedOptionalFields: ['product_image'],
  };
  const columns = [
    { index: 0, letter: 'A', header: 'RETAIL' },
    { index: 1, letter: 'B', header: 'EAN' },
    { index: 2, letter: 'C', header: 'NOTES' },
  ] as unknown as SourceColumn[];

  it('counts rows per issue code (not issues) and fields by their worst severity', () => {
    const builder = new ValidationSummaryBuilder();
    builder.add(processed([]));
    builder.add(
      processed([
        issue('IMPORT', 'DECIMAL_PARSE_FAILED', 'ERROR', 'price'),
        issue('IMPORT', 'FORMULA_CACHED_VALUE', 'WARNING', 'price'),
        issue('OBJECT', 'BARCODE_CHECK_DIGIT_INVALID', 'ERROR', 'gtin'),
        issue('OBJECT', 'BARCODE_CHECK_DIGIT_INVALID', 'ERROR', 'gtin'),
      ]),
    );
    builder.add(processed([issue('IMPORT', 'FORMULA_CACHED_VALUE', 'WARNING', 'price')]));
    builder.add(processed([issue('BINDING', 'EXPRESSION_FAILED', 'ERROR', null)]));

    const summary = builder.build(mapping, columns);
    expect(summary.issueCounts).toEqual([
      { layer: 'IMPORT', code: 'FORMULA_CACHED_VALUE', severity: 'WARNING', rows: 2 },
      { layer: 'OBJECT', code: 'BARCODE_CHECK_DIGIT_INVALID', severity: 'ERROR', rows: 1 },
      { layer: 'IMPORT', code: 'DECIMAL_PARSE_FAILED', severity: 'ERROR', rows: 1 },
      { layer: 'BINDING', code: 'EXPRESSION_FAILED', severity: 'ERROR', rows: 1 },
    ]);
    // A row with an error and a warning for one field counts as an error row for that field only.
    expect(summary.fieldCounts).toEqual([
      { field: 'price', errorRows: 1, warningRows: 1 },
      { field: 'gtin', errorRows: 1, warningRows: 0 },
    ]);
  });

  it('describes ignored columns and states honestly that layout was not checked', () => {
    const summary = new ValidationSummaryBuilder().build(mapping, columns);
    expect(summary).toMatchObject({
      issueCounts: [],
      fieldCounts: [],
      mappedFields: ['price', 'gtin'],
      ignoredColumns: [{ index: 2, letter: 'C', header: 'NOTES' }],
      unmappedOptionalFields: ['product_image'],
      layoutChecked: false,
    });
  });
});

describe('memory sampling', () => {
  it('keeps the highest values seen', () => {
    const sampler = new MemorySampler();
    const first = sampler.peakRssBytes;
    const retained = Array.from({ length: 200_000 }, (_, index) => ({ index }));
    sampler.sample();
    expect(sampler.peakRssBytes).toBeGreaterThanOrEqual(first);
    expect(sampler.peakHeapUsedBytes).toBeGreaterThan(0);
    expect(retained).toHaveLength(200_000);
  });
});
