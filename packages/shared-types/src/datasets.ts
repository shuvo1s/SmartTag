import type { MappingDefinition, SourceColumn, SourceSettings } from '@smarttag/import-core';
import { z } from 'zod';
import type {
  DataSourceFileDto,
  ImportValidationSummary,
  TemplateVersionRefDto,
} from './data-imports';
import { PaginationQuerySchema } from './pagination';
import type { CustomerRefDto, UserRefDto } from './templates';

export const CreateDatasetRequestSchema = z.object({
  name: z.string().trim().min(1, { error: 'Enter a dataset name' }).max(200),
  description: z.string().trim().max(2000).default(''),
  customerId: z.uuid().nullable().default(null),
});
export type CreateDatasetRequest = z.input<typeof CreateDatasetRequestSchema>;
export type CreateDatasetCommand = z.output<typeof CreateDatasetRequestSchema>;

export const ListDatasetsQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
});
export type ListDatasetsQuery = z.infer<typeof ListDatasetsQuerySchema>;

export interface DatasetVersionSummaryDto {
  readonly id: string;
  readonly datasetId: string;
  readonly versionNumber: number;
  readonly templateVersion: TemplateVersionRefDto;
  readonly source: Pick<DataSourceFileDto, 'filename' | 'format'>;
  readonly rowCount: number;
  readonly validCount: number;
  readonly warningCount: number;
  readonly errorCount: number;
  readonly duplicateRowCount: number;
  readonly datasetHash: string;
  readonly finalizedAt: string;
  readonly finalizedBy: UserRefDto;
}

export interface DatasetSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly customer: CustomerRefDto | null;
  readonly versionCount: number;
  readonly latestVersion: DatasetVersionSummaryDto | null;
  readonly createdBy: UserRefDto;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DatasetDetailDto extends DatasetSummaryDto {
  readonly versions: readonly DatasetVersionSummaryDto[];
}

/** What the import configuration of a dataset version records (reproducibility). */
export interface DatasetImportConfiguration {
  readonly sourceSettings: SourceSettings;
  readonly columns: readonly SourceColumn[];
  readonly parser: {
    readonly id: string;
    readonly version: string;
    readonly libraries: Readonly<Record<string, string>>;
  };
  readonly normalizationVersion: string;
  readonly mappingDefinitionVersion: number;
  readonly limits: Readonly<Record<string, number>>;
}

export interface DatasetVersionDetailDto extends DatasetVersionSummaryDto {
  readonly status: 'FINALIZED';
  readonly dataset: { readonly id: string; readonly name: string };
  readonly importId: string;
  readonly templateVersion: TemplateVersionRefDto & { readonly documentHash: string };
  readonly dataSchemaHash: string;
  readonly sourceFile: DataSourceFileDto;
  readonly sourceChecksumSha256: string;
  readonly mappingSnapshot: MappingDefinition;
  readonly importConfiguration: DatasetImportConfiguration;
  readonly mappingProfile: {
    readonly id: string;
    readonly name: string;
    readonly revision: number;
  } | null;
  readonly blankRowCount: number;
  readonly recordsDigest: string;
  readonly validationSummary: ImportValidationSummary;
  readonly warningsAcknowledgedAt: string | null;
  readonly createdBy: UserRefDto;
  readonly createdAt: string;
  /** How each hash was produced (docs/datasets.md#hashes). */
  readonly hashMethods: Readonly<
    Record<
      'recordHash' | 'recordsDigest' | 'datasetHash' | 'resolvedInputHash' | 'dataSchemaHash',
      string
    >
  >;
}
