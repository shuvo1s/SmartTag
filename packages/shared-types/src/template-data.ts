import type {
  DataIssue,
  DataValidationSummary,
  FieldValueSource,
  NormalizedValue,
} from '@smarttag/data-core';
import { z } from 'zod';

/**
 * POST /template-versions/:versionId/data/validate
 *
 * `record` is untrusted input and deliberately typed `unknown` here: the shared data-core
 * validator reads it with own-property checks only (no merging into objects, no prototype
 * pollution), and the API enforces the serialized size limit before validating.
 */
export const ValidateTemplateDataRequestSchema = z.object({
  record: z.unknown().refine((value) => value !== undefined, { error: 'record is required' }),
});
export type ValidateTemplateDataRequest = z.infer<typeof ValidateTemplateDataRequestSchema>;

export interface TemplateDataFieldStatusDto {
  readonly key: string;
  readonly state: 'VALID' | 'WARNING' | 'ERROR';
  readonly source: FieldValueSource;
}

export interface TemplateDataValidationDto {
  readonly templateVersionId: string;
  /** The version's document hash; validation never changes it. */
  readonly documentHash: string;
  /** Schema version the document was validated with (after in-memory migration). */
  readonly schemaVersion: number;
  /** The record satisfies the data schema (no DATA-layer errors). */
  readonly valid: boolean;
  /** No errors in any layer: data, binding resolution or resolved artwork objects. */
  readonly productionValid: boolean;
  /** DATA, BINDING and OBJECT issues (layout checks need production font metrics). */
  readonly issues: readonly DataIssue[];
  readonly summary: Omit<DataValidationSummary, 'fields'>;
  readonly fields: readonly TemplateDataFieldStatusDto[];
  /** Typed, normalized record with defaults applied; keys sorted. */
  readonly normalizedRecord: Readonly<Record<string, NormalizedValue>>;
  /** SHA-256 identity of (document hash + normalized record) when the record is valid. */
  readonly resolvedInputHash: string | null;
}
