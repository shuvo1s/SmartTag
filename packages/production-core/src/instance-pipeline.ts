import {
  checkResolvedObjects,
  resolveDocumentBindings,
  resolvedInputHashPayload,
  type AssetAvailability,
  type DataIssue,
  type NormalizedDataRecord,
} from '@smarttag/data-core';
import type { DesignDocument } from '@smarttag/document-schema';
import { dependsOnInstanceContext, systemValuesFor, type ProductionContext } from './context';
import { instanceHashPayload } from './hashing';
import { instanceStatusOf, type InstanceIssue, type InstanceStatus } from './issues';

/**
 * Resolving one production instance:
 *
 *   TemplateVersion + normalized DatasetRecord + ProductionContext
 *     → Phase 3 binding resolution (expressions, field values, system fields)
 *     → Phase 3 object checks (barcodes, QR codes, image assets)
 *     → instance status, issues and hashes
 *
 * This is the Phase 3 engine, not a second production engine: the same functions the designer
 * preview and the data import use. The only addition is the production context.
 */
export interface InstancePipelineOptions {
  readonly document: DesignDocument;
  readonly templateVersionHash: string;
  /** Default availability lookup; a batch can pass its own with each instance. */
  readonly assetAvailability?: (assetId: string) => AssetAvailability;
}

export interface InstanceInput {
  readonly record: NormalizedDataRecord;
  /** The dataset record's own hash, exactly as stored with the record. */
  readonly recordHash: string;
  readonly context: ProductionContext;
  /** Problems found before resolution, e.g. an unusable quantity value. */
  readonly issues?: readonly InstanceIssue[];
  /** Availability of image assets for this organization (looked up per batch). */
  readonly assetAvailability?: (assetId: string) => AssetAvailability;
}

export interface ResolvedInstance {
  readonly status: InstanceStatus;
  readonly issues: readonly InstanceIssue[];
  readonly errorCount: number;
  readonly warningCount: number;
  /** UTF-8 text whose SHA-256 is the resolved-input hash (artwork + data, no context). */
  readonly resolvedInputHashPayload: string;
  /** UTF-8 text whose SHA-256 is the instance hash (artwork + data + context). */
  readonly instanceHashPayload: string;
  /** Asset ids the instance references (for availability lookups). */
  readonly imageAssetIds: readonly string[];
  /** Properties whose value only production supplies (a serial number that is not allocated). */
  readonly pendingSystemFields: readonly string[];
}

export interface InstanceProcessor {
  /**
   * True when copies of one record differ from each other (serial numbers, position in the job).
   * When false, one resolution can be reused for every copy of a record.
   */
  readonly perInstance: boolean;
  /** Resolves and checks one instance. */
  resolve(input: InstanceInput): ResolvedInstance;
}

export function createInstanceProcessor(options: InstancePipelineOptions): InstanceProcessor {
  const { document, templateVersionHash } = options;
  const perInstance = dependsOnInstanceContext(document);

  return {
    perInstance,
    resolve({ record, recordHash, context, issues: given = [], assetAvailability }) {
      const resolution = resolveDocumentBindings(document, {
        normalizedRecord: record,
        systemValues: systemValuesFor(context),
      });
      const objectIssues: DataIssue[] = checkResolvedObjects(resolution, {
        assetAvailability: assetAvailability ?? options.assetAvailability,
      });
      const issues: InstanceIssue[] = [...given, ...resolution.issues, ...objectIssues];
      const errorCount = issues.filter((issue) => issue.severity === 'ERROR').length;
      const pending = new Set<string>();
      const imageAssetIds = new Set<string>();
      for (const property of resolution.properties) {
        for (const key of property.pendingSystemFields) pending.add(key);
        if (property.kind === 'IMAGE_ASSET' && typeof property.value === 'string') {
          imageAssetIds.add(property.value);
        }
      }
      return {
        status: instanceStatusOf(issues),
        issues,
        errorCount,
        warningCount: issues.length - errorCount,
        resolvedInputHashPayload: resolvedInputHashPayload(templateVersionHash, record),
        instanceHashPayload: instanceHashPayload({ templateVersionHash, recordHash, context }),
        imageAssetIds: [...imageAssetIds],
        pendingSystemFields: [...pending],
      };
    },
  };
}
