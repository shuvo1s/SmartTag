import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DATA_IMPORT_STATUSES,
  DATA_IMPORT_TRANSITIONS,
  IMPORT_NORMALIZATION_VERSION,
  ImportTransitionError,
  assertImportTransition,
  canEditImport,
  canFinalizeImport,
  computeDatasetHash,
  computeRecordHash,
  computeRecordsDigest,
  datasetHashPayload,
  emptyMapping,
  isImportProcessing,
  isImportTerminal,
  mappingEntry,
  recordsDigestLine,
  validatedStatus,
  type DatasetHashInput,
} from '../src';

const H = (character: string) => character.repeat(64);

describe('record and dataset hashes', () => {
  it('record hashes do not depend on key order', async () => {
    const a = await computeRecordHash({ size: 'XL', price: '39.95' });
    const b = await computeRecordHash({ price: '39.95', size: 'XL' });
    expect(a).toBe(b);
    expect(await computeRecordHash({ price: '39.90', size: 'XL' })).not.toBe(a);
  });

  it('the records digest is SHA-256 over "hash\\n" lines in order, computable incrementally', async () => {
    const hashes = [H('1'), H('2'), H('1')];
    const incremental = createHash('sha256');
    for (const hash of hashes) incremental.update(recordsDigestLine(hash));
    expect(await computeRecordsDigest(hashes)).toBe(incremental.digest('hex'));
    expect(await computeRecordsDigest([H('2'), H('1'), H('1')])).not.toBe(
      await computeRecordsDigest(hashes),
    );
    expect(() => recordsDigestLine('not-a-hash')).toThrow(RangeError);
  });

  const input: DatasetHashInput = {
    templateVersionHash: H('a'),
    dataSchemaHash: H('b'),
    mapping: {
      ...emptyMapping(),
      entries: [
        mappingEntry('size', { index: 1, header: 'SIZE' }),
        mappingEntry('color', { index: 0, header: 'COLOR' }),
      ],
    },
    normalizationVersion: IMPORT_NORMALIZATION_VERSION,
    recordCount: 3,
    recordsDigest: H('c'),
  };

  it('the dataset hash is deterministic and independent of mapping entry order', async () => {
    const hash = await computeDatasetHash(input);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const reordered = {
      ...input,
      mapping: { ...input.mapping, entries: [...input.mapping.entries].reverse() },
    };
    expect(await computeDatasetHash(reordered)).toBe(hash);
    expect(createHash('sha256').update(datasetHashPayload(input)).digest('hex')).toBe(hash);
  });

  it.each([
    ['template version', { templateVersionHash: H('d') }],
    ['data schema', { dataSchemaHash: H('d') }],
    ['records', { recordsDigest: H('d') }],
    ['record count', { recordCount: 4 }],
    ['normalization rules', { normalizationVersion: 'smarttag-import-normalization-2' }],
  ])('changes when the %s changes', async (_label, change) => {
    expect(await computeDatasetHash({ ...input, ...change })).not.toBe(
      await computeDatasetHash(input),
    );
  });

  it('changes when parsing rules change', async () => {
    const comma = {
      ...input,
      mapping: {
        ...input.mapping,
        parsing: {
          ...input.mapping.parsing,
          number: { decimalSeparator: ',', thousandsSeparator: 'NONE' },
        },
      },
    } as DatasetHashInput;
    expect(await computeDatasetHash(comma)).not.toBe(await computeDatasetHash(input));
  });

  it('refuses malformed inputs', () => {
    expect(() => datasetHashPayload({ ...input, recordsDigest: 'x' })).toThrow(RangeError);
    expect(() => datasetHashPayload({ ...input, recordCount: -1 })).toThrow(RangeError);
  });
});

describe('import lifecycle', () => {
  it('has a transition list for every status and terminal states have none', () => {
    expect(Object.keys(DATA_IMPORT_TRANSITIONS).sort()).toEqual([...DATA_IMPORT_STATUSES].sort());
    expect(DATA_IMPORT_TRANSITIONS.FINALIZED).toEqual([]);
    expect(DATA_IMPORT_TRANSITIONS.CANCELLED).toEqual([]);
    expect(isImportTerminal('FINALIZED')).toBe(true);
  });

  it('refuses invalid transitions', () => {
    expect(() => assertImportTransition('HAS_ERRORS', 'FINALIZED')).toThrow(ImportTransitionError);
    expect(() => assertImportTransition('MAPPING_REQUIRED', 'VALIDATING')).toThrow(
      /MAPPING_REQUIRED to VALIDATING/,
    );
    expect(() => assertImportTransition('FINALIZED', 'VALIDATING')).toThrow();
    expect(() => assertImportTransition('CANCELLED', 'INSPECTING')).toThrow();
    expect(() => assertImportTransition('VALIDATING', 'MAPPING_REQUIRED')).toThrow();
    expect(() => assertImportTransition('READY_WITH_WARNINGS', 'FINALIZED')).not.toThrow();
    expect(() => assertImportTransition('FAILED', 'VALIDATING')).not.toThrow();
  });

  it('finalization requires validation results without errors', () => {
    expect(DATA_IMPORT_STATUSES.filter(canFinalizeImport)).toEqual([
      'READY',
      'READY_WITH_WARNINGS',
    ]);
    expect(validatedStatus({ errorRows: 1, warningRows: 5 })).toBe('HAS_ERRORS');
    expect(validatedStatus({ errorRows: 0, warningRows: 5 })).toBe('READY_WITH_WARNINGS');
    expect(validatedStatus({ errorRows: 0, warningRows: 0 })).toBe('READY');
  });

  it('settings and mapping are editable only between processing steps', () => {
    expect(DATA_IMPORT_STATUSES.filter(canEditImport)).toEqual([
      'MAPPING_REQUIRED',
      'READY_TO_VALIDATE',
      'READY',
      'READY_WITH_WARNINGS',
      'HAS_ERRORS',
    ]);
    expect(DATA_IMPORT_STATUSES.filter(isImportProcessing)).toEqual([
      'UPLOADED',
      'INSPECTING',
      'VALIDATING',
    ]);
  });
});
