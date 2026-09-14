import { Injectable } from '@nestjs/common';
import {
  parseDesignDocument,
  type DesignDocument,
  type DocumentIssuePath,
  type DocumentType,
  type DocumentValidationIssue,
} from '@smarttag/document-schema';
import { collectAssetReferences } from '@smarttag/document-utils';
import { PLACEABLE_IMAGE_MIME_TYPES, isPlaceableImageMimeType } from '@smarttag/shared-types';
import { AppError } from '../../common/errors/app-error';
import type { DbClient } from '../../database/prisma.service';

export interface TemplateIdentity {
  readonly id: string;
  readonly organizationId: string;
  readonly documentType: DocumentType;
}

interface ReferencedAsset {
  readonly id: string;
  readonly assetType: string;
  readonly mimeType: string;
  readonly fontFace: { familyName: string; weight: number; style: string } | null;
}

/**
 * The gate every design document passes before it can be stored as a template version:
 *   1. migrate to the current schema version and run the canonical validator
 *   2. the document must describe THIS template (documentId, documentType)
 *   3. every referenced asset must exist in the template's organization and be of the right kind:
 *      images must be placeable image content, fonts must be registered font faces whose family,
 *      weight and style match the text object
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
      issues.push(
        issue(
          'DOCUMENT_ID_MISMATCH',
          ['documentId'],
          'documentId must equal the id of the template the version belongs to',
        ),
      );
    }
    if (document.metadata.documentType !== template.documentType) {
      issues.push(
        issue(
          'DOCUMENT_TYPE_MISMATCH',
          ['metadata', 'documentType'],
          `Document type ${document.metadata.documentType} does not match template type ${template.documentType}`,
        ),
      );
    }

    const referenced = collectAssetReferences(document);
    if (referenced.length > 0) {
      const found: ReferencedAsset[] = await db.asset.findMany({
        where: { organizationId: template.organizationId, id: { in: referenced } },
        select: {
          id: true,
          assetType: true,
          mimeType: true,
          fontFace: { select: { familyName: true, weight: true, style: true } },
        },
      });
      issues.push(...assetReferenceIssues(document, new Map(found.map((a) => [a.id, a]))));
    }

    if (issues.length > 0) {
      throw AppError.invalidDocument(issues);
    }
    return document;
  }
}

function issue(
  code: DocumentValidationIssue['code'],
  path: DocumentIssuePath,
  message: string,
): DocumentValidationIssue {
  return { code, severity: 'error', path, message };
}

function imageReferenceIssue(
  assetId: string,
  asset: ReferencedAsset | undefined,
  path: DocumentIssuePath,
): DocumentValidationIssue | null {
  if (!asset) {
    return issue(
      'UNKNOWN_ASSET_REFERENCE',
      path,
      `Asset ${assetId} does not exist in this organization`,
    );
  }
  if (asset.assetType === 'FONT' || !isPlaceableImageMimeType(asset.mimeType)) {
    return issue(
      'INVALID_ASSET_REFERENCE',
      path,
      `Asset ${assetId} (${asset.mimeType}) cannot be placed as an image; use ${PLACEABLE_IMAGE_MIME_TYPES.join(', ')}`,
    );
  }
  return null;
}

function assetReferenceIssues(
  document: DesignDocument,
  assets: ReadonlyMap<string, ReferencedAsset>,
): DocumentValidationIssue[] {
  const issues: DocumentValidationIssue[] = [];

  document.pages.forEach((page, pageIndex) =>
    page.objects.forEach((object, objectIndex) => {
      const objectPath = ['pages', pageIndex, 'objects', objectIndex] as const;
      if (object.type === 'image' && object.assetId !== null) {
        const found = imageReferenceIssue(object.assetId, assets.get(object.assetId), [
          ...objectPath,
          'assetId',
        ]);
        if (found) issues.push(found);
      }
      if (object.type === 'text' && object.fontAssetId !== null) {
        const face = assets.get(object.fontAssetId);
        if (!face || face.assetType !== 'FONT' || !face.fontFace) {
          issues.push(
            issue(
              'UNKNOWN_FONT_ASSET',
              [...objectPath, 'fontAssetId'],
              `Font asset ${object.fontAssetId} is not a registered font in this organization`,
            ),
          );
        } else if (
          face.fontFace.familyName !== object.fontFamily ||
          face.fontFace.weight !== object.fontWeight ||
          face.fontFace.style !== object.fontStyle
        ) {
          issues.push(
            issue(
              'FONT_FACE_MISMATCH',
              [...objectPath, 'fontAssetId'],
              `Font asset is "${face.fontFace.familyName}" ${face.fontFace.weight} ${face.fontFace.style}, but the text specifies "${object.fontFamily}" ${object.fontWeight} ${object.fontStyle}`,
            ),
          );
        }
      }
    }),
  );

  document.dataSchema.fields.forEach((field, fieldIndex) => {
    if (field.type === 'image' && field.defaultValue !== null) {
      const found = imageReferenceIssue(field.defaultValue, assets.get(field.defaultValue), [
        'dataSchema',
        'fields',
        fieldIndex,
        'defaultValue',
      ]);
      if (found) issues.push(found);
    }
  });
  return issues;
}
