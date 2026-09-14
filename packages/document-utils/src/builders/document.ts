import {
  CURRENT_SCHEMA_VERSION,
  type DataField,
  type DesignDocument,
  type DocumentType,
  type MeasurementUnit,
  type Page,
} from '@smarttag/document-schema';
import { createDocumentId } from '../ids';
import { toPoints } from '../units';
import { uniformInsets } from './primitives';

export const PAGE_LAYOUTS = ['FRONT_ONLY', 'FRONT_AND_BACK'] as const;
export type PageLayout = (typeof PAGE_LAYOUTS)[number];

export interface BlankDocumentOptions {
  readonly name: string;
  readonly description?: string;
  readonly documentType: DocumentType;
  /** Physical sizes below are expressed in `unit` and converted to canonical points. */
  readonly unit: MeasurementUnit;
  readonly width: number;
  readonly height: number;
  readonly bleed: number;
  readonly safeMargin: number;
  /** Layout margin guides; defaults to the safe margin. */
  readonly margin?: number;
  readonly pageLayout: PageLayout;
  readonly documentId?: string;
  readonly language?: string | null;
  readonly dataFields?: readonly DataField[];
}

export const FRONT_PAGE_ID = 'page-front';
export const BACK_PAGE_ID = 'page-back';

export function createBlankPage(id: string, name: string, side: Page['side']): Page {
  return { id, name, side, background: null, groups: [], objects: [] };
}

/**
 * Creates an empty but fully valid canonical document from user-facing inputs.
 * This is the only place user units are converted into stored geometry for new designs.
 */
export function createBlankDesignDocument(options: BlankDocumentOptions): DesignDocument {
  const width = toPoints(options.width, options.unit);
  const height = toPoints(options.height, options.unit);
  const bleed = toPoints(options.bleed, options.unit);
  const safeMargin = toPoints(options.safeMargin, options.unit);
  const margin = toPoints(options.margin ?? options.safeMargin, options.unit);

  const pages: Page[] = [createBlankPage(FRONT_PAGE_ID, 'Front', 'FRONT')];
  if (options.pageLayout === 'FRONT_AND_BACK') {
    pages.push(createBlankPage(BACK_PAGE_ID, 'Back', 'BACK'));
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    documentId: options.documentId ?? createDocumentId(),
    metadata: {
      name: options.name,
      description: options.description ?? '',
      documentType: options.documentType,
      language: options.language ?? null,
      tags: [],
    },
    dimensions: {
      width,
      height,
      orientation: width > height ? 'LANDSCAPE' : 'PORTRAIT',
      displayUnit: options.unit,
      bleed: uniformInsets(bleed),
      safeArea: uniformInsets(safeMargin),
      margins: uniformInsets(margin),
      dieline: { trimShape: { type: 'RECTANGLE', cornerRadius: 0 }, features: [] },
    },
    printSettings: { colorSpace: 'RGB', backSideFlip: 'HORIZONTAL', cropMarks: false },
    pages,
    dataSchema: { fields: [...(options.dataFields ?? [])] },
    settings: { missingDataPolicy: 'FAIL' },
  };
}
