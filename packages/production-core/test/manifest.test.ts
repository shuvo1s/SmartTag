import { canonicalizeJson, sha256Hex } from '@smarttag/document-utils';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRODUCTION_CONFIGURATION,
  INSTANCE_ORDERING,
  PRODUCTION_INSTANCE_CONTRACT,
  buildProductionManifest,
  computeProductionJobHash,
  manifestJobHashPayload,
  serializeManifest,
  verifyProductionManifest,
  type ManifestExpectation,
  type ProductionManifest,
} from '../src';
import { DATASET_HASH, SCHEMA_HASH, TEMPLATE_HASH } from './fixtures';

const INSTANCES_DIGEST = 'f'.repeat(64);

const RESERVATION = {
  sequenceCode: 'YT-HANGTAG',
  sequenceName: 'Yunusco hang tags',
  startValue: 1_000_001,
  endValue: 1_018_200,
  firstSerial: 'YT-01000001',
  lastSerial: 'YT-01018200',
};

async function manifest(): Promise<ProductionManifest> {
  const productionJobHash = await computeProductionJobHash({
    templateVersionHash: TEMPLATE_HASH,
    datasetHash: DATASET_HASH,
    dataSchemaHash: SCHEMA_HASH,
    configuration: DEFAULT_PRODUCTION_CONFIGURATION,
    serialReservation: {
      sequenceCode: RESERVATION.sequenceCode,
      startValue: RESERVATION.startValue,
      endValue: RESERVATION.endValue,
    },
    instanceCount: 18_200,
    instancesDigest: INSTANCES_DIGEST,
    contractVersion: PRODUCTION_INSTANCE_CONTRACT,
  });
  return buildProductionManifest({
    job: {
      id: '0192b8a0-0000-7000-8000-000000000001',
      jobNumber: 'PJ-20260916-000123',
      name: 'FW26 hang tags',
      productionMode: 'PRODUCTION',
      organizationId: '0192b8a0-0000-7000-8000-0000000000aa',
      customer: { id: '0192b8a0-0000-7000-8000-0000000000bb', name: 'Customer ABC' },
      brand: null,
    },
    template: {
      templateId: '0192b8a0-0000-7000-8000-0000000000cc',
      templateCode: 'HT-VDP-50X90',
      versionId: '0192b8a0-0000-7000-8000-0000000000dd',
      versionNumber: 3,
      documentHash: TEMPLATE_HASH,
      schemaVersion: 3,
      status: 'APPROVED',
    },
    dataset: {
      datasetId: '0192b8a0-0000-7000-8000-0000000000ee',
      datasetName: 'Customer ABC — FW26 hang tags',
      versionId: '0192b8a0-0000-7000-8000-0000000000ff',
      versionNumber: 2,
      datasetHash: DATASET_HASH,
      recordCount: 1_250,
    },
    dataSchemaHash: SCHEMA_HASH,
    configuration: DEFAULT_PRODUCTION_CONFIGURATION,
    recordSelectionHash: null,
    serialReservation: RESERVATION,
    instances: {
      count: 18_200,
      validCount: 18_188,
      warningCount: 12,
      errorCount: 0,
      digest: INSTANCES_DIGEST,
    },
    productionJobHash,
    versions: {
      contract: PRODUCTION_INSTANCE_CONTRACT,
      resolver: 'smarttag-data-core-1',
      importNormalization: 'smarttag-import-normalization-1',
    },
    releasedAt: '2026-09-16T09:12:44.120Z',
    releasedBy: { id: '0192b8a0-0000-7000-8000-000000000111', displayName: 'Demo Production' },
    createdAt: '2026-09-16T08:55:01.000Z',
  });
}

async function expectation(built: ProductionManifest): Promise<ManifestExpectation> {
  const stored = serializeManifest(built);
  return {
    checksumSha256: await sha256Hex(stored),
    actualChecksumSha256: await sha256Hex(stored),
    productionJobHash: built.productionJobHash,
    instanceCount: built.instances.count,
    instancesDigest: built.instances.digest,
    serialReservation: {
      sequenceCode: RESERVATION.sequenceCode,
      startValue: RESERVATION.startValue,
      endValue: RESERVATION.endValue,
    },
  };
}

describe('production manifest', () => {
  it('states the instance ordering and never overstates what was checked', async () => {
    const built = await manifest();
    expect(built.instances.ordering).toBe(INSTANCE_ORDERING);
    expect(built.validation).toMatchObject({ contentValidated: true, layoutFullyChecked: false });
    expect(built.validation.note).toMatch(/Text layout .* was not/);
    expect(built.contractVersion).toBe(PRODUCTION_INSTANCE_CONTRACT);
  });

  it('is stored as canonical JSON, so its checksum depends only on its content', async () => {
    const built = await manifest();
    const stored = serializeManifest(built);
    expect(stored.endsWith('\n')).toBe(true);
    expect(stored.trimEnd()).toBe(canonicalizeJson(built));
    // The same manifest with its keys written in another order is byte-identical.
    const shuffled = JSON.parse(JSON.stringify(built)) as ProductionManifest;
    expect(serializeManifest(shuffled)).toBe(stored);
  });

  it('carries a job hash that can be recomputed from the manifest alone', async () => {
    const built = await manifest();
    expect(await sha256Hex(manifestJobHashPayload(built))).toBe(built.productionJobHash);
  });

  it('verifies a stored manifest', async () => {
    const built = await manifest();
    const stored = serializeManifest(built);
    expect(verifyProductionManifest(built, stored, await expectation(built))).toEqual([]);
  });

  it('detects a changed file, a changed job and a changed serial range', async () => {
    const built = await manifest();
    const stored = serializeManifest(built);
    const base = await expectation(built);

    expect(
      verifyProductionManifest(built, stored, { ...base, actualChecksumSha256: '0'.repeat(64) }),
    ).toMatchObject([{ code: 'MANIFEST_CHECKSUM_MISMATCH' }]);

    expect(
      verifyProductionManifest(built, `${stored} `, base).map((issue) => issue.code),
    ).toContain('MANIFEST_NOT_CANONICAL');

    expect(
      verifyProductionManifest(built, stored, { ...base, instanceCount: 18_201 }),
    ).toMatchObject([{ code: 'INSTANCE_COUNT_MISMATCH' }]);

    expect(
      verifyProductionManifest(built, stored, { ...base, instancesDigest: '9'.repeat(64) }),
    ).toMatchObject([{ code: 'INSTANCES_DIGEST_MISMATCH' }]);

    expect(
      verifyProductionManifest(built, stored, {
        ...base,
        recomputedInstancesDigest: '8'.repeat(64),
      }),
    ).toMatchObject([{ code: 'INSTANCES_DIGEST_MISMATCH' }]);

    expect(
      verifyProductionManifest(built, stored, { ...base, serialReservation: null }),
    ).toMatchObject([{ code: 'SERIAL_RESERVATION_MISMATCH' }]);

    expect(
      verifyProductionManifest(built, stored, { ...base, productionJobHash: '7'.repeat(64) }),
    ).toMatchObject([{ code: 'JOB_HASH_MISMATCH' }]);
  });
});
