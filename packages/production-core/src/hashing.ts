import { SHA256_HEX_PATTERN, canonicalizeJson, sha256Hex } from '@smarttag/document-utils';
import { canonicalConfiguration, type ProductionConfiguration } from './configuration';
import { contextHashPayload, type ProductionContext } from './context';

/**
 * Identities of production data (docs/production-jobs.md#hashes). Every hash is SHA-256
 * (lower-case hex) of UTF-8 text; JSON is canonicalized with RFC 8785 (sorted keys, no
 * whitespace, shortest numbers), so the browser, the API and the worker all produce the same
 * digests. Batch processing hashes the `…Payload` texts synchronously with node:crypto; the async
 * functions here produce the same values through Web Crypto and are used for verification.
 */

/**
 * How a production instance is interpreted: which context values exist and how they are hashed.
 * A future renderer reads this to know exactly what it is rendering; a change in meaning means a
 * new contract version, never a redefinition of this one.
 */
export const PRODUCTION_INSTANCE_CONTRACT = 'smarttag-production-instance-v1' as const;
export const PRODUCTION_JOB_HASH_SCHEME = 'smarttag-production-job-v1' as const;
export const PRODUCTION_MANIFEST_SCHEME = 'smarttag-production-manifest-v1' as const;

export interface InstanceHashInput {
  readonly templateVersionHash: string;
  /** Hash of the dataset record this instance prints (Phase 4 record hash). */
  readonly recordHash: string;
  readonly context: ProductionContext;
}

/**
 * Instance hash: SHA-256 of canonical JSON
 *
 *   { scheme, templateVersionHash, recordHash, context }
 *
 * It identifies exactly what will be printed on one tag: the artwork (template version hash), the
 * data (record hash — the data itself, not the row it came from) and everything that makes this
 * tag different from the other copies of the same record (serial number, position, job number).
 * It deliberately contains no timestamp, user or database id.
 */
export function instanceHashPayload(input: InstanceHashInput): string {
  for (const [name, value] of [
    ['templateVersionHash', input.templateVersionHash],
    ['recordHash', input.recordHash],
  ] as const) {
    if (!SHA256_HEX_PATTERN.test(value)) {
      throw new RangeError(`${name} must be a lower-case SHA-256 hex digest`);
    }
  }
  return canonicalizeJson({
    scheme: PRODUCTION_INSTANCE_CONTRACT,
    templateVersionHash: input.templateVersionHash,
    recordHash: input.recordHash,
    context: contextHashPayload(input.context),
  });
}

export async function computeInstanceHash(input: InstanceHashInput): Promise<string> {
  return sha256Hex(instanceHashPayload(input));
}

/**
 * Instances digest: SHA-256 over the concatenation, in sequence order, of every instance hash
 * followed by "\n". One line per tag keeps it streamable: a job of a million instances never has
 * a million hashes in memory or in a JSON column.
 */
export function instancesDigestLine(instanceHash: string): string {
  if (!SHA256_HEX_PATTERN.test(instanceHash)) {
    throw new RangeError('instance hashes must be lower-case SHA-256 hex digests');
  }
  return `${instanceHash}\n`;
}

export async function computeInstancesDigest(instanceHashes: readonly string[]): Promise<string> {
  return sha256Hex(instanceHashes.map(instancesDigestLine).join(''));
}

export interface SerialReservationIdentity {
  /** Stable code of the sequence, not its database id. */
  readonly sequenceCode: string;
  readonly startValue: number;
  readonly endValue: number;
}

export interface ProductionJobHashInput {
  readonly templateVersionHash: string;
  readonly datasetHash: string;
  readonly dataSchemaHash: string;
  readonly configuration: ProductionConfiguration;
  readonly serialReservation: SerialReservationIdentity | null;
  readonly instanceCount: number;
  readonly instancesDigest: string;
  readonly contractVersion: string;
}

/**
 * Production job hash: SHA-256 of canonical JSON over the immutable inputs and the exact ordered
 * result — artwork, data, configuration, serial range, instance count, instances digest and the
 * interpretation contract. Names, customers, users and times are stored next to it, never hashed.
 */
export function productionJobHashPayload(input: ProductionJobHashInput): string {
  for (const [name, value] of [
    ['templateVersionHash', input.templateVersionHash],
    ['datasetHash', input.datasetHash],
    ['dataSchemaHash', input.dataSchemaHash],
    ['instancesDigest', input.instancesDigest],
  ] as const) {
    if (!SHA256_HEX_PATTERN.test(value)) {
      throw new RangeError(`${name} must be a lower-case SHA-256 hex digest`);
    }
  }
  if (!Number.isInteger(input.instanceCount) || input.instanceCount < 0) {
    throw new RangeError('instanceCount must be a whole number');
  }
  return canonicalizeJson({
    scheme: PRODUCTION_JOB_HASH_SCHEME,
    templateVersionHash: input.templateVersionHash,
    datasetHash: input.datasetHash,
    dataSchemaHash: input.dataSchemaHash,
    configuration: canonicalConfiguration(input.configuration),
    serialReservation: input.serialReservation,
    instanceCount: input.instanceCount,
    instancesDigest: input.instancesDigest,
    contractVersion: input.contractVersion,
  });
}

export async function computeProductionJobHash(input: ProductionJobHashInput): Promise<string> {
  return sha256Hex(productionJobHashPayload(input));
}

/** The exact record selection a job produced, hashed so a partial job stays reproducible. */
export function recordSelectionHashPayload(sequences: readonly number[]): string {
  return canonicalizeJson({
    scheme: 'smarttag-production-selection-v1',
    sequences: [...new Set(sequences)].sort((a, b) => a - b),
  });
}

export async function computeRecordSelectionHash(sequences: readonly number[]): Promise<string> {
  return sha256Hex(recordSelectionHashPayload(sequences));
}
