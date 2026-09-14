import {
  DocumentTypeSchema,
  MAX_LENGTH_PT,
  MeasurementUnitSchema,
  type DocumentType,
  type Insets,
  type MeasurementUnit,
  type PageSide,
} from '@smarttag/document-schema';
import { PAGE_LAYOUTS, toPoints } from '@smarttag/document-utils';
import { z } from 'zod';
import { PaginationQuerySchema } from './pagination';
import {
  TEMPLATE_VERSION_STATUSES,
  type TemplateVersionStatus,
} from './template-version-lifecycle';

export const TEMPLATE_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

/** Template codes are stable integration identifiers (ERP/PLM references); immutable after creation. */
export const TEMPLATE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;

/** Smallest printable piece we accept (5 mm) — anything smaller is almost certainly a unit mistake. */
export const MIN_DOCUMENT_EDGE_PT = toPoints(5, 'mm');
/** Largest bleed we accept (25.4 mm / 1 in). */
export const MAX_BLEED_PT = 72;

const requiredNumber = (label: string) =>
  z.number({
    error: (issue) =>
      issue.input === undefined || Number.isNaN(issue.input)
        ? `${label} is required`
        : `${label} must be a number`,
  });

export const TemplateDimensionsInputSchema = z
  .object({
    unit: MeasurementUnitSchema,
    width: requiredNumber('Width').positive({ error: 'Width must be greater than 0' }),
    height: requiredNumber('Height').positive({ error: 'Height must be greater than 0' }),
    bleed: requiredNumber('Bleed').min(0, { error: 'Bleed cannot be negative' }),
    safeMargin: requiredNumber('Safe margin').min(0, { error: 'Safe margin cannot be negative' }),
  })
  .superRefine((value, ctx) => {
    const pt = (n: number) => toPoints(n, value.unit);
    for (const edge of ['width', 'height'] as const) {
      if (pt(value[edge]) < MIN_DOCUMENT_EDGE_PT) {
        ctx.addIssue({
          code: 'custom',
          path: [edge],
          message: `${edge === 'width' ? 'Width' : 'Height'} must be at least 5 mm`,
        });
      } else if (pt(value[edge]) > MAX_LENGTH_PT) {
        ctx.addIssue({
          code: 'custom',
          path: [edge],
          message: `${edge === 'width' ? 'Width' : 'Height'} cannot exceed 200 in`,
        });
      }
    }
    if (pt(value.bleed) > MAX_BLEED_PT) {
      ctx.addIssue({
        code: 'custom',
        path: ['bleed'],
        message: 'Bleed cannot exceed 25.4 mm (1 in)',
      });
    }
    if (value.safeMargin * 2 >= Math.min(value.width, value.height)) {
      ctx.addIssue({
        code: 'custom',
        path: ['safeMargin'],
        message: 'Safe margin leaves no usable area',
      });
    }
  });
export type TemplateDimensionsInput = z.infer<typeof TemplateDimensionsInputSchema>;

export const CreateTemplateRequestSchema = z
  .object({
    name: z.string().trim().min(1, { error: 'Name is required' }).max(200),
    code: z.string().trim().toUpperCase().regex(TEMPLATE_CODE_PATTERN, {
      error: 'Use 2–64 letters, digits, "-" or "_" (e.g. HT-50X90-BASIC)',
    }),
    description: z.string().trim().max(2000).default(''),
    customerId: z.uuid().nullable().default(null),
    brandId: z.uuid().nullable().default(null),
    documentType: DocumentTypeSchema,
    dimensions: TemplateDimensionsInputSchema,
    pageLayout: z.enum(PAGE_LAYOUTS),
  })
  .superRefine((value, ctx) => {
    if (value.brandId !== null && value.customerId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['customerId'],
        message: 'Select the customer that owns the brand',
      });
    }
  });
export type CreateTemplateRequest = z.input<typeof CreateTemplateRequestSchema>;
export type CreateTemplateCommand = z.output<typeof CreateTemplateRequestSchema>;

export const UpdateTemplateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    customerId: z.uuid().nullable().optional(),
    brandId: z.uuid().nullable().optional(),
    status: z.enum(TEMPLATE_STATUSES).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    error: 'Provide at least one field to update',
  });
export type UpdateTemplateRequest = z.infer<typeof UpdateTemplateRequestSchema>;

export const ListTemplatesQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(TEMPLATE_STATUSES).optional(),
  documentType: DocumentTypeSchema.optional(),
  customerId: z.uuid().optional(),
});
export type ListTemplatesQuery = z.infer<typeof ListTemplatesQuerySchema>;

export const CreateTemplateVersionRequestSchema = z.object({
  /** New canonical document content. When omitted, content is copied from `basedOnVersionId` (or the current version). */
  document: z.unknown().optional(),
  basedOnVersionId: z.uuid().optional(),
  changeSummary: z.string().trim().max(1000).default(''),
});
export type CreateTemplateVersionRequest = z.input<typeof CreateTemplateVersionRequestSchema>;

export const UpdateTemplateVersionRequestSchema = z.object({
  document: z.unknown().refine((value) => value !== undefined, { error: 'document is required' }),
  changeSummary: z.string().trim().max(1000).optional(),
  /** Optimistic concurrency: the revision the client last saw. */
  expectedRevision: z.number().int().min(1),
});
export type UpdateTemplateVersionRequest = z.infer<typeof UpdateTemplateVersionRequestSchema>;

export const TransitionTemplateVersionRequestSchema = z.object({
  targetStatus: z.enum(TEMPLATE_VERSION_STATUSES),
  comment: z.string().trim().max(1000).optional(),
});
export type TransitionTemplateVersionRequest = z.infer<
  typeof TransitionTemplateVersionRequestSchema
>;

// ---------------------------------------------------------------------------------------------
// Response DTOs (dates are ISO-8601 strings)
// ---------------------------------------------------------------------------------------------

export interface UserRefDto {
  readonly id: string;
  readonly displayName: string;
}

export interface CustomerRefDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface BrandRefDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** Stored alongside each version so listings never need to parse full documents. */
export interface DocumentSummaryDto {
  readonly documentType: DocumentType;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly orientation: 'PORTRAIT' | 'LANDSCAPE';
  readonly displayUnit: MeasurementUnit;
  readonly bleedPt: Insets;
  readonly safeAreaPt: Insets;
  readonly pageCount: number;
  readonly pageSides: readonly PageSide[];
  readonly objectCount: number;
  readonly dataFieldCount: number;
  readonly boundFieldKeys: readonly string[];
  readonly assetIds: readonly string[];
}

export interface TemplateVersionSummaryDto {
  readonly id: string;
  readonly templateId: string;
  readonly versionNumber: number;
  readonly status: TemplateVersionStatus;
  readonly schemaVersion: number;
  readonly documentHash: string;
  readonly revision: number;
  readonly changeSummary: string;
  readonly basedOnVersionId: string | null;
  readonly summary: DocumentSummaryDto;
  readonly createdBy: UserRefDto;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly submittedAt: string | null;
  readonly approvedBy: UserRefDto | null;
  readonly approvedAt: string | null;
  readonly retiredAt: string | null;
}

export interface TemplateVersionDetailDto extends TemplateVersionSummaryDto {
  /**
   * The stored canonical document exactly as persisted. Typed `unknown` on purpose: consumers must
   * pass it through `parseDesignDocument()` before rendering.
   */
  readonly document: unknown;
}

export interface TemplateDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly documentType: DocumentType;
  readonly status: TemplateStatus;
  readonly customer: CustomerRefDto | null;
  readonly brand: BrandRefDto | null;
  readonly latestVersionNumber: number;
  readonly currentVersion: Pick<
    TemplateVersionSummaryDto,
    'id' | 'versionNumber' | 'status' | 'documentHash' | 'summary'
  > | null;
  readonly createdBy: UserRefDto;
  readonly createdAt: string;
  readonly updatedAt: string;
}
