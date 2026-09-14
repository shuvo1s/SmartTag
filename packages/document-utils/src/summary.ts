import type {
  DesignDocument,
  DocumentType,
  Insets,
  MeasurementUnit,
  PageSide,
} from '@smarttag/document-schema';
import { collectAssetReferences } from './assets';
import { listBoundFieldKeys } from './bindings/collect';

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
  readonly assetIds: readonly string[];
}

export function summarizeDesignDocument(document: DesignDocument): DocumentSummary {
  const { dimensions } = document;
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
    boundFieldKeys: listBoundFieldKeys(document),
    assetIds: collectAssetReferences(document),
  };
}
