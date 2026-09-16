import {
  DEFAULT_PRODUCTION_CONFIGURATION,
  DEFAULT_PRODUCTION_LIMITS,
  LAYOUT_NOTE,
  PRODUCTION_LIMIT_BOUNDS,
  type InstanceIssue,
} from '@smarttag/production-core';
import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_LIMIT_VARIABLES,
  ProductionPreconditionError,
  ProductionSummaryBuilder,
  asObject,
  configurationOf,
  documentOf,
  failureOf,
  loadProductionSettings,
} from '../src';

describe('production settings from the environment', () => {
  it('defaults to the documented limits', () => {
    expect(loadProductionSettings({})).toEqual({ limits: DEFAULT_PRODUCTION_LIMITS });
  });

  it('every limit has its own variable and accepts values within its bounds', () => {
    const variables = Object.values(PRODUCTION_LIMIT_VARIABLES);
    expect(new Set(variables).size).toBe(Object.keys(DEFAULT_PRODUCTION_LIMITS).length);
    const settings = loadProductionSettings({
      PRODUCTION_MAX_INSTANCES_PER_JOB: String(PRODUCTION_LIMIT_BOUNDS.maxInstancesPerJob.max),
      PRODUCTION_EXPANSION_BATCH_SIZE: '500',
      PRODUCTION_MAX_QUANTITY_PER_RECORD: '',
    });
    expect(settings.limits).toEqual({
      ...DEFAULT_PRODUCTION_LIMITS,
      maxInstancesPerJob: PRODUCTION_LIMIT_BOUNDS.maxInstancesPerJob.max,
      expansionBatchSize: 500,
    });
  });

  it('refuses values outside the bounds, naming the variable', () => {
    expect(() =>
      loadProductionSettings({
        PRODUCTION_MAX_INSTANCES_PER_JOB: String(
          PRODUCTION_LIMIT_BOUNDS.maxInstancesPerJob.max + 1,
        ),
      }),
    ).toThrow(/PRODUCTION_MAX_INSTANCES_PER_JOB/);
    expect(() => loadProductionSettings({ PRODUCTION_EXPANSION_BATCH_SIZE: 'many' })).toThrow(
      /PRODUCTION_EXPANSION_BATCH_SIZE/,
    );
  });
});

describe('job preconditions', () => {
  it('a stored configuration that is not valid stops the job instead of guessing', () => {
    expect(configurationOf(DEFAULT_PRODUCTION_CONFIGURATION)).toEqual(
      DEFAULT_PRODUCTION_CONFIGURATION,
    );
    expect(() => configurationOf({ version: 1 })).toThrow(ProductionPreconditionError);
    expect(() => configurationOf(null)).toThrow(/not valid/);
  });

  it('a template version that changed after the job was created stops the job', () => {
    expect(() => documentOf({}, 'a'.repeat(64), 'b'.repeat(64))).toThrow(
      /template version changed/,
    );
    expect(() => documentOf({ not: 'a document' }, 'a'.repeat(64), 'a'.repeat(64))).toThrow(
      /not a valid design document/,
    );
  });

  it('precondition failures are final; unexpected errors are retryable and say nothing internal', () => {
    expect(
      failureOf(new ProductionPreconditionError('DATASET_NOT_FINALIZED', 'Not final.')),
    ).toEqual({ code: 'DATASET_NOT_FINALIZED', message: 'Not final.', retryable: false });
    const unexpected = failureOf(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret'));
    expect(unexpected).toMatchObject({ code: 'PROCESSING_ERROR', retryable: true });
    expect(unexpected.message).not.toMatch(/ECONNREFUSED|secret|10\.0\.0\.5/);
  });

  it('reads json columns defensively', () => {
    expect(asObject({ a: 1 })).toEqual({ a: 1 });
    expect(asObject(null)).toEqual({});
    expect(asObject([1, 2])).toEqual({});
  });
});

describe('validation summary', () => {
  const issue = (layer: string, code: string, severity: 'ERROR' | 'WARNING'): InstanceIssue =>
    ({ layer, code, severity, message: code, field: null, target: null }) as InstanceIssue;

  it('counts instances per issue code, once per instance, worst first', () => {
    const builder = new ProductionSummaryBuilder();
    builder.add([]);
    builder.add([
      issue('PRODUCTION', 'QUANTITY_VALUE_INVALID', 'ERROR'),
      issue('OBJECT', 'IMAGE_SOURCE_MISSING', 'WARNING'),
      // The same code twice in one instance still counts as one instance.
      issue('OBJECT', 'IMAGE_SOURCE_MISSING', 'WARNING'),
    ]);
    builder.add([issue('OBJECT', 'IMAGE_SOURCE_MISSING', 'WARNING')]);

    const summary = builder.build();
    expect(summary.issueCounts).toEqual([
      { layer: 'OBJECT', code: 'IMAGE_SOURCE_MISSING', severity: 'WARNING', instances: 2 },
      { layer: 'PRODUCTION', code: 'QUANTITY_VALUE_INVALID', severity: 'ERROR', instances: 1 },
    ]);
  });

  it('never claims that layout was checked', () => {
    const summary = new ProductionSummaryBuilder().build();
    expect(summary).toMatchObject({
      issueCounts: [],
      layoutChecked: false,
      layoutNote: LAYOUT_NOTE,
    });
    expect(summary.layoutNote).toMatch(/Text layout .* was not/);
  });
});
