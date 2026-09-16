import type { InstanceIssue, InstanceStatus, ProductionJobStatus } from '@smarttag/production-core';
import {
  PRODUCTION_MODES,
  type ProductionConfigurationSchema,
  QuantityConfigurationSchema,
  RecordSelectionSchema,
  SerialConfigurationSchema,
} from '@smarttag/production-core';
import { z } from 'zod';
import type { TemplateVersionRefDto } from './data-imports';
import { PaginationQuerySchema } from './pagination';
import type { SequenceReservationDto, SerialPreviewDto } from './sequences';
import type { CustomerRefDto, UserRefDto } from './templates';

export const CreateProductionJobRequestSchema = z.object({
  name: z.string().trim().min(1, { error: 'Enter a job name' }).max(200),
  description: z.string().trim().max(2000).default(''),
  /** Exactly one approved template version and one finalized dataset version. */
  templateVersionId: z.uuid(),
  datasetVersionId: z.uuid(),
  customerId: z.uuid().nullable().default(null),
  brandId: z.uuid().nullable().default(null),
  productionMode: z.enum(PRODUCTION_MODES).default('PRODUCTION'),
});
export type CreateProductionJobRequest = z.input<typeof CreateProductionJobRequestSchema>;
export type CreateProductionJobCommand = z.output<typeof CreateProductionJobRequestSchema>;

/** Configuration changes; only a DRAFT (or a job sent back to DRAFT) accepts them. */
export const ConfigureProductionJobRequestSchema = z.object({
  expectedRevision: z.number().int().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  customerId: z.uuid().nullable().optional(),
  brandId: z.uuid().nullable().optional(),
  quantity: QuantityConfigurationSchema.optional(),
  serial: SerialConfigurationSchema.optional(),
  recordSelection: RecordSelectionSchema.optional(),
  warningPolicy: z.enum(['ACKNOWLEDGE', 'ALLOW']).optional(),
});
export type ConfigureProductionJobRequest = z.infer<typeof ConfigureProductionJobRequestSchema>;

export const ProductionJobRevisionRequestSchema = z.object({
  expectedRevision: z.number().int().min(1),
});
export type ProductionJobRevisionRequest = z.infer<typeof ProductionJobRevisionRequestSchema>;

export const ReleaseProductionJobRequestSchema = z.object({
  expectedRevision: z.number().int().min(1),
  /** Required when the job has warnings and the policy asks for an acknowledgement. */
  acknowledgeWarnings: z.boolean().default(false),
});
export type ReleaseProductionJobRequest = z.input<typeof ReleaseProductionJobRequestSchema>;
export type ReleaseProductionJobCommand = z.output<typeof ReleaseProductionJobRequestSchema>;

export const ListProductionJobsQuerySchema = PaginationQuerySchema.extend({
  status: z.string().trim().max(400).optional(),
  customerId: z.uuid().optional(),
  templateId: z.uuid().optional(),
  search: z.string().trim().max(200).optional(),
  createdFrom: z.iso.date().optional(),
  createdTo: z.iso.date().optional(),
});
export type ListProductionJobsQuery = z.infer<typeof ListProductionJobsQuerySchema>;

export const ListProductionInstancesQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['VALID', 'WARNING', 'ERROR']).optional(),
  search: z.string().trim().max(200).optional(),
  /** Keyset pagination: instances after this sequence, in job order. */
  afterSequence: z.coerce.number().int().min(0).optional(),
});
export type ListProductionInstancesQuery = z.infer<typeof ListProductionInstancesQuerySchema>;

export interface ProductionJobProgressDto {
  readonly phase: string | null;
  readonly processed: number;
  readonly total: number | null;
  readonly updatedAt: string | null;
}

export interface ProductionJobCountsDto {
  readonly recordCount: number;
  readonly instanceCount: number;
  readonly validCount: number;
  readonly warningCount: number;
  readonly errorCount: number;
  /** Instances whose dataset record already carried warnings when it was imported. */
  readonly sourceWarningCount: number;
}

export interface ProductionJobSummaryDto {
  readonly id: string;
  readonly jobNumber: string;
  readonly name: string;
  readonly status: ProductionJobStatus;
  readonly productionMode: 'PRODUCTION' | 'NON_PRODUCTION';
  readonly customer: CustomerRefDto | null;
  readonly templateVersion: TemplateVersionRefDto;
  readonly dataset: { readonly id: string; readonly name: string; readonly versionNumber: number };
  readonly counts: ProductionJobCountsDto;
  readonly createdAt: string;
  readonly createdBy: UserRefDto;
  readonly releasedAt: string | null;
  readonly releasedBy: UserRefDto | null;
}

export interface ProductionManifestRefDto {
  readonly checksumSha256: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly downloadPath: string;
}

export interface ProductionJobEventDto {
  readonly id: string;
  readonly type: string;
  readonly message: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly createdBy: UserRefDto | null;
}

export interface ProductionIssueCountDto {
  readonly layer: string;
  readonly code: string;
  readonly severity: 'ERROR' | 'WARNING';
  readonly instances: number;
}

export interface ProductionValidationSummaryDto {
  readonly issueCounts: readonly ProductionIssueCountDto[];
  /** Always false in this phase: the server has no text shaper (docs/production-jobs.md). */
  readonly layoutChecked: false;
  readonly layoutNote: string;
}

export interface ProductionJobDto extends ProductionJobSummaryDto {
  readonly description: string;
  readonly brand: { readonly id: string; readonly name: string } | null;
  readonly revision: number;
  readonly template: { readonly id: string; readonly code: string; readonly name: string };
  readonly templateVersionHash: string;
  readonly templateSchemaVersion: number;
  readonly dataSchemaHash: string;
  readonly datasetVersion: {
    readonly id: string;
    readonly versionNumber: number;
    readonly datasetHash: string;
    readonly rowCount: number;
    readonly warningCount: number;
  };
  readonly configuration: z.infer<typeof ProductionConfigurationSchema>;
  readonly recordSelectionHash: string | null;
  readonly quantityFields: readonly { readonly key: string; readonly displayName: string }[];
  readonly systemFields: readonly string[];
  readonly serialPreview: SerialPreviewDto | null;
  readonly reservation: SequenceReservationDto | null;
  readonly instancesDigest: string | null;
  readonly productionJobHash: string | null;
  readonly versions: Readonly<Record<string, string>>;
  readonly validation: ProductionValidationSummaryDto | null;
  readonly progress: ProductionJobProgressDto;
  readonly failure: { readonly code: string; readonly message: string } | null;
  readonly manifest: ProductionManifestRefDto | null;
  readonly warningsAcknowledgedAt: string | null;
  readonly warningsAcknowledgedBy: UserRefDto | null;
  readonly expandedAt: string | null;
  readonly readyForRenderingAt: string | null;
  readonly cancelledAt: string | null;
  readonly updatedAt: string;
  readonly events: readonly ProductionJobEventDto[];
  /** What this actor may do with the job right now (permissions and lifecycle combined). */
  readonly actions: {
    readonly configure: boolean;
    readonly validate: boolean;
    readonly release: boolean;
    readonly cancel: boolean;
  };
}

export interface ProductionInstanceDto {
  readonly sequence: number;
  readonly datasetRecordSequence: number;
  readonly sourceRowNumber: number;
  readonly copyIndex: number;
  readonly copies: number;
  readonly serial: string | null;
  readonly status: InstanceStatus;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly sourceWarningCount: number;
  readonly resolvedInputHash: string | null;
  readonly instanceHash: string | null;
}

export interface ProductionInstanceDetailDto extends ProductionInstanceDto {
  readonly issues: readonly InstanceIssue[];
  /** The dataset record this tag prints, with the issues it already carried. */
  readonly record: Readonly<Record<string, unknown>>;
  readonly recordIssues: readonly InstanceIssue[];
  readonly recordHash: string;
  /** The production context, exactly as it goes into the instance hash. */
  readonly context: {
    readonly serial: string | null;
    readonly instanceIndex: number;
    readonly copyIndex: number;
    readonly sourceRow: number;
    readonly jobNumber: string;
  };
  readonly previousSequence: number | null;
  readonly nextSequence: number | null;
}

export interface ProductionInstancePageDto {
  readonly items: readonly ProductionInstanceDto[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  /** Sequence to continue from for the next page (keyset paging over large jobs). */
  readonly nextCursor: number | null;
}

/** A few instances worth looking at before releasing: first, last, one per record, warnings. */
export interface ProductionSampleDto {
  readonly label: string;
  readonly reason: string;
  readonly sequence: number;
}
