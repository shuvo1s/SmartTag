import { Injectable } from '@nestjs/common';
import {
  parseDesignDocument,
  type DesignDocument,
  type DocumentType,
  type DocumentValidationIssue,
} from '@smarttag/document-schema';
import { collectAssetReferences } from '@smarttag/document-utils';
import { AppError } from '../../common/errors/app-error';
import type { DbClient } from '../../database/prisma.service';

export interface TemplateIdentity {
  readonly id: string;
  readonly organizationId: string;
  readonly documentType: DocumentType;
}

/**
 * The gate every design document passes before it can be stored as a template version:
 *   1. migrate to the current schema version and run the canonical validator
 *   2. the document must describe THIS template (documentId, documentType)
 *   3. every referenced asset must exist in the template's organization
 */
@Injectable()
export class TemplateDocumentService {
  async validateForTemplate(
    db: DbClient,
    template: TemplateIdentity,
    input: unknown,
  ): Promise<DesignDocument> {
    const parsed = parseDesignDocument(input);
    if (!parsed.valid) {
      throw AppError.invalidDocument(parsed.errors);
    }
    const document = parsed.document;
    const issues: DocumentValidationIssue[] = [];

    if (document.documentId !== template.id) {
      issues.push({
        code: 'DOCUMENT_ID_MISMATCH',
        severity: 'error',
        path: ['documentId'],
        message: 'documentId must equal the id of the template the version belongs to',
      });
    }
    if (document.metadata.documentType !== template.documentType) {
      issues.push({
        code: 'DOCUMENT_TYPE_MISMATCH',
        severity: 'error',
        path: ['metadata', 'documentType'],
        message: `Document type ${document.metadata.documentType} does not match template type ${template.documentType}`,
      });
    }

    const referenced = collectAssetReferences(document);
    if (referenced.length > 0) {
      const found = await db.asset.findMany({
        where: { organizationId: template.organizationId, id: { in: referenced } },
        select: { id: true },
      });
      const available = new Set(found.map((asset) => asset.id));
      for (const assetId of referenced.filter((id) => !available.has(id))) {
        issues.push(...assetReferenceIssues(document, assetId));
      }
    }

    if (issues.length > 0) {
      throw AppError.invalidDocument(issues);
    }
    return document;
  }
}

function assetReferenceIssues(
  document: DesignDocument,
  assetId: string,
): DocumentValidationIssue[] {
  const issues: DocumentValidationIssue[] = [];
  const message = `Asset ${assetId} does not exist in this organization`;
  document.pages.forEach((page, pageIndex) =>
    page.objects.forEach((object, objectIndex) => {
      if (object.type === 'image' && object.assetId === assetId) {
        issues.push({
          code: 'UNKNOWN_ASSET_REFERENCE',
          severity: 'error',
          path: ['pages', pageIndex, 'objects', objectIndex, 'assetId'],
          message,
        });
      }
    }),
  );
  document.dataSchema.fields.forEach((field, fieldIndex) => {
    if (field.type === 'image' && field.defaultValue === assetId) {
      issues.push({
        code: 'UNKNOWN_ASSET_REFERENCE',
        severity: 'error',
        path: ['dataSchema', 'fields', fieldIndex, 'defaultValue'],
        message,
      });
    }
  });
  return issues;
}
