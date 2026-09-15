import type { DataSchema } from '@smarttag/document-schema';
import type { DataIssue } from './issues';
import type { AssetAvailability } from './resolved-checks';
import type { DataRecordValidation } from './validate-record';

/**
 * Image asset ids a record supplies itself (defaults are part of the validated template). Used by
 * servers to look availability up in one tenant-scoped query before calling
 * `checkRecordAssetReferences`.
 */
export function recordImageAssetIds(
  schema: DataSchema,
  validation: DataRecordValidation,
): string[] {
  const ids = new Set<string>();
  for (const field of schema.fields) {
    if (field.type !== 'image') continue;
    const value = validation.normalizedRecord[field.key];
    const status = validation.fields.find((candidate) => candidate.key === field.key);
    if (typeof value === 'string' && status?.source === 'RECORD') ids.add(value);
  }
  return [...ids];
}

/**
 * DATA layer, server side: image values supplied by the record must be placeable image assets of
 * the organization. Availability comes from a tenant-scoped lookup, so an asset id of another
 * organization is indistinguishable from an id that does not exist (UNKNOWN_ASSET_REFERENCE).
 *
 * Shared by the record validation API and imports; the designer reports the same situation on
 * the artwork (IMAGE_ASSET_UNAVAILABLE) from its tenant-scoped asset requests.
 */
export function checkRecordAssetReferences(
  schema: DataSchema,
  validation: DataRecordValidation,
  availability: (assetId: string) => AssetAvailability,
): DataIssue[] {
  const issues: DataIssue[] = [];
  for (const field of schema.fields) {
    if (field.type !== 'image') continue;
    const value = validation.normalizedRecord[field.key];
    const status = validation.fields.find((candidate) => candidate.key === field.key);
    if (typeof value === 'string' && status?.source === 'RECORD') {
      if (availability(value) !== 'AVAILABLE') {
        issues.push({
          layer: 'DATA',
          code: 'UNKNOWN_ASSET_REFERENCE',
          severity: 'ERROR',
          field: field.key,
          target: null,
          message: `${field.displayName}: asset ${value} is not a placeable image of this organization`,
        });
      }
    }
  }
  return issues;
}
