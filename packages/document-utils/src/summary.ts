import type {
  DesignDocument,
  DocumentType,
  Insets,
  MeasurementUnit,
  PageSide,
} from '@smarttag/document-schema';
import { collectAssetReferences, collectAssetReferencesByKind } from './assets';
import { collectBoundProperties } from './bindings/collect';

/** Compact, render-free description of a document for listings and detail screens. */
export interface DocumentSummary {
  readonly documentType: DocumentType;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly orientation: DesignDocument['dimensions']['orientation'];
  readonly displayUnit: MeasurementUnit;
  readonly bleedPt: Insets;
  readonly safeAreaPt: Insets;
  readonly pageCount: number;
  readonly pageSides: readonly PageSide[];
  readonly objectCount: number;
  readonly dataFieldCount: number;
  readonly boundFieldKeys: readonly string[];
  /** Properties driven by data (field or expression bindings). */
  readonly boundPropertyCount: number;
  /** Properties driven by expressions. */
  readonly expressionCount: number;
  /** All referenced assets (images and fonts). */
  readonly assetIds: readonly string[];
  readonly fontAssetIds: readonly string[];
}

export function summarizeDesignDocument(document: DesignDocument): DocumentSummary {
  const { dimensions } = document;
  const bound = collectBoundProperties(document);
  return {
    documentType: document.metadata.documentType,
    widthPt: dimensions.width,
    heightPt: dimensions.height,
    orientation: dimensions.orientation,
    displayUnit: dimensions.displayUnit,
    bleedPt: dimensions.bleed,
    safeAreaPt: dimensions.safeArea,
    pageCount: document.pages.length,
    pageSides: document.pages.map((page) => page.side),
    objectCount: document.pages.reduce((count, page) => count + page.objects.length, 0),
    dataFieldCount: document.dataSchema.fields.length,
    boundFieldKeys: [...new Set(bound.flatMap((property) => property.fields))],
    boundPropertyCount: bound.length,
    expressionCount: bound.filter((property) => property.mode === 'EXPRESSION').length,
    assetIds: collectAssetReferences(document),
    fontAssetIds: collectAssetReferencesByKind(document).fontAssetIds,
  };
}
