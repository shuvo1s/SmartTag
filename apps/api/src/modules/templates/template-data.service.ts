import { Injectable } from '@nestjs/common';
import {
  DATA_LIMITS,
  buildDataPreview,
  computeResolvedInputHash,
  summarizeDataIssues,
  validateDataRecord,
  type AssetAvailability,
  type DataIssue,
} from '@smarttag/data-core';
import { parseDesignDocument, type DesignDocument } from '@smarttag/document-schema';
import {
  isPlaceableImageMimeType,
  type TemplateDataValidationDto,
  type ValidateTemplateDataRequest,
} from '@smarttag/shared-types';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { PrismaService } from '../../database/prisma.service';

/**
 * Validates one data record against a template version with the shared data-core pipeline:
 * record validation, binding resolution and object checks on the resolved artwork. The version is
 * only read — never modified — so the document hash is unchanged by definition. Records are not
 * logged or audited: they may contain customer production data.
 */
@Injectable()
export class TemplateDataService {
  constructor(private readonly prisma: PrismaService) {}

  async validateRecord(
    actor: ActorContext,
    versionId: string,
    input: ValidateTemplateDataRequest,
  ): Promise<TemplateDataValidationDto> {
    const serialized = JSON.stringify(input.record) ?? '';
    if (Buffer.byteLength(serialized, 'utf8') > DATA_LIMITS.maxRecordBytes) {
      throw new AppError(
        'PAYLOAD_TOO_LARGE',
        `A data record may be at most ${DATA_LIMITS.maxRecordBytes / 1024} KB`,
      );
    }

    const version = await this.prisma.templateVersion.findFirst({
      where: { id: versionId, organizationId: actor.organizationId },
      select: { id: true, documentJson: true, documentHash: true },
    });
    if (!version) {
      throw AppError.notFound('Template version');
    }
    const parsed = parseDesignDocument(version.documentJson);
    if (!parsed.valid) {
      throw AppError.invalidDocument(parsed.errors, 'The stored design document is invalid');
    }
    const document = parsed.document;

    // Image values must be assets of THIS organization that can be placed. The lookup is
    // tenant-scoped, so an id owned by another organization is indistinguishable from a missing one.
    const availability = await this.imageAvailability(actor.organizationId, document, input.record);
    const preview = buildDataPreview(document, input.record, {
      assetAvailability: (assetId) => availability.get(assetId) ?? 'UNKNOWN',
    });

    const assetIssues: DataIssue[] = [];
    for (const field of document.dataSchema.fields) {
      const value = preview.record.normalizedRecord[field.key];
      const status = preview.record.fields.find((candidate) => candidate.key === field.key);
      if (
        field.type === 'image' &&
        typeof value === 'string' &&
        status?.source === 'RECORD' &&
        availability.get(value) !== 'AVAILABLE'
      ) {
        assetIssues.push({
          layer: 'DATA',
          code: 'UNKNOWN_ASSET_REFERENCE',
          severity: 'ERROR',
          field: field.key,
          target: null,
          message: `${field.displayName}: asset ${value} is not a placeable image of this organization`,
        });
      }
    }

    const issues = [
      ...preview.record.issues,
      ...assetIssues,
      ...preview.issues.slice(preview.record.issues.length),
    ];
    const valid = preview.record.valid && assetIssues.length === 0;
    const { fields: fieldResults, ...summary } = summarizeDataIssues(document.dataSchema, issues);

    return {
      templateVersionId: version.id,
      documentHash: version.documentHash,
      schemaVersion: document.schemaVersion,
      valid,
      productionValid: !issues.some((issue) => issue.severity === 'ERROR'),
      issues,
      summary,
      fields: preview.record.fields.map((field) => ({
        key: field.key,
        state: fieldResults.find((result) => result.key === field.key)?.state ?? 'VALID',
        source: field.source,
      })),
      normalizedRecord: { ...preview.record.normalizedRecord },
      resolvedInputHash: valid
        ? await computeResolvedInputHash(version.documentHash, preview.record.normalizedRecord)
        : null,
    };
  }

  private async imageAvailability(
    organizationId: string,
    document: DesignDocument,
    record: unknown,
  ): Promise<Map<string, AssetAvailability>> {
    const imageFields = document.dataSchema.fields.filter((field) => field.type === 'image');
    if (imageFields.length === 0) return new Map();
    const normalized = validateDataRecord({ fields: imageFields }, record).normalizedRecord;
    const ids = [
      ...new Set(
        Object.values(normalized).filter((value): value is string => typeof value === 'string'),
      ),
    ];
    const availability = new Map<string, AssetAvailability>(ids.map((id) => [id, 'UNAVAILABLE']));
    if (ids.length === 0) return availability;
    const assets = await this.prisma.asset.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, assetType: true, mimeType: true },
    });
    for (const asset of assets) {
      if (asset.assetType !== 'FONT' && isPlaceableImageMimeType(asset.mimeType)) {
        availability.set(asset.id, 'AVAILABLE');
      }
    }
    return availability;
  }
}
