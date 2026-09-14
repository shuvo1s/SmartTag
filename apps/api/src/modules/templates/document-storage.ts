import type { DesignDocument } from '@smarttag/document-schema';
import { computeDocumentHash, summarizeDesignDocument } from '@smarttag/document-utils';
import type { DocumentSummaryDto } from '@smarttag/shared-types';
import type { Prisma } from '../../generated/prisma/client';

export interface PreparedDocument {
  readonly schemaVersion: number;
  readonly documentJson: Prisma.InputJsonObject;
  readonly documentHash: string;
  readonly summaryJson: Prisma.InputJsonObject;
}

/**
 * Converts a VALIDATED document into the persisted column values. The hash is computed over the
 * canonical form, so it can be re-verified from the stored JSON at any time.
 */
export async function prepareDocumentForStorage(document: DesignDocument): Promise<PreparedDocument> {
  const summary: DocumentSummaryDto = summarizeDesignDocument(document);
  return {
    schemaVersion: document.schemaVersion,
    documentJson: toJsonObject(document),
    documentHash: await computeDocumentHash(document),
    summaryJson: toJsonObject(summary),
  };
}

function toJsonObject(value: object): Prisma.InputJsonObject {
  // Validated documents are plain JSON already; the round trip strips readonly typing and
  // guarantees nothing non-JSON reaches the database.
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}
