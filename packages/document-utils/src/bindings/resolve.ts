import type {
  ArtworkObject,
  BindablePropertyKind,
  DataField,
  DesignDocument,
  Page,
} from '@smarttag/document-schema';
import { coerceDataValue, isMissingValue, type DataRecord } from './coerce';
import { forEachBinding } from './collect';

export type BindingIssueCode =
  'MISSING_DATA_VALUE' | 'INVALID_DATA_VALUE' | 'UNKNOWN_BINDING_FIELD';

export interface BindingIssue {
  readonly code: BindingIssueCode;
  readonly pageId: string;
  readonly objectId: string;
  readonly property: string;
  readonly field: string;
  readonly message: string;
}

export interface BindingResolution {
  /** True when every bound property received a usable value. */
  readonly ok: boolean;
  /** A copy of the document with bound properties replaced by record values. Bindings are kept. */
  readonly document: DesignDocument;
  readonly issues: readonly BindingIssue[];
}

type ResolvedValue = string | boolean | null;

/**
 * Applies one data record to a validated document (single-record VDP resolution).
 *
 * Resolution order per bound property:
 *   1. value from the record (coerced to the field's type)
 *   2. the field's defaultValue
 *   3. required field → MISSING_DATA_VALUE; otherwise `settings.missingDataPolicy`
 *      (FAIL → MISSING_DATA_VALUE, EMPTY → empty text / no asset / hidden)
 *
 * The input document is never mutated. Batch execution, transformations and formatting rules
 * build on this function in the VDP phase.
 */
export function resolveDocumentBindings(
  document: DesignDocument,
  record: DataRecord,
): BindingResolution {
  const fields = new Map(document.dataSchema.fields.map((field) => [field.key, field]));
  const issues: BindingIssue[] = [];

  const pages = document.pages.map((page): Page => ({
    ...page,
    objects: page.objects.map((object) =>
      resolveObject(page, object, fields, record, document, issues),
    ),
  }));

  return { ok: issues.length === 0, document: { ...document, pages }, issues };
}

function resolveObject(
  page: Page,
  object: ArtworkObject,
  fields: ReadonlyMap<string, DataField>,
  record: DataRecord,
  document: DesignDocument,
  issues: BindingIssue[],
): ArtworkObject {
  const overrides: Record<string, ResolvedValue> = {};

  forEachBinding(object, (property, kind, binding) => {
    if (binding.mode !== 'FIELD') {
      return;
    }
    const report = (code: BindingIssueCode, message: string) =>
      issues.push({
        code,
        pageId: page.id,
        objectId: object.id,
        property,
        field: binding.field,
        message,
      });

    const field = fields.get(binding.field);
    if (!field) {
      report('UNKNOWN_BINDING_FIELD', `Data field "${binding.field}" is not defined`);
      return;
    }

    const raw = record[field.key];
    if (!isMissingValue(field, raw)) {
      const coerced = coerceDataValue(field, raw as string | number | boolean);
      if (!coerced.ok) {
        report('INVALID_DATA_VALUE', coerced.message);
        return;
      }
      overrides[property] = toPropertyValue(kind, coerced.value);
      return;
    }

    if (field.defaultValue !== null) {
      overrides[property] = toPropertyValue(kind, field.defaultValue);
      return;
    }

    if (field.required || document.settings.missingDataPolicy === 'FAIL') {
      report(
        'MISSING_DATA_VALUE',
        `No value for ${field.required ? 'required ' : ''}field "${field.key}"`,
      );
      return;
    }
    overrides[property] = emptyValue(kind);
  });

  return Object.keys(overrides).length === 0 ? object : { ...object, ...overrides };
}

function toPropertyValue(
  kind: BindablePropertyKind,
  value: string | number | boolean,
): ResolvedValue {
  switch (kind) {
    case 'TEXT':
    case 'SYMBOL_DATA':
    case 'IMAGE_ASSET':
      return String(value);
    case 'VISIBILITY':
      return value === true;
  }
}

function emptyValue(kind: BindablePropertyKind): ResolvedValue {
  switch (kind) {
    case 'TEXT':
    case 'SYMBOL_DATA':
      return '';
    case 'IMAGE_ASSET':
      return null;
    case 'VISIBILITY':
      return false;
  }
}
