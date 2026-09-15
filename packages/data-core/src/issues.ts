import type { ArtworkObjectType } from '@smarttag/document-schema';

/**
 * Validation layers, kept separate on purpose (docs/data-bindings.md#validation-layers):
 *
 *   DATA     the record against the data schema (types, required values, rules)
 *   BINDING  resolving bound properties (missing values, expression evaluation)
 *   OBJECT   object-specific checks on resolved values (barcode check digits, QR capacity, images)
 *   LAYOUT   display warnings on resolved artwork (text overflow, glyphs missing from the font)
 *
 * Document schema validation (`validateDesignDocument`) runs before all of them.
 */
export const DATA_ISSUE_LAYERS = ['DATA', 'BINDING', 'OBJECT', 'LAYOUT'] as const;
export type DataIssueLayer = (typeof DATA_ISSUE_LAYERS)[number];

export type DataIssueSeverity = 'ERROR' | 'WARNING';

export const DATA_ISSUE_CODES = [
  // DATA
  'INVALID_RECORD',
  'PAYLOAD_LIMIT_EXCEEDED',
  'REQUIRED_VALUE_MISSING',
  'REQUIRED_VALUE_NULL',
  'REQUIRED_VALUE_EMPTY',
  'INVALID_TYPE',
  'INVALID_VALUE',
  'VALUE_TOO_SHORT',
  'VALUE_TOO_LONG',
  'PATTERN_MISMATCH',
  'VALUE_BELOW_MINIMUM',
  'VALUE_ABOVE_MAXIMUM',
  'VALUE_NOT_ALLOWED',
  'UNKNOWN_FIELD',
  'FORBIDDEN_FIELD_KEY',
  'UNKNOWN_ASSET_REFERENCE',
  // BINDING
  'MISSING_DATA_VALUE',
  'INVALID_DATA_VALUE',
  'EXPRESSION_EVALUATION_ERROR',
  'INVALID_BINDING',
  // OBJECT
  'BARCODE_VALUE_INVALID',
  'QR_VALUE_INVALID',
  'IMAGE_SOURCE_MISSING',
  'IMAGE_ASSET_UNAVAILABLE',
  // LAYOUT
  'TEXT_OVERFLOW',
  'MISSING_GLYPHS',
] as const;
export type DataIssueCode = (typeof DATA_ISSUE_CODES)[number];

/** The artwork property an issue concerns. */
export interface DataIssueTarget {
  readonly pageId: string;
  readonly pageName: string;
  readonly objectId: string;
  readonly objectName: string;
  readonly objectType: ArtworkObjectType;
  /** Bindable property ("content", "value", "assetId", "visible"); null for the whole object. */
  readonly property: string | null;
}

export interface DataIssue {
  readonly layer: DataIssueLayer;
  readonly code: DataIssueCode;
  readonly severity: DataIssueSeverity;
  readonly message: string;
  /** The data field concerned, when there is one. */
  readonly field: string | null;
  /** The artwork property concerned (BINDING, OBJECT and LAYOUT issues). */
  readonly target: DataIssueTarget | null;
}

export function hasErrors(issues: readonly DataIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'ERROR');
}

const PROPERTY_LABELS: Readonly<Record<string, string>> = {
  content: 'Content',
  value: 'Value',
  assetId: 'Image',
  visible: 'Visibility',
};

/** Human label of a bindable property: "content" → "Content", "assetId" → "Image". */
export function describeBindableProperty(property: string): string {
  return PROPERTY_LABELS[property] ?? property;
}

/** "Front / Product Name / Content" */
export function describeTarget(target: DataIssueTarget): string {
  const object = target.objectName || target.objectId;
  return target.property
    ? `${target.pageName} / ${object} / ${describeBindableProperty(target.property)}`
    : `${target.pageName} / ${object}`;
}
