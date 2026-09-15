import type {
  ArtworkObject,
  BindablePropertyKind,
  DataField,
  DesignDocument,
  Page,
  PropertyBinding,
} from '@smarttag/document-schema';
import { forEachBinding } from '@smarttag/document-utils';
import {
  NULL_VALUE,
  evaluateExpression,
  parseExpression,
  valueToText,
  type ExpressionNode,
  type ExpressionValue,
} from '@smarttag/expression-core';
import type { DataIssue, DataIssueTarget } from './issues';
import type { NormalizedDataRecord, NormalizedValue } from './validate-record';

/** A resolved property value as it is written into the artwork object. */
export type ResolvedPropertyValue = string | boolean | null;

export interface ResolutionInput {
  readonly normalizedRecord: NormalizedDataRecord;
  /** Fields whose record value was invalid (normalized to null). */
  readonly invalidFields?: ReadonlySet<string>;
}

export interface ResolvedProperty {
  readonly target: DataIssueTarget & { readonly property: string };
  readonly kind: BindablePropertyKind;
  readonly mode: 'FIELD' | 'EXPRESSION';
  readonly value: ResolvedPropertyValue;
  /** Field keys the value depends on that had no value. */
  readonly missingFields: readonly string[];
  /** True when resolving produced an ERROR for this property. */
  readonly failed: boolean;
}

export interface DocumentResolution {
  /**
   * The document with bound properties replaced. Bindings are kept, so it stays traceable to the
   * data schema. Objects (and pages) whose values did not change keep their identity.
   */
  readonly document: DesignDocument;
  /** BINDING-layer issues. */
  readonly issues: readonly DataIssue[];
  readonly properties: readonly ResolvedProperty[];
  /** Objects visible in the template that data hides (their visibility binding resolved false). */
  readonly hiddenObjectIds: ReadonlySet<string>;
}

const astCache = new Map<string, ExpressionNode | null>();
const AST_CACHE_LIMIT = 2_000;

function parsedExpression(source: string): ExpressionNode | null {
  if (astCache.has(source)) return astCache.get(source)!;
  const parsed = parseExpression(source);
  const ast = parsed.ok ? parsed.ast : null;
  if (astCache.size >= AST_CACHE_LIMIT) astCache.clear();
  astCache.set(source, ast);
  return ast;
}

/** The typed expression value of a normalized field value. */
export function fieldValueToExpression(field: DataField, value: NormalizedValue): ExpressionValue {
  if (value === null) return NULL_VALUE;
  switch (field.type) {
    case 'number':
      return typeof value === 'number' ? { type: 'number', value } : NULL_VALUE;
    case 'boolean':
      return typeof value === 'boolean' ? { type: 'boolean', value } : NULL_VALUE;
    case 'string':
    case 'decimal':
    case 'date':
    case 'url':
    case 'image':
      return typeof value === 'string' ? { type: field.type, value } : NULL_VALUE;
  }
}

/**
 * Resolved objects are cached per source object. When a record changes only some values, the
 * other resolved objects are returned with the same identity, so memoized text layouts, symbol
 * geometry and canvas objects are reused instead of recomputed.
 */
const resolvedObjectCache = new WeakMap<ArtworkObject, { key: string; object: ArtworkObject }>();
const resolvedPageCache = new WeakMap<Page, { objects: readonly ArtworkObject[]; page: Page }>();

/**
 * Applies one normalized data record to a validated document (single-record resolution).
 *
 * Per bound property:
 *   FIELD       the normalized field value (record value or default)
 *   EXPRESSION  the expression evaluated over normalized values (missing values read as null)
 * then converted for the property: text for content/values, an asset id for images, true/false
 * for visibility.
 *
 * When the value depends on a field without a value:
 *   - the field is invalid in the record          → INVALID_DATA_VALUE (ERROR)
 *   - the field is required                       → MISSING_DATA_VALUE (ERROR)
 *   - optional, policy FAIL                       → MISSING_DATA_VALUE (ERROR)
 *   - optional, policy WARN                       → MISSING_DATA_VALUE (WARNING)
 *   - optional, policy EMPTY                      → no issue
 * Visibility is resolved first; missing values of objects that do not print (hidden by data, by
 * their template visibility or by their group) are not reported.
 * A FIELD property without a value renders empty ("" / no image / hidden). Expressions render
 * their own result (e.g. fallback() alternatives). Static sample values are never used as a
 * fallback, so sample data can never be printed as if it were real data.
 *
 * The source document is never mutated.
 */
export function resolveDocumentBindings(
  document: DesignDocument,
  input: ResolutionInput,
): DocumentResolution {
  const fields = new Map(document.dataSchema.fields.map((field) => [field.key, field]));
  const invalid = input.invalidFields ?? new Set<string>();
  const policy = document.settings.missingDataPolicy;
  const issues: DataIssue[] = [];
  const properties: ResolvedProperty[] = [];
  const hiddenObjectIds = new Set<string>();

  const lookup = (key: string): ExpressionValue | undefined => {
    const field = fields.get(key);
    if (!field) return undefined;
    const value = Object.hasOwn(input.normalizedRecord, key) ? input.normalizedRecord[key]! : null;
    return fieldValueToExpression(field, value);
  };

  let pagesChanged = false;
  const pages = document.pages.map((page): Page => {
    let objectsChanged = false;
    const objects = page.objects.map((object) => {
      const resolved = resolveObject(page, object);
      if (resolved !== object) objectsChanged = true;
      return resolved;
    });
    if (!objectsChanged) return page;
    pagesChanged = true;
    const cached = resolvedPageCache.get(page);
    if (cached?.objects.every((object, index) => object === objects[index])) return cached.page;
    const resolvedPage = { ...page, objects };
    resolvedPageCache.set(page, { objects, page: resolvedPage });
    return resolvedPage;
  });

  function resolveObject(page: Page, object: ArtworkObject): ArtworkObject {
    const bound: [string, BindablePropertyKind, Exclude<PropertyBinding, { mode: 'STATIC' }>][] =
      [];
    forEachBinding(object, (property, kind, binding) => {
      if (binding.mode !== 'STATIC') bound.push([property, kind, binding]);
    });
    if (bound.length === 0) return object;
    // Visibility first: values of an object that data hides never print, so missing values of
    // its other properties are not reported.
    bound.sort(([a], [b]) => Number(b === 'visible') - Number(a === 'visible'));
    const groupVisible =
      object.groupId === null ||
      (page.groups.find((group) => group.id === object.groupId)?.visible ?? true);
    let printed = object.visible && groupVisible;

    const overrides: Record<string, ResolvedPropertyValue> = {};
    for (const [property, kind, binding] of bound) {
      const target = {
        pageId: page.id,
        pageName: page.name,
        objectId: object.id,
        objectName: object.name,
        objectType: object.type,
        property,
      };
      const isVisibility = property === 'visible';
      const resolved = resolveProperty(
        target,
        kind,
        binding,
        object,
        isVisibility ? groupVisible : printed,
      );
      properties.push(resolved);
      overrides[property] = resolved.value;
      if (isVisibility) {
        printed = resolved.value === true && groupVisible;
        if (object.visible && resolved.value === false) hiddenObjectIds.add(object.id);
      }
    }
    const keys = Object.keys(overrides);
    if (keys.length === 0) return object;
    const record = object as unknown as Readonly<Record<string, unknown>>;
    if (keys.every((key) => record[key] === overrides[key])) return object;

    const cacheKey = JSON.stringify(keys.map((key) => [key, overrides[key]]));
    const cached = resolvedObjectCache.get(object);
    if (cached?.key === cacheKey) return cached.object;
    const resolvedObject: ArtworkObject = { ...object, ...overrides };
    resolvedObjectCache.set(object, { key: cacheKey, object: resolvedObject });
    return resolvedObject;
  }

  function report(
    target: ResolvedProperty['target'],
    code: DataIssue['code'],
    severity: DataIssue['severity'],
    field: string | null,
    message: string,
  ) {
    issues.push({ layer: 'BINDING', code, severity, message, field, target });
  }

  function resolveProperty(
    target: ResolvedProperty['target'],
    kind: BindablePropertyKind,
    binding: Exclude<PropertyBinding, { mode: 'STATIC' }>,
    object: ArtworkObject,
    printed: boolean,
  ): ResolvedProperty {
    const label = `${target.objectName || target.objectId}`;
    let value: ExpressionValue;
    let missingFields: readonly string[];

    if (binding.mode === 'FIELD') {
      const fieldValue = lookup(binding.field);
      if (!fieldValue) {
        report(
          target,
          'INVALID_BINDING',
          'ERROR',
          binding.field,
          `${label}: data field "${binding.field}" does not exist`,
        );
        return failed(target, kind, binding.mode, object, []);
      }
      value = fieldValue;
      missingFields = fieldValue.type === 'null' ? [binding.field] : [];
    } else {
      const ast = parsedExpression(binding.expression);
      if (!ast) {
        report(
          target,
          'INVALID_BINDING',
          'ERROR',
          null,
          `${label}: the expression cannot be parsed`,
        );
        return failed(target, kind, binding.mode, object, []);
      }
      const result = evaluateExpression(ast, { fieldValue: lookup });
      if (!result.ok) {
        report(
          target,
          'EXPRESSION_EVALUATION_ERROR',
          'ERROR',
          null,
          `${label}: ${result.error.message}`,
        );
        return failed(target, kind, binding.mode, object, []);
      }
      value = result.value;
      missingFields = result.missingFields;
    }

    let hadError = false;
    // Missing and invalid values only matter for artwork that prints.
    for (const key of printed ? missingFields : []) {
      const field = fields.get(key)!;
      if (invalid.has(key)) {
        hadError = true;
        report(
          target,
          'INVALID_DATA_VALUE',
          'ERROR',
          key,
          `${label} uses ${field.displayName}, which has an invalid value`,
        );
      } else if (field.required || policy === 'FAIL') {
        hadError = true;
        report(
          target,
          'MISSING_DATA_VALUE',
          'ERROR',
          key,
          `${label} has no value for ${field.required ? 'required ' : ''}field ${field.displayName}`,
        );
      } else if (policy === 'WARN') {
        report(
          target,
          'MISSING_DATA_VALUE',
          'WARNING',
          key,
          `${label} has no value for ${field.displayName}; it is left empty`,
        );
      }
    }

    const converted = toPropertyValue(kind, value);
    if (converted === undefined) {
      report(
        target,
        'EXPRESSION_EVALUATION_ERROR',
        'ERROR',
        null,
        `${label}: the result is ${value.type}, which cannot be used here`,
      );
      return failed(target, kind, binding.mode, object, missingFields);
    }
    return { target, kind, mode: binding.mode, value: converted, missingFields, failed: hadError };
  }

  return {
    document: pagesChanged ? { ...document, pages } : document,
    issues,
    properties,
    hiddenObjectIds,
  };
}

/** Converts a value for a property kind; undefined when the value type does not fit. */
function toPropertyValue(
  kind: BindablePropertyKind,
  value: ExpressionValue,
): ResolvedPropertyValue | undefined {
  switch (kind) {
    case 'TEXT':
    case 'SYMBOL_DATA':
      if (value.type === 'boolean' || value.type === 'image') return undefined;
      return valueToText(value) ?? '';
    case 'IMAGE_ASSET':
      if (value.type === 'null') return null;
      return value.type === 'image' ? value.value : undefined;
    case 'VISIBILITY':
      if (value.type === 'null') return false;
      return value.type === 'boolean' ? value.value : undefined;
  }
}

/**
 * Value of a property whose resolution failed: empty content, no image — but visibility keeps its
 * template value so the object (and its error indicator) stays visible for correction.
 */
function failed(
  target: ResolvedProperty['target'],
  kind: BindablePropertyKind,
  mode: 'FIELD' | 'EXPRESSION',
  object: ArtworkObject,
  missingFields: readonly string[],
): ResolvedProperty {
  const value: ResolvedPropertyValue =
    kind === 'VISIBILITY' ? object.visible : kind === 'IMAGE_ASSET' ? null : '';
  return { target, kind, mode, value, missingFields, failed: true };
}
