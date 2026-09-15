import type {
  DocumentSummaryDto,
  TemplateDto,
  TemplateVersionDetailDto,
  TemplateVersionSummaryDto,
} from '@smarttag/shared-types';
import type { Prisma } from '@smarttag/database';

const userRef = { select: { id: true, displayName: true } } as const;

export const templateSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  documentType: true,
  status: true,
  latestVersionNumber: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, code: true, name: true } },
  brand: { select: { id: true, code: true, name: true } },
  createdBy: userRef,
  currentVersion: {
    select: { id: true, versionNumber: true, status: true, documentHash: true, summaryJson: true },
  },
} as const satisfies Prisma.TemplateSelect;

export const versionSummarySelect = {
  id: true,
  templateId: true,
  versionNumber: true,
  status: true,
  schemaVersion: true,
  documentHash: true,
  revision: true,
  changeSummary: true,
  basedOnVersionId: true,
  summaryJson: true,
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
  approvedAt: true,
  retiredAt: true,
  createdBy: userRef,
  approvedBy: userRef,
} as const satisfies Prisma.TemplateVersionSelect;

export const versionDetailSelect = {
  ...versionSummarySelect,
  documentJson: true,
} as const satisfies Prisma.TemplateVersionSelect;

type TemplateRow = Prisma.TemplateGetPayload<{ select: typeof templateSelect }>;
type VersionSummaryRow = Prisma.TemplateVersionGetPayload<{ select: typeof versionSummarySelect }>;
type VersionDetailRow = Prisma.TemplateVersionGetPayload<{ select: typeof versionDetailSelect }>;

/** summary_json is written exclusively by prepareDocumentForStorage(). */
function asSummary(value: Prisma.JsonValue): DocumentSummaryDto {
  return value as unknown as DocumentSummaryDto;
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

export function toTemplateDto(row: TemplateRow): TemplateDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    documentType: row.documentType,
    status: row.status,
    customer: row.customer,
    brand: row.brand,
    latestVersionNumber: row.latestVersionNumber,
    currentVersion: row.currentVersion
      ? {
          id: row.currentVersion.id,
          versionNumber: row.currentVersion.versionNumber,
          status: row.currentVersion.status,
          documentHash: row.currentVersion.documentHash,
          summary: asSummary(row.currentVersion.summaryJson),
        }
      : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toVersionSummaryDto(row: VersionSummaryRow): TemplateVersionSummaryDto {
  return {
    id: row.id,
    templateId: row.templateId,
    versionNumber: row.versionNumber,
    status: row.status,
    schemaVersion: row.schemaVersion,
    documentHash: row.documentHash,
    revision: row.revision,
    changeSummary: row.changeSummary,
    basedOnVersionId: row.basedOnVersionId,
    summary: asSummary(row.summaryJson),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    submittedAt: iso(row.submittedAt),
    approvedBy: row.approvedBy,
    approvedAt: iso(row.approvedAt),
    retiredAt: iso(row.retiredAt),
  };
}

export function toVersionDetailDto(row: VersionDetailRow): TemplateVersionDetailDto {
  return { ...toVersionSummaryDto(row), document: row.documentJson };
}
