export const DOCUMENT_ISSUE_CODES = [
  // structural
  'INVALID_STRUCTURE',
  'UNSUPPORTED_SCHEMA_VERSION',
  'SCHEMA_MIGRATION_REQUIRED',
  'UNSUPPORTED_OBJECT_TYPE',
  // referential integrity
  'DUPLICATE_ID',
  'DUPLICATE_FIELD_KEY',
  'DUPLICATE_Z_INDEX',
  'UNKNOWN_GROUP_REFERENCE',
  'UNKNOWN_BINDING_FIELD',
  'INCOMPATIBLE_BINDING',
  'UNKNOWN_BINDING_MODE',
  'INVALID_PROPERTY_BINDING',
  // data schema
  'INVALID_FIELD_KEY',
  'INVALID_FIELD_RULE',
  'INVALID_FIELD_DEFAULT',
  // expressions (codes shared with @smarttag/expression-core)
  'EXPRESSION_PARSE_ERROR',
  'EXPRESSION_LIMIT_EXCEEDED',
  'UNKNOWN_FIELD',
  'UNKNOWN_FUNCTION',
  'WRONG_ARGUMENT_COUNT',
  'TYPE_MISMATCH',
  // geometry / property semantics
  'INVALID_GEOMETRY',
  'INVALID_PROPERTY',
  // contextual — reported by services that know about the owning template and asset library
  'DOCUMENT_ID_MISMATCH',
  'DOCUMENT_TYPE_MISMATCH',
  'UNKNOWN_ASSET_REFERENCE',
  'INVALID_ASSET_REFERENCE',
  'UNKNOWN_FONT_ASSET',
  'FONT_FACE_MISMATCH',
  // warnings
  'OBJECT_OUTSIDE_BLEED',
  'IMAGE_SOURCE_MISSING',
  'NON_SQUARE_QR_CODE',
  'TEXT_FONT_NOT_CONTROLLED',
] as const;

export type DocumentIssueCode = (typeof DOCUMENT_ISSUE_CODES)[number];
export type DocumentIssueSeverity = 'error' | 'warning';
export type DocumentIssuePath = readonly (string | number)[];

export interface DocumentValidationIssue {
  readonly code: DocumentIssueCode;
  readonly severity: DocumentIssueSeverity;
  /** JSON path into the document, e.g. ["pages", 0, "objects", 3, "bindings", "content"]. */
  readonly path: DocumentIssuePath;
  readonly message: string;
}

export class IssueCollector {
  private readonly issues: DocumentValidationIssue[] = [];

  error(code: DocumentIssueCode, path: DocumentIssuePath, message: string): void {
    this.issues.push({ code, severity: 'error', path, message });
  }

  warning(code: DocumentIssueCode, path: DocumentIssuePath, message: string): void {
    this.issues.push({ code, severity: 'warning', path, message });
  }

  get errors(): DocumentValidationIssue[] {
    return this.issues.filter((issue) => issue.severity === 'error');
  }

  get warnings(): DocumentValidationIssue[] {
    return this.issues.filter((issue) => issue.severity === 'warning');
  }
}

export function formatIssuePath(path: DocumentIssuePath): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') {
      return `${acc}[${segment}]`;
    }
    return acc.length === 0 ? segment : `${acc}.${segment}`;
  }, '');
}
