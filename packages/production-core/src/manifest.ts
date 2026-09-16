import { SHA256_HEX_PATTERN, canonicalizeJson } from '@smarttag/document-utils';
import { canonicalConfiguration, type ProductionConfiguration } from './configuration';
import {
  PRODUCTION_INSTANCE_CONTRACT,
  PRODUCTION_MANIFEST_SCHEME,
  productionJobHashPayload,
  type SerialReservationIdentity,
} from './hashing';

/**
 * The production manifest: the machine-readable record of exactly what a released job contains.
 * It is the hand-over document to the rendering phase, and it is what an auditor reads to check
 * that a printed batch matches the data and artwork it claims to come from.
 *
 * Written as canonical JSON (RFC 8785) so its bytes — and therefore its SHA-256 — depend only on
 * its content.
 */
export interface ProductionManifest {
  readonly scheme: typeof PRODUCTION_MANIFEST_SCHEME;
  readonly contractVersion: string;
  readonly job: {
    readonly id: string;
    readonly jobNumber: string;
    readonly name: string;
    readonly productionMode: string;
    readonly organizationId: string;
    readonly customer: { readonly id: string; readonly name: string } | null;
    readonly brand: { readonly id: string; readonly name: string } | null;
  };
  readonly template: {
    readonly templateId: string;
    readonly templateCode: string;
    readonly versionId: string;
    readonly versionNumber: number;
    readonly documentHash: string;
    readonly schemaVersion: number;
    readonly status: string;
  };
  readonly dataset: {
    readonly datasetId: string;
    readonly datasetName: string;
    readonly versionId: string;
    readonly versionNumber: number;
    readonly datasetHash: string;
    readonly recordCount: number;
  };
  readonly dataSchemaHash: string;
  readonly configuration: ProductionConfiguration;
  readonly recordSelectionHash: string | null;
  readonly serialReservation:
    | (SerialReservationIdentity & {
        readonly sequenceName: string;
        readonly firstSerial: string;
        readonly lastSerial: string;
      })
    | null;
  readonly instances: {
    readonly count: number;
    readonly validCount: number;
    readonly warningCount: number;
    readonly errorCount: number;
    readonly digest: string;
    readonly ordering: string;
  };
  readonly productionJobHash: string;
  readonly versions: Readonly<Record<string, string>>;
  /** What was and was not checked before release (never overstated). */
  readonly validation: {
    readonly contentValidated: true;
    readonly layoutFullyChecked: false;
    readonly note: string;
  };
  readonly releasedAt: string;
  readonly releasedBy: { readonly id: string; readonly displayName: string };
  readonly createdAt: string;
}

export const INSTANCE_ORDERING =
  'dataset record sequence, then copy index; instance sequence starts at 1' as const;

export const LAYOUT_NOTE =
  'Data, bindings, expressions, barcodes, QR codes and image assets were validated for every instance. Text layout (overflow, missing glyphs) was not: the server has no text shaper yet, so layout is only checked in the browser for previewed instances.' as const;

export interface ManifestInput {
  readonly job: ProductionManifest['job'];
  readonly template: ProductionManifest['template'];
  readonly dataset: ProductionManifest['dataset'];
  readonly dataSchemaHash: string;
  readonly configuration: ProductionConfiguration;
  readonly recordSelectionHash: string | null;
  readonly serialReservation: ProductionManifest['serialReservation'];
  readonly instances: Omit<ProductionManifest['instances'], 'ordering'>;
  readonly productionJobHash: string;
  readonly versions: Readonly<Record<string, string>>;
  readonly releasedAt: string;
  readonly releasedBy: ProductionManifest['releasedBy'];
  readonly createdAt: string;
}

export function buildProductionManifest(input: ManifestInput): ProductionManifest {
  return {
    scheme: PRODUCTION_MANIFEST_SCHEME,
    contractVersion: PRODUCTION_INSTANCE_CONTRACT,
    job: input.job,
    template: input.template,
    dataset: input.dataset,
    dataSchemaHash: input.dataSchemaHash,
    configuration: canonicalConfiguration(input.configuration),
    recordSelectionHash: input.recordSelectionHash,
    serialReservation: input.serialReservation,
    instances: { ...input.instances, ordering: INSTANCE_ORDERING },
    productionJobHash: input.productionJobHash,
    versions: input.versions,
    validation: { contentValidated: true, layoutFullyChecked: false, note: LAYOUT_NOTE },
    releasedAt: input.releasedAt,
    releasedBy: input.releasedBy,
    createdAt: input.createdAt,
  };
}

/** The exact bytes stored in object storage (canonical JSON, one trailing newline). */
export function serializeManifest(manifest: ProductionManifest): string {
  return `${canonicalizeJson(manifest)}\n`;
}

export interface ManifestVerificationIssue {
  readonly code:
    | 'MANIFEST_CHECKSUM_MISMATCH'
    | 'MANIFEST_NOT_CANONICAL'
    | 'JOB_HASH_MISMATCH'
    | 'INSTANCE_COUNT_MISMATCH'
    | 'INSTANCES_DIGEST_MISMATCH'
    | 'SERIAL_RESERVATION_MISMATCH'
    | 'CONTRACT_VERSION_MISMATCH';
  readonly message: string;
}

export interface ManifestExpectation {
  /** SHA-256 recorded for the stored manifest file. */
  readonly checksumSha256: string;
  /** SHA-256 actually computed over the stored bytes. */
  readonly actualChecksumSha256: string;
  readonly productionJobHash: string;
  readonly instanceCount: number;
  readonly instancesDigest: string;
  readonly serialReservation: SerialReservationIdentity | null;
  /** SHA-256 recomputed over the stored instance hashes, when the caller recomputed it. */
  readonly recomputedInstancesDigest?: string;
}

/**
 * Checks a stored manifest against the job it describes: the file is unchanged, it is canonical,
 * the job hash it carries is the hash of the inputs it lists, and the instances and serial range
 * still match. Returns every problem found, so a report can show all of them at once.
 */
export function verifyProductionManifest(
  manifest: ProductionManifest,
  stored: string,
  expected: ManifestExpectation,
): readonly ManifestVerificationIssue[] {
  const issues: ManifestVerificationIssue[] = [];
  const push = (code: ManifestVerificationIssue['code'], message: string) =>
    issues.push({ code, message });

  if (
    !SHA256_HEX_PATTERN.test(expected.actualChecksumSha256) ||
    expected.actualChecksumSha256 !== expected.checksumSha256
  ) {
    push(
      'MANIFEST_CHECKSUM_MISMATCH',
      `The stored manifest file does not match its recorded checksum (${expected.checksumSha256}).`,
    );
  }
  if (serializeManifest(manifest) !== stored) {
    push('MANIFEST_NOT_CANONICAL', 'The stored manifest is not the canonical form of its content.');
  }
  if (manifest.contractVersion !== PRODUCTION_INSTANCE_CONTRACT) {
    push(
      'CONTRACT_VERSION_MISMATCH',
      `The manifest was written for contract ${manifest.contractVersion}, not ${PRODUCTION_INSTANCE_CONTRACT}.`,
    );
  }
  if (manifest.productionJobHash !== expected.productionJobHash) {
    push('JOB_HASH_MISMATCH', 'The job hash in the manifest differs from the job hash recorded.');
  }
  if (manifest.instances.count !== expected.instanceCount) {
    push(
      'INSTANCE_COUNT_MISMATCH',
      `The manifest lists ${manifest.instances.count} instances; the job has ${expected.instanceCount}.`,
    );
  }
  if (manifest.instances.digest !== expected.instancesDigest) {
    push('INSTANCES_DIGEST_MISMATCH', 'The instances digest in the manifest differs from the job.');
  }
  if (
    expected.recomputedInstancesDigest !== undefined &&
    expected.recomputedInstancesDigest !== manifest.instances.digest
  ) {
    push(
      'INSTANCES_DIGEST_MISMATCH',
      'Recomputing the digest from the stored instances gave a different result.',
    );
  }
  const reserved = manifest.serialReservation;
  const expectedReservation = expected.serialReservation;
  const sameReservation =
    (reserved === null && expectedReservation === null) ||
    (reserved !== null &&
      expectedReservation !== null &&
      reserved.sequenceCode === expectedReservation.sequenceCode &&
      reserved.startValue === expectedReservation.startValue &&
      reserved.endValue === expectedReservation.endValue);
  if (!sameReservation) {
    push(
      'SERIAL_RESERVATION_MISMATCH',
      'The serial reservation in the manifest differs from the reservation recorded for the job.',
    );
  }
  return issues;
}

/** The payload whose SHA-256 must equal the manifest's `productionJobHash`. */
export function manifestJobHashPayload(manifest: ProductionManifest): string {
  return productionJobHashPayload({
    templateVersionHash: manifest.template.documentHash,
    datasetHash: manifest.dataset.datasetHash,
    dataSchemaHash: manifest.dataSchemaHash,
    configuration: manifest.configuration,
    serialReservation: manifest.serialReservation
      ? {
          sequenceCode: manifest.serialReservation.sequenceCode,
          startValue: manifest.serialReservation.startValue,
          endValue: manifest.serialReservation.endValue,
        }
      : null,
    instanceCount: manifest.instances.count,
    instancesDigest: manifest.instances.digest,
    contractVersion: manifest.contractVersion,
  });
}
