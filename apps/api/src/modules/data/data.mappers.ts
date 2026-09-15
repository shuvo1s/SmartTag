import type { Prisma } from '@smarttag/database';
import type { MappingDefinition, RowIssue } from '@smarttag/import-core';
import type {
  DataSourceFileDto,
  DatasetRecordDto,
  DatasetVersionSummaryDto,
  ImportLimitsDto,
  ImportValidationSummary,
  TemplateVersionRefDto,
} from '@smarttag/shared-types';
import type { AppConfig } from '../../config/env.schema';

export const userRef = { select: { id: true, displayName: true } } as const;

export const templateVersionRefSelect = {
  id: true,
  templateId: true,
  versionNumber: true,
  status: true,
  documentHash: true,
  template: { select: { code: true, name: true } },
} as const satisfies Prisma.TemplateVersionSelect;

type TemplateVersionRefRow = Prisma.TemplateVersionGetPayload<{
  select: typeof templateVersionRefSelect;
}>;

export function toTemplateVersionRef(row: TemplateVersionRefRow): TemplateVersionRefDto {
  return {
    id: row.id,
    templateId: row.templateId,
    templateCode: row.template.code,
    templateName: row.template.name,
    versionNumber: row.versionNumber,
    status: row.status,
  };
}

export const sourceFileSelect = {
  id: true,
  originalFilename: true,
  format: true,
  sizeBytes: true,
  checksumSha256: true,
  status: true,
  createdAt: true,
  createdBy: userRef,
} as const satisfies Prisma.DataSourceFileSelect;

type SourceFileRow = Prisma.DataSourceFileGetPayload<{ select: typeof sourceFileSelect }>;

export function toSourceFileDto(row: SourceFileRow): DataSourceFileDto {
  return {
    id: row.id,
    filename: row.originalFilename,
    format: row.format,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    status: row.status,
    uploadedAt: row.createdAt.toISOString(),
    uploadedBy: row.createdBy,
  };
}

export const datasetVersionSummarySelect = {
  id: true,
  datasetId: true,
  versionNumber: true,
  rowCount: true,
  validCount: true,
  warningCount: true,
  errorCount: true,
  duplicateRowCount: true,
  datasetHash: true,
  finalizedAt: true,
  finalizedBy: userRef,
  templateVersion: { select: templateVersionRefSelect },
  sourceFile: { select: { originalFilename: true, format: true } },
} as const satisfies Prisma.DatasetVersionSelect;

type DatasetVersionSummaryRow = Prisma.DatasetVersionGetPayload<{
  select: typeof datasetVersionSummarySelect;
}>;

/** Only finalized versions are summarized (their number, hash and finalization are set). */
export function toDatasetVersionSummary(row: DatasetVersionSummaryRow): DatasetVersionSummaryDto {
  return {
    id: row.id,
    datasetId: row.datasetId!,
    versionNumber: row.versionNumber!,
    templateVersion: toTemplateVersionRef(row.templateVersion),
    source: { filename: row.sourceFile.originalFilename, format: row.sourceFile.format },
    rowCount: row.rowCount,
    validCount: row.validCount,
    warningCount: row.warningCount,
    errorCount: row.errorCount,
    duplicateRowCount: row.duplicateRowCount,
    datasetHash: row.datasetHash!,
    finalizedAt: row.finalizedAt!.toISOString(),
    finalizedBy: row.finalizedBy!,
  };
}

export function importLimitsDto(config: AppConfig): ImportLimitsDto {
  const { limits } = config.imports;
  return {
    maxFileBytes: limits.maxFileBytes,
    maxRows: limits.maxRows,
    maxColumns: limits.maxColumns,
    maxSheets: limits.maxSheets,
    maxCellChars: limits.maxCellChars,
    previewRows: limits.previewRows,
  };
}

export const recordSelect = {
  sequence: true,
  rowNumber: true,
  status: true,
  errorCount: true,
  warningCount: true,
  normalizedRecord: true,
  recordHash: true,
  resolvedInputHash: true,
  duplicateOfSequence: true,
  issues: true,
} as const satisfies Prisma.DatasetRecordSelect;

export type RecordRow = Prisma.DatasetRecordGetPayload<{ select: typeof recordSelect }>;

export function toRecordDto(
  row: RecordRow,
  rowNumbers: ReadonlyMap<number, number>,
): DatasetRecordDto {
  return {
    sequence: row.sequence,
    rowNumber: row.rowNumber,
    status: row.status,
    errorCount: row.errorCount,
    warningCount: row.warningCount,
    record: row.normalizedRecord as DatasetRecordDto['record'],
    recordHash: row.recordHash,
    resolvedInputHash: row.resolvedInputHash,
    duplicateOf:
      row.duplicateOfSequence === null
        ? null
        : {
            sequence: row.duplicateOfSequence,
            rowNumber: rowNumbers.get(row.duplicateOfSequence) ?? 0,
          },
    issues: row.issues as unknown as RowIssue[],
  };
}

export const asMapping = (value: Prisma.JsonValue): MappingDefinition =>
  value as unknown as MappingDefinition;
export const asSummary = (value: Prisma.JsonValue): ImportValidationSummary =>
  value as unknown as ImportValidationSummary;

/** Content-Disposition safe filename (quotes, control characters and path parts removed). */
export function attachmentDisposition(filename: string): string {
  // eslint-disable-next-line no-control-regex
  const safe = filename.replace(/[\u0000-\u001F"\\/]/g, '_').slice(0, 200) || 'source';
  return `attachment; filename="${safe.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
