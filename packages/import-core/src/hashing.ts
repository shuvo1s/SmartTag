import type { NormalizedDataRecord } from '@smarttag/data-core';
import { SHA256_HEX_PATTERN, canonicalizeJson, sha256Hex } from '@smarttag/document-utils';
import { canonicalMapping, type MappingDefinition } from './mapping';

/**
 * Identities of imported data (docs/datasets.md#hashes). Every hash is SHA-256 (lower-case hex)
 * of UTF-8 text; JSON is canonicalized with RFC 8785 (sorted keys, no whitespace, shortest
 * numbers), so results are identical in every browser and in Node.js.
 *
 * Batch processors hash many rows with a synchronous SHA-256 over the `…Payload` texts; the async
 * functions here produce the same hashes with Web Crypto and are used for verification and tests.
 */

export const RECORD_HASH_SCHEME = 'smarttag-dataset-record-v1' as const;
export const DATASET_HASH_SCHEME = 'smarttag-dataset-version-v1' as const;
export const RECORDS_DIGEST_SCHEME = 'smarttag-dataset-records-v1' as const;

/**
 * Version of the import normalization rules (cell reading, number/date/boolean parsing). Stored
 * with every dataset version and part of the dataset hash; bumped whenever the same file and
 * mapping could produce different normalized records.
 */
export const IMPORT_NORMALIZATION_VERSION = 'smarttag-import-normalization-1' as const;

/**
 * Record hash: SHA-256 of canonical JSON `{ scheme, record }` where record is the normalized
 * record. It depends only on the data (not on the row number or template), so identical rows have
 * identical hashes — which is how duplicates are recognised without ever removing them.
 */
export function recordHashPayload(record: NormalizedDataRecord): string {
  return canonicalizeJson({ scheme: RECORD_HASH_SCHEME, record });
}

export async function computeRecordHash(record: NormalizedDataRecord): Promise<string> {
  return sha256Hex(recordHashPayload(record));
}

/**
 * Records digest: SHA-256 over the concatenation, in sequence order, of every record hash
 * followed by "\n". It fixes the exact ordered list of records (duplicates and order included)
 * in 64 characters and can be computed incrementally while rows stream.
 */
export function recordsDigestLine(recordHash: string): string {
  if (!SHA256_HEX_PATTERN.test(recordHash)) {
    throw new RangeError('record hashes must be lower-case SHA-256 hex digests');
  }
  return `${recordHash}\n`;
}

export async function computeRecordsDigest(recordHashes: readonly string[]): Promise<string> {
  return sha256Hex(recordHashes.map(recordsDigestLine).join(''));
}

export interface DatasetHashInput {
  readonly templateVersionHash: string;
  readonly dataSchemaHash: string;
  readonly mapping: MappingDefinition;
  readonly normalizationVersion: string;
  readonly recordCount: number;
  readonly recordsDigest: string;
}

/**
 * Dataset version hash: SHA-256 of canonical JSON
 *
 *   { scheme, templateVersionHash, dataSchemaHash, mapping (canonical), normalizationVersion,
 *     recordCount, recordsDigest }
 *
 * The same normalized records produced for the same template version by the same mapping and
 * normalization rules always give the same hash. Names, descriptions, file names, upload times,
 * users and the file's own checksum are not part of it (they are stored separately): a CSV and an
 * XLSX export of identical data mapped identically are the same dataset content.
 */
export function datasetHashPayload(input: DatasetHashInput): string {
  for (const [name, value] of [
    ['templateVersionHash', input.templateVersionHash],
    ['dataSchemaHash', input.dataSchemaHash],
    ['recordsDigest', input.recordsDigest],
  ] as const) {
    if (!SHA256_HEX_PATTERN.test(value)) {
      throw new RangeError(`${name} must be a lower-case SHA-256 hex digest`);
    }
  }
  if (!Number.isInteger(input.recordCount) || input.recordCount < 0) {
    throw new RangeError('recordCount must be a non-negative integer');
  }
  return canonicalizeJson({
    scheme: DATASET_HASH_SCHEME,
    templateVersionHash: input.templateVersionHash,
    dataSchemaHash: input.dataSchemaHash,
    mapping: canonicalMapping(input.mapping),
    normalizationVersion: input.normalizationVersion,
    recordCount: input.recordCount,
    recordsDigest: input.recordsDigest,
  });
}

export async function computeDatasetHash(input: DatasetHashInput): Promise<string> {
  return sha256Hex(datasetHashPayload(input));
}
