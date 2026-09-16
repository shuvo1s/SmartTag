import { computeResolvedInputHash } from '@smarttag/data-core';
import { SYSTEM_FIELD_KEYS } from '@smarttag/document-schema';
import { canonicalizeJson } from '@smarttag/document-utils';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRODUCTION_CONFIGURATION,
  DEFAULT_PRODUCTION_LIMITS,
  InstanceLimitExceededError,
  PRODUCTION_INSTANCE_CONTRACT,
  allowedTransitions,
  canTransition,
  checkQuantityField,
  computeInstanceHash,
  computeInstancesDigest,
  computeProductionJobHash,
  countInstances,
  createInstanceProcessor,
  dependsOnInstanceContext,
  documentSystemFields,
  expandRecords,
  formatJobNumber,
  formatSerial,
  instanceHashPayload,
  instancesDigestLine,
  jobNumberDay,
  previewSerials,
  productionJobHashPayload,
  resolveQuantity,
  serialAt,
  serialRange,
  statusForCounts,
  systemValuesFor,
  type ExpandableRecord,
  type ProductionConfiguration,
} from '../src';
import {
  DATASET_HASH,
  RECORD,
  RECORD_HASH,
  SCHEMA_HASH,
  TEMPLATE_HASH,
  context,
  documentWithSerialText,
  vdpDocument,
} from './fixtures';

const record = (
  sequence: number,
  overrides: Record<string, string | number | boolean | null> = {},
): ExpandableRecord => ({
  sequence,
  rowNumber: sequence + 1,
  record: { ...RECORD, ...overrides },
  recordHash: RECORD_HASH,
});

const withQuantity = (
  overrides: Partial<ProductionConfiguration> = {},
): ProductionConfiguration => ({
  ...DEFAULT_PRODUCTION_CONFIGURATION,
  quantity: { mode: 'FIELD', field: 'quantity', whenMissing: 'REFUSE', defaultQuantity: 1 },
  ...overrides,
});

const schema = vdpDocument().dataSchema;
const quantitySchema = {
  fields: [
    ...schema.fields,
    {
      key: 'quantity',
      displayName: 'Quantity',
      type: 'number' as const,
      required: false,
      description: '',
      defaultValue: null,
      validation: { integer: true, min: null, max: null, allowedValues: null },
    },
  ],
};

describe('quantity', () => {
  it('ONE_PER_RECORD produces exactly one tag per record', () => {
    const result = resolveQuantity(
      RECORD,
      DEFAULT_PRODUCTION_CONFIGURATION,
      DEFAULT_PRODUCTION_LIMITS,
    );
    expect(result).toEqual({ ok: true, quantity: 1 });
  });

  it('reads whole numbers from a field, as numbers or as digits in text', () => {
    for (const value of [500, '500']) {
      expect(
        resolveQuantity({ quantity: value }, withQuantity(), DEFAULT_PRODUCTION_LIMITS),
      ).toEqual({ ok: true, quantity: 500 });
    }
  });

  it.each([
    [0, /at least one tag/],
    [-1, /at least one tag/],
    [2.5, /not a whole number/],
    ['five', /not a whole number/],
    ['2.5', /not a whole number/],
  ])('refuses the quantity %p', (value, message) => {
    const result = resolveQuantity({ quantity: value }, withQuantity(), DEFAULT_PRODUCTION_LIMITS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.code).toBe('QUANTITY_VALUE_INVALID');
    expect(result.issue.message).toMatch(message);
    expect(result.issue.severity).toBe('ERROR');
  });

  it('a missing value either refuses the record or uses the configured default', () => {
    const refuse = resolveQuantity({}, withQuantity(), DEFAULT_PRODUCTION_LIMITS);
    expect(refuse).toMatchObject({ ok: false, issue: { code: 'QUANTITY_VALUE_MISSING' } });

    const fallback = withQuantity({
      quantity: { mode: 'FIELD', field: 'quantity', whenMissing: 'DEFAULT', defaultQuantity: 12 },
    });
    expect(resolveQuantity({ quantity: null }, fallback, DEFAULT_PRODUCTION_LIMITS)).toEqual({
      ok: true,
      quantity: 12,
    });
  });

  it('refuses quantities above the per-record limit', () => {
    const limits = { ...DEFAULT_PRODUCTION_LIMITS, maxQuantityPerRecord: 1_000 };
    const result = resolveQuantity({ quantity: 1_001 }, withQuantity(), limits);
    expect(result).toMatchObject({ ok: false, issue: { code: 'QUANTITY_LIMIT_EXCEEDED' } });
  });

  it('only fields that can hold whole numbers may be chosen', () => {
    expect(checkQuantityField(quantitySchema, 'quantity').ok).toBe(true);
    expect(checkQuantityField(quantitySchema, 'is_sustainable')).toMatchObject({ ok: false });
    expect(checkQuantityField(quantitySchema, 'missing')).toMatchObject({ ok: false });
    // Text and decimal fields are allowed: the value itself decides, per record.
    expect(checkQuantityField(quantitySchema, 'style').ok).toBe(true);
  });
});

describe('expansion', () => {
  const records = [
    record(1, { quantity: 2 }),
    record(2, { quantity: 3 }),
    record(3, { quantity: 1 }),
  ];

  it('expands quantities in record order, copy by copy', () => {
    const instances = [
      ...expandRecords(records, {
        configuration: withQuantity(),
        limits: DEFAULT_PRODUCTION_LIMITS,
        schema: quantitySchema,
      }),
    ];
    expect(instances).toHaveLength(6);
    expect(
      instances.map((instance) => [instance.sequence, instance.recordSequence, instance.copyIndex]),
    ).toEqual([
      [1, 1, 1],
      [2, 1, 2],
      [3, 2, 1],
      [4, 2, 2],
      [5, 2, 3],
      [6, 3, 1],
    ]);
    expect(instances.map((instance) => instance.sourceRow)).toEqual([2, 2, 3, 3, 3, 4]);
  });

  it('keeps duplicate records: identical rows are separate tags', () => {
    const duplicates = [record(1, { quantity: 5 }), record(2, { quantity: 5 })];
    const instances = [
      ...expandRecords(duplicates, {
        configuration: withQuantity(),
        limits: DEFAULT_PRODUCTION_LIMITS,
        schema: quantitySchema,
      }),
    ];
    expect(instances).toHaveLength(10);
    expect(new Set(instances.map((instance) => instance.recordSequence))).toEqual(new Set([1, 2]));
  });

  it('a record with an unusable quantity becomes one instance carrying the error', () => {
    const instances = [
      ...expandRecords([record(1, { quantity: 'five' })], {
        configuration: withQuantity(),
        limits: DEFAULT_PRODUCTION_LIMITS,
        schema: quantitySchema,
      }),
    ];
    expect(instances).toHaveLength(1);
    expect(instances[0]!.issues).toMatchObject([{ code: 'QUANTITY_VALUE_INVALID' }]);
  });

  it('refuses to expand beyond the job limit', () => {
    const limits = { ...DEFAULT_PRODUCTION_LIMITS, maxInstancesPerJob: 4 };
    const options = { configuration: withQuantity(), limits, schema: quantitySchema };
    expect(() => [...expandRecords(records, options)]).toThrow(InstanceLimitExceededError);
    expect(() => countInstances(records, options)).toThrow(/more than 4 tags/);
  });

  it('counts instances without building them', () => {
    expect(
      countInstances(records, {
        configuration: withQuantity(),
        limits: DEFAULT_PRODUCTION_LIMITS,
        schema: quantitySchema,
      }),
    ).toEqual({ instanceCount: 6, invalidRecords: 0 });
  });

  it('continues numbering across batches', () => {
    const second = [
      ...expandRecords([record(4, { quantity: 2 })], {
        configuration: withQuantity(),
        limits: DEFAULT_PRODUCTION_LIMITS,
        schema: quantitySchema,
        startSequence: 7,
      }),
    ];
    expect(second.map((instance) => instance.sequence)).toEqual([7, 8]);
  });
});

describe('serial numbers', () => {
  const format = { prefix: 'YT-', suffix: '', padding: 8 };

  it('formats numbers deterministically', () => {
    expect(formatSerial(1257, format)).toBe('YT-00001257');
    expect(formatSerial(1, { prefix: '', suffix: '', padding: 0 })).toBe('1');
    expect(formatSerial(42, { prefix: 'A', suffix: '/26', padding: 4 })).toBe('A0042/26');
  });

  it('a range covers exactly the instances of the job', () => {
    expect(serialRange(1_000_001, 20_000)).toEqual({
      startValue: 1_000_001,
      endValue: 1_020_000,
      count: 20_000,
    });
    expect(() => serialRange(0, 5)).toThrow();
    expect(() => serialRange(5, 0)).toThrow();
  });

  it('previews the numbers without reserving them', () => {
    const preview = previewSerials(10_001, 20_000, format, 3);
    expect(preview).toMatchObject({
      first: 'YT-00010001',
      last: 'YT-00030000',
      samples: ['YT-00010001', 'YT-00010002', 'YT-00010003'],
      provisional: true,
    });
  });

  it('maps an instance to its serial inside the reserved range', () => {
    const range = serialRange(1_000_001, 3);
    expect(serialAt(range, 0, format)).toBe('YT-01000001');
    expect(serialAt(range, 2, format)).toBe('YT-01000003');
    expect(() => serialAt(range, 3, format)).toThrow(/outside the reserved serial range/);
  });
});

describe('job numbers', () => {
  it('formats and reads back the day', () => {
    expect(formatJobNumber('2026-09-16', 123)).toBe('PJ-20260916-000123');
    expect(jobNumberDay('PJ-20260916-000123')).toBe('2026-09-16');
    expect(jobNumberDay('nonsense')).toBeNull();
  });

  it('refuses impossible counters', () => {
    expect(() => formatJobNumber('2026-09-16', 0)).toThrow();
    expect(() => formatJobNumber('2026-09-16', 1_000_000)).toThrow();
  });
});

describe('production context and system fields', () => {
  it('exposes the context as system field values', () => {
    expect(systemValuesFor(context())).toEqual({
      [SYSTEM_FIELD_KEYS.SERIAL]: 'YT-00001257',
      [SYSTEM_FIELD_KEYS.INSTANCE_INDEX]: 1,
      [SYSTEM_FIELD_KEYS.COPY_INDEX]: 1,
      [SYSTEM_FIELD_KEYS.SOURCE_ROW]: 2,
      [SYSTEM_FIELD_KEYS.JOB_NUMBER]: 'PJ-20260916-000123',
    });
  });

  it('leaves out a serial number that has not been allocated yet', () => {
    expect(systemValuesFor(context({ serial: null }))).not.toHaveProperty(SYSTEM_FIELD_KEYS.SERIAL);
  });

  it('finds the system fields a template uses', () => {
    expect(documentSystemFields(vdpDocument())).toEqual([]);
    expect(dependsOnInstanceContext(vdpDocument())).toBe(false);
    expect(documentSystemFields(documentWithSerialText())).toEqual([SYSTEM_FIELD_KEYS.SERIAL]);
    expect(dependsOnInstanceContext(documentWithSerialText())).toBe(true);
  });
});

describe('instance resolution', () => {
  it('resolves a valid instance through the Phase 3 engine', async () => {
    const processor = createInstanceProcessor({
      document: vdpDocument(),
      templateVersionHash: TEMPLATE_HASH,
      assetAvailability: () => 'AVAILABLE',
    });
    const instance = processor.resolve(RECORD, RECORD_HASH, context());
    expect(instance.status).toBe('VALID');
    expect(instance.issues).toEqual([]);
    expect(instance.pendingSystemFields).toEqual([]);
    // The resolved-input hash is exactly the Phase 3 hash of artwork plus data.
    expect(await computeResolvedInputHash(TEMPLATE_HASH, RECORD)).toBe(
      await sha256(instance.resolvedInputHashPayload),
    );
  });

  it('prints the serial number when the context has one', () => {
    const processor = createInstanceProcessor({
      document: documentWithSerialText(),
      templateVersionHash: TEMPLATE_HASH,
    });
    const instance = processor.resolve(RECORD, RECORD_HASH, context({ serial: 'YT-00000042' }));
    expect(instance.status).toBe('VALID');
    expect(instance.pendingSystemFields).toEqual([]);
  });

  it('a serial number that production has not allocated is pending, not missing data', () => {
    const processor = createInstanceProcessor({
      document: documentWithSerialText(),
      templateVersionHash: TEMPLATE_HASH,
    });
    const instance = processor.resolve(RECORD, RECORD_HASH, context({ serial: null }));
    expect(instance.status).toBe('VALID');
    expect(instance.issues).toEqual([]);
    expect(instance.pendingSystemFields).toEqual([SYSTEM_FIELD_KEYS.SERIAL]);
  });

  it('reports invalid resolved values, for example a wrong barcode check digit', () => {
    const processor = createInstanceProcessor({
      document: vdpDocument(),
      templateVersionHash: TEMPLATE_HASH,
    });
    const instance = processor.resolve(
      { ...RECORD, gtin: '9501234567890' },
      RECORD_HASH,
      context(),
    );
    expect(instance.status).toBe('ERROR');
    expect(instance.issues).toMatchObject([{ layer: 'OBJECT', code: 'BARCODE_VALUE_INVALID' }]);
    expect(instance.errorCount).toBe(1);
  });

  it('reports an image asset of another organization as unavailable', () => {
    const processor = createInstanceProcessor({
      document: vdpDocument(),
      templateVersionHash: TEMPLATE_HASH,
      assetAvailability: () => 'UNAVAILABLE',
    });
    const instance = processor.resolve(
      { ...RECORD, product_image: '0192b8a0-0000-7000-8000-00000000abcd' },
      RECORD_HASH,
      context(),
    );
    expect(instance.status).toBe('ERROR');
    expect(instance.issues).toMatchObject([{ code: 'IMAGE_ASSET_UNAVAILABLE' }]);
  });

  it('carries quantity problems into the instance', () => {
    const processor = createInstanceProcessor({
      document: vdpDocument(),
      templateVersionHash: TEMPLATE_HASH,
    });
    const quantityIssue = resolveQuantity({}, withQuantity(), DEFAULT_PRODUCTION_LIMITS);
    expect(quantityIssue.ok).toBe(false);
    if (quantityIssue.ok) return;
    const instance = processor.resolve(RECORD, RECORD_HASH, context(), [quantityIssue.issue]);
    expect(instance.status).toBe('ERROR');
    expect(instance.issues[0]).toMatchObject({
      layer: 'PRODUCTION',
      code: 'QUANTITY_VALUE_MISSING',
    });
  });
});

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('hashing', () => {
  it('the instance hash depends on artwork, data and context only', async () => {
    const base = {
      templateVersionHash: TEMPLATE_HASH,
      recordHash: RECORD_HASH,
      context: context(),
    };
    const hash = await computeInstanceHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await computeInstanceHash({ ...base })).toBe(hash);
    expect(
      await computeInstanceHash({ ...base, context: context({ serial: 'YT-00001258' }) }),
    ).not.toBe(hash);
    expect(
      await computeInstanceHash({ ...base, context: context({ copyIndex: 2, instanceIndex: 2 }) }),
    ).not.toBe(hash);
    expect(JSON.parse(instanceHashPayload(base))).toMatchObject({
      scheme: PRODUCTION_INSTANCE_CONTRACT,
      context: { copyIndex: 1, instanceIndex: 1, serial: 'YT-00001257', sourceRow: 2 },
    });
  });

  it('two copies of one record differ only by their context', async () => {
    const first = await computeInstanceHash({
      templateVersionHash: TEMPLATE_HASH,
      recordHash: RECORD_HASH,
      context: context({ copyIndex: 1, instanceIndex: 1, serial: null }),
    });
    const second = await computeInstanceHash({
      templateVersionHash: TEMPLATE_HASH,
      recordHash: RECORD_HASH,
      context: context({ copyIndex: 2, instanceIndex: 2, serial: null }),
    });
    expect(first).not.toBe(second);
  });

  it('the instances digest is the ordered list of instance hashes', async () => {
    const hashes = ['1'.repeat(64), '2'.repeat(64)];
    expect(await computeInstancesDigest(hashes)).toBe(
      await sha256(hashes.map(instancesDigestLine).join('')),
    );
    expect(await computeInstancesDigest(hashes)).not.toBe(
      await computeInstancesDigest([...hashes].reverse()),
    );
    expect(() => instancesDigestLine('nope')).toThrow();
  });

  it('the job hash covers the inputs, configuration, serial range and ordered result', async () => {
    const input = {
      templateVersionHash: TEMPLATE_HASH,
      datasetHash: DATASET_HASH,
      dataSchemaHash: SCHEMA_HASH,
      configuration: DEFAULT_PRODUCTION_CONFIGURATION,
      serialReservation: { sequenceCode: 'YT-HANGTAG', startValue: 1, endValue: 6 },
      instanceCount: 6,
      instancesDigest: 'e'.repeat(64),
      contractVersion: PRODUCTION_INSTANCE_CONTRACT,
    };
    const hash = await computeProductionJobHash(input);
    expect(await computeProductionJobHash({ ...input })).toBe(hash);
    expect(
      await computeProductionJobHash({
        ...input,
        serialReservation: { sequenceCode: 'YT-HANGTAG', startValue: 2, endValue: 7 },
      }),
    ).not.toBe(hash);
    expect(await computeProductionJobHash({ ...input, instanceCount: 7 })).not.toBe(hash);
    // The record selection is canonical: the same records in another order hash identically.
    const selection = (sequences: number[]): ProductionConfiguration => ({
      ...DEFAULT_PRODUCTION_CONFIGURATION,
      recordSelection: { mode: 'SEQUENCES', sequences },
    });
    expect(productionJobHashPayload({ ...input, configuration: selection([3, 1, 2]) })).toBe(
      productionJobHashPayload({ ...input, configuration: selection([1, 2, 3]) }),
    );
  });

  it('hashes canonical JSON, so key order never matters', () => {
    expect(canonicalizeJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe('lifecycle', () => {
  it('refuses transitions that would change released production', () => {
    expect(canTransition('DRAFT', 'QUEUED')).toBe(true);
    expect(canTransition('READY', 'RELEASED')).toBe(true);
    expect(canTransition('HAS_ERRORS', 'RELEASED')).toBe(false);
    expect(canTransition('RELEASED', 'DRAFT')).toBe(false);
    expect(canTransition('RELEASED', 'CANCELLED')).toBe(false);
    expect(canTransition('READY_FOR_RENDERING', 'RELEASED')).toBe(false);
    expect(canTransition('CANCELLED', 'DRAFT')).toBe(false);
    expect(allowedTransitions('READY_FOR_RENDERING')).toEqual([]);
  });

  it('a released job can only finish its release work', () => {
    expect(allowedTransitions('RELEASED')).toEqual(['READY_FOR_RENDERING', 'FAILED']);
  });

  it('derives the reviewable status from the instance counts', () => {
    expect(statusForCounts({ errorCount: 0, warningCount: 0 })).toBe('READY');
    expect(statusForCounts({ errorCount: 0, warningCount: 3 })).toBe('READY_WITH_WARNINGS');
    expect(statusForCounts({ errorCount: 1, warningCount: 3 })).toBe('HAS_ERRORS');
  });
});
