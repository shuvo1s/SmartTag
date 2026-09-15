import type { DataIssueLayer } from '@smarttag/data-core';
import {
  DATA_IMPORT_STATUSES,
  MappingDefinitionSchema,
  ROW_STATUSES,
  SourceSettingsSchema,
  type DataImportStatus,
  type MappingDefinition,
  type MappingIssue,
  type MappingSuggestion,
  type AmbiguousSuggestion,
  type ProfileCompatibility,
  type ProfileNote,
  type RowIssue,
  type RowStatus,
  type SourceColumn,
  type SourceFormat,
  type SourceInspection,
  type SourceSettings,
  type SourceSettingsProblem,
} from '@smarttag/import-core';
import { z } from 'zod';
import { PaginationQuerySchema } from './pagination';
import type { TemplateVersionStatus } from './template-version-lifecycle';
import type { UserRefDto } from './templates';

const ExpectedRevisionSchema = z.number().int().min(1);

/** Multipart upload: POST /template-versions/:versionId/imports (file field "file"). */
export const IMPORT_UPLOAD_FILE_FIELD = 'file';

export const CreateDataImportFieldsSchema = z.object({
  /** Import into an existing dataset (a new version of it) instead of choosing when finalizing. */
  targetDatasetId: z.uuid().optional(),
});
export type CreateDataImportFields = z.infer<typeof CreateDataImportFieldsSchema>;

export const UpdateImportSourceSettingsRequestSchema = z.object({
  expectedRevision: ExpectedRevisionSchema,
  settings: SourceSettingsSchema,
});
export type UpdateImportSourceSettingsRequest = z.infer<
  typeof UpdateImportSourceSettingsRequestSchema
>;

export const UpdateImportMappingRequestSchema = z.object({
  expectedRevision: ExpectedRevisionSchema,
  mapping: MappingDefinitionSchema,
  /** The profile this mapping was applied from (traceability); must belong to the organization. */
  profile: z.object({ id: z.uuid(), revision: z.number().int().min(1) }).nullable(),
});
export type UpdateImportMappingRequest = z.infer<typeof UpdateImportMappingRequestSchema>;

export const ImportRevisionRequestSchema = z.object({ expectedRevision: ExpectedRevisionSchema });
export type ImportRevisionRequest = z.infer<typeof ImportRevisionRequestSchema>;

export const FinalizeImportRequestSchema = z.object({
  expectedRevision: ExpectedRevisionSchema,
  /** Required when the validation found warnings: the user has seen them. */
  acknowledgeWarnings: z.boolean(),
  dataset: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('NEW'),
      name: z.string().trim().min(1, { error: 'Enter a dataset name' }).max(200),
      description: z.string().trim().max(2000).default(''),
      customerId: z.uuid().nullable().default(null),
    }),
    z.object({ mode: z.literal('EXISTING'), datasetId: z.uuid() }),
  ]),
});
export type FinalizeImportRequest = z.input<typeof FinalizeImportRequestSchema>;
export type FinalizeImportCommand = z.output<typeof FinalizeImportRequestSchema>;

export const ListDataImportsQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(DATA_IMPORT_STATUSES).optional(),
  templateVersionId: z.uuid().optional(),
});
export type ListDataImportsQuery = z.infer<typeof ListDataImportsQuerySchema>;

export const ListDatasetRecordsQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(ROW_STATUSES).optional(),
  /** Only records that repeat an earlier record. */
  duplicates: z.enum(['true', 'false']).optional(),
  /** Case-insensitive text contained in the record's values, or an exact row number. */
  search: z.string().trim().max(100).optional(),
});
export type ListDatasetRecordsQuery = z.infer<typeof ListDatasetRecordsQuerySchema>;

export interface TemplateVersionRefDto {
  readonly id: string;
  readonly templateId: string;
  readonly templateCode: string;
  readonly templateName: string;
  readonly versionNumber: number;
  readonly status: TemplateVersionStatus;
}

export interface DataSourceFileDto {
  readonly id: string;
  readonly filename: string;
  readonly format: SourceFormat;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  /** STORED while the original file is kept; DELETED after an abandoned import was cleaned up. */
  readonly status: 'PENDING' | 'STORED' | 'DELETED';
  readonly uploadedAt: string;
  readonly uploadedBy: UserRefDto;
}

export interface ImportLimitsDto {
  readonly maxFileBytes: number;
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxSheets: number;
  readonly maxCellChars: number;
  readonly previewRows: number;
}

export interface ProfileEvaluationDto {
  readonly profileId: string;
  readonly name: string;
  readonly revision: number;
  readonly compatibility: ProfileCompatibility;
  readonly schemaMatches: boolean;
  readonly layoutMatches: boolean;
  readonly resolvedEntries: number;
  readonly totalEntries: number;
  readonly notes: readonly ProfileNote[];
  /** The profile resolved against this import's columns: what "Apply" puts into the mapping. */
  readonly mapping: MappingDefinition;
}

export interface MappingValidationDto {
  readonly complete: boolean;
  readonly issues: readonly MappingIssue[];
  readonly mappedFields: readonly string[];
  readonly ignoredColumns: readonly number[];
  readonly unmappedRequiredFields: readonly string[];
  readonly unmappedOptionalFields: readonly string[];
}

export interface IssueCountDto {
  readonly layer: DataIssueLayer | 'IMPORT';
  readonly code: string;
  readonly severity: 'ERROR' | 'WARNING';
  /** Rows with at least one such issue. */
  readonly rows: number;
}

export interface FieldIssueCountDto {
  readonly field: string;
  readonly errorRows: number;
  readonly warningRows: number;
}

/** Aggregates of one validation run, stored with the (draft or finalized) dataset version. */
export interface ImportValidationSummary {
  readonly issueCounts: readonly IssueCountDto[];
  readonly fieldCounts: readonly FieldIssueCountDto[];
  readonly mappedFields: readonly string[];
  readonly ignoredColumns: readonly {
    readonly index: number;
    readonly letter: string;
    readonly header: string;
  }[];
  readonly unmappedRequiredFields: readonly string[];
  readonly unmappedOptionalFields: readonly string[];
  /**
   * Always false for imports: server validation covers data, bindings, barcodes/QR codes and assets.
   * Text overflow needs real font shaping and is checked in the browser for previewed rows only.
   */
  readonly layoutChecked: false;
}

export interface ImportValidationDto {
  readonly run: number;
  /** The draft dataset version holding this run's records. */
  readonly datasetVersionId: string;
  readonly rowCount: number;
  readonly validCount: number;
  readonly warningCount: number;
  readonly errorCount: number;
  readonly blankRowCount: number;
  readonly duplicateRowCount: number;
  readonly summary: ImportValidationSummary;
  readonly completedAt: string;
}

export interface ImportFailureDto {
  readonly code: string;
  readonly message: string;
  readonly stage: 'INSPECTION' | 'VALIDATION';
  /** Retrying may help (a temporary problem); otherwise upload a corrected file. */
  readonly retryable: boolean;
}

export interface ImportProgressDto {
  readonly stage: 'INSPECTION' | 'VALIDATION' | null;
  readonly processedRows: number;
  readonly totalRows: number | null;
  readonly updatedAt: string | null;
}

export interface DatasetVersionRefDto {
  readonly id: string;
  readonly datasetId: string;
  readonly datasetName: string;
  readonly versionNumber: number;
}

export interface DataImportSummaryDto {
  readonly id: string;
  readonly status: DataImportStatus;
  readonly templateVersion: TemplateVersionRefDto;
  readonly source: Pick<DataSourceFileDto, 'filename' | 'format' | 'sizeBytes'>;
  readonly rowCount: number | null;
  readonly validCount: number | null;
  readonly warningCount: number | null;
  readonly errorCount: number | null;
  readonly datasetVersion: DatasetVersionRefDto | null;
  readonly createdBy: UserRefDto;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DataImportDto {
  readonly id: string;
  readonly status: DataImportStatus;
  readonly revision: number;
  readonly templateVersion: TemplateVersionRefDto & {
    /** Document hash recorded when the import was created. */
    readonly documentHash: string;
    readonly dataSchemaHash: string;
    /** The draft template version was edited after the import started (the import cannot continue). */
    readonly changedSinceImport: boolean;
  };
  readonly targetDataset: { readonly id: string; readonly name: string } | null;
  readonly source: DataSourceFileDto;
  readonly sourceSettings: SourceSettings;
  readonly sourceProblems: readonly SourceSettingsProblem[];
  readonly inspection: SourceInspection | null;
  readonly columns: readonly SourceColumn[];
  /** Non-blank rows below the header row of the selected sheet, when known. */
  readonly dataRowCount: number | null;
  readonly mapping: MappingDefinition | null;
  readonly mappingValidation: MappingValidationDto | null;
  readonly suggestions: {
    readonly suggestions: readonly MappingSuggestion[];
    readonly ambiguous: readonly AmbiguousSuggestion[];
  };
  readonly mappingProfile: {
    readonly id: string;
    readonly name: string;
    readonly revision: number;
  } | null;
  readonly profileEvaluations: readonly ProfileEvaluationDto[];
  readonly progress: ImportProgressDto;
  readonly validation: ImportValidationDto | null;
  readonly failure: ImportFailureDto | null;
  readonly finalizedVersion: DatasetVersionRefDto | null;
  readonly limits: ImportLimitsDto;
  readonly createdBy: UserRefDto;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DatasetRecordDto {
  readonly sequence: number;
  readonly rowNumber: number;
  readonly status: RowStatus;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly record: Readonly<Record<string, string | number | boolean | null>>;
  readonly recordHash: string;
  readonly resolvedInputHash: string | null;
  readonly duplicateOf: { readonly sequence: number; readonly rowNumber: number } | null;
  readonly issues: readonly RowIssue[];
}

export interface DatasetRecordPageDto {
  readonly items: readonly DatasetRecordDto[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly counts: {
    readonly all: number;
    readonly valid: number;
    readonly warning: number;
    readonly error: number;
    readonly duplicates: number;
  };
}

export interface DatasetRecordDetailDto {
  readonly record: DatasetRecordDto;
  /** Neighbours in sequence order within the same filter, for previous/next navigation. */
  readonly previousSequence: number | null;
  readonly nextSequence: number | null;
}
