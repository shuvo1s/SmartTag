import {
  DataFieldSchema,
  FIELD_KEY_PATTERN,
  MAX_DATA_FIELDS,
  OBJECT_BINDABLE_PROPERTIES,
  checkFieldDefinition,
  checkPropertyBinding,
  emptyValidationFor,
  fieldLookup,
  isReservedFieldKey,
  type ArtworkObject,
  type BindablePropertyKind,
  type DataField,
  type DataFieldType,
  type DesignDocument,
  type MissingDataPolicy,
  type PropertyBinding,
} from '@smarttag/document-schema';
import { bindingFieldKeys, canonicalizeJson } from '@smarttag/document-utils';
import { renameFieldReferences } from '@smarttag/expression-core';
import { EditorCommandError, findPage, withObjects } from './document-access';

/**
 * Data schema and binding commands: pure functions from one canonical document to the next, run
 * through `EditorStore.apply` so each is exactly one undo step. Every command validates with the
 * same rules as canonical validation (document-schema), so the editor can never produce a data
 * schema or binding that saving would reject.
 */

/** A field is still referenced by artwork and cannot disappear or change type silently. */
export class FieldInUseError extends EditorCommandError {
  constructor(
    readonly key: string,
    readonly usageCount: number,
  ) {
    super(
      `Field "${key}" is used by ${usageCount} design propert${usageCount === 1 ? 'y' : 'ies'}`,
    );
    this.name = 'FieldInUseError';
  }
}

function describeFieldProblem(field: unknown): string | null {
  const parsed = DataFieldSchema.safeParse(field);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    return `${path ? `${path}: ` : ''}${issue?.message ?? 'Invalid field'}`;
  }
  const [problem] = checkFieldDefinition(parsed.data);
  return problem ? problem.message : null;
}

/** Validation message for a proposed key, or null when the key can be used. */
export function checkNewFieldKey(
  document: DesignDocument,
  key: string,
  options: { readonly ignoreKey?: string } = {},
): string | null {
  if (key.length === 0) return 'Enter a key';
  if (isReservedFieldKey(key)) {
    return key.startsWith('__')
      ? 'Keys starting with "__" are reserved for system fields'
      : `"${key}" is reserved and cannot be used`;
  }
  if (!FIELD_KEY_PATTERN.test(key)) {
    return 'Keys start with a lowercase letter and use only a–z, 0–9 and "_" (at most 64)';
  }
  if (key !== options.ignoreKey && document.dataSchema.fields.some((field) => field.key === key)) {
    return `A field with the key "${key}" already exists`;
  }
  return null;
}

function requireField(document: DesignDocument, key: string): DataField {
  const field = document.dataSchema.fields.find((candidate) => candidate.key === key);
  if (!field) throw new EditorCommandError(`Data field "${key}" does not exist`);
  return field;
}

function withFields(document: DesignDocument, fields: readonly DataField[]): DesignDocument {
  return { ...document, dataSchema: { ...document.dataSchema, fields: [...fields] } };
}

/** Number of bound properties that read a field (field bindings and expressions). */
export function countFieldUsages(document: DesignDocument, key: string): number {
  let count = 0;
  forEachBoundProperty(document, (_object, _property, binding) => {
    if (bindingFieldKeys(binding).includes(key)) count += 1;
  });
  return count;
}

function forEachBoundProperty(
  document: DesignDocument,
  visit: (object: ArtworkObject, property: string, binding: PropertyBinding) => void,
): void {
  for (const page of document.pages) {
    for (const object of page.objects) {
      const bindings = object.bindings as Readonly<Record<string, PropertyBinding>>;
      for (const property of Object.keys(OBJECT_BINDABLE_PROPERTIES[object.type])) {
        const binding = bindings[property];
        if (binding) visit(object, property, binding);
      }
    }
  }
}

/** Rewrites bindings across all pages; objects without changes keep their identity. */
function mapBindings(
  document: DesignDocument,
  update: (binding: PropertyBinding) => PropertyBinding,
): DesignDocument {
  let changed = false;
  const pages = document.pages.map((page) => {
    let pageChanged = false;
    const objects = page.objects.map((object) => {
      const bindings = object.bindings as Readonly<Record<string, PropertyBinding>>;
      let objectChanged = false;
      const next: Record<string, PropertyBinding> = {};
      for (const [property, binding] of Object.entries(bindings)) {
        const updated = update(binding);
        if (updated !== binding) objectChanged = true;
        next[property] = updated;
      }
      if (!objectChanged) return object;
      pageChanged = true;
      return { ...object, bindings: next } as ArtworkObject;
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, objects };
  });
  return changed ? { ...document, pages } : document;
}

/** Adds a field at the end of the data schema (or at `index`). */
export function addDataField(
  document: DesignDocument,
  field: DataField,
  index: number = document.dataSchema.fields.length,
): DesignDocument {
  const keyProblem = checkNewFieldKey(document, field.key);
  if (keyProblem) throw new EditorCommandError(keyProblem);
  if (document.dataSchema.fields.length >= MAX_DATA_FIELDS) {
    throw new EditorCommandError(`A data schema can have at most ${MAX_DATA_FIELDS} fields`);
  }
  const problem = describeFieldProblem(field);
  if (problem) throw new EditorCommandError(problem);
  const fields = [...document.dataSchema.fields];
  fields.splice(Math.max(0, Math.min(fields.length, index)), 0, field);
  return withFields(document, fields);
}

export interface DataFieldPatch {
  readonly displayName?: string;
  readonly type?: DataFieldType;
  readonly required?: boolean;
  readonly defaultValue?: DataField['defaultValue'];
  readonly description?: string;
  readonly validation?: DataField['validation'];
}

/**
 * Edits a field's definition. The key is changed only by `renameDataField`. The type of a field
 * that artwork uses cannot change (bindings could become incompatible); changing the type of an
 * unused field resets its default and rules unless new ones are given.
 */
export function updateDataField(
  document: DesignDocument,
  key: string,
  patch: DataFieldPatch,
): DesignDocument {
  const current = requireField(document, key);
  const typeChanges = patch.type !== undefined && patch.type !== current.type;
  if (typeChanges) {
    const usages = countFieldUsages(document, key);
    if (usages > 0) throw new FieldInUseError(key, usages);
  }
  const type = patch.type ?? current.type;
  const next = {
    key,
    displayName: patch.displayName ?? current.displayName,
    type,
    required: patch.required ?? current.required,
    defaultValue:
      patch.defaultValue !== undefined
        ? patch.defaultValue
        : typeChanges
          ? null
          : current.defaultValue,
    description: patch.description ?? current.description,
    validation: patch.validation ?? (typeChanges ? emptyValidationFor(type) : current.validation),
  } as DataField;
  const problem = describeFieldProblem(next);
  if (problem) throw new EditorCommandError(problem);
  // Stored documents may have any key order (JSONB); compare canonical forms.
  if (canonicalizeJson(next) === canonicalizeJson(current)) return document;
  return withFields(
    document,
    document.dataSchema.fields.map((field) => (field.key === key ? next : field)),
  );
}

export interface RenameResult {
  readonly document: DesignDocument;
  /** Bound properties whose field binding or expression was updated. */
  readonly updatedBindings: number;
}

/**
 * Changes a field key and updates every field binding and expression that uses it — atomically,
 * as one document change. Refuses when any affected expression cannot be rewritten safely, so a
 * rename never leaves a dangling reference.
 */
export function renameDataField(document: DesignDocument, from: string, to: string): RenameResult {
  requireField(document, from);
  if (from === to) return { document, updatedBindings: 0 };
  const keyProblem = checkNewFieldKey(document, to);
  if (keyProblem) throw new EditorCommandError(keyProblem);

  let updatedBindings = 0;
  const renamed = mapBindings(document, (binding) => {
    if (binding.mode === 'FIELD' && binding.field === from) {
      updatedBindings += 1;
      return { mode: 'FIELD', field: to };
    }
    if (binding.mode === 'EXPRESSION' && bindingFieldKeys(binding).includes(from)) {
      const result = renameFieldReferences(binding.expression, from, to);
      if (!result.ok) {
        throw new EditorCommandError(
          `An expression using "${from}" cannot be updated automatically: ${result.error.message}`,
        );
      }
      updatedBindings += 1;
      return { mode: 'EXPRESSION', expression: result.source };
    }
    return binding;
  });
  const fields = renamed.dataSchema.fields.map((field) =>
    field.key === from ? { ...field, key: to } : field,
  );
  return { document: withFields(renamed, fields), updatedBindings };
}

export interface DeleteFieldResult {
  readonly document: DesignDocument;
  /** Bound properties that were returned to static values. */
  readonly removedBindings: number;
}

/**
 * Deletes a field. A field that artwork uses is refused with `FieldInUseError` unless
 * `removeBindings` is set; then every binding that reads the field (including expressions) returns
 * to STATIC — the property's stored static value — in the same document change.
 */
export function deleteDataField(
  document: DesignDocument,
  key: string,
  options: { readonly removeBindings: boolean },
): DeleteFieldResult {
  requireField(document, key);
  const usages = countFieldUsages(document, key);
  if (usages > 0 && !options.removeBindings) throw new FieldInUseError(key, usages);
  let removedBindings = 0;
  const unbound = mapBindings(document, (binding) => {
    if (binding.mode !== 'STATIC' && bindingFieldKeys(binding).includes(key)) {
      removedBindings += 1;
      return { mode: 'STATIC' };
    }
    return binding;
  });
  return {
    document: withFields(
      unbound,
      unbound.dataSchema.fields.filter((field) => field.key !== key),
    ),
    removedBindings,
  };
}

/** Moves a field to a new position in the schema (order shown in panels and forms). */
export function moveDataField(
  document: DesignDocument,
  key: string,
  toIndex: number,
): DesignDocument {
  const fields = [...document.dataSchema.fields];
  const from = fields.findIndex((field) => field.key === key);
  if (from < 0) throw new EditorCommandError(`Data field "${key}" does not exist`);
  const target = Math.max(0, Math.min(fields.length - 1, toIndex));
  if (target === from) return document;
  const [moved] = fields.splice(from, 1);
  fields.splice(target, 0, moved!);
  return withFields(document, fields);
}

/** The kind of value a property accepts, or null when it cannot be bound. */
export function bindablePropertyKind(
  object: ArtworkObject,
  property: string,
): BindablePropertyKind | null {
  const properties: Readonly<Record<string, BindablePropertyKind>> =
    OBJECT_BINDABLE_PROPERTIES[object.type];
  return Object.hasOwn(properties, property) ? properties[property]! : null;
}

/**
 * Sets how one property gets its value. FIELD and EXPRESSION bindings are checked exactly like
 * canonical validation (the field exists and fits the property; the expression parses, type-checks
 * and produces a fitting type). The property's static value is left untouched, so switching back
 * to STATIC restores it.
 */
export function setPropertyBinding(
  document: DesignDocument,
  pageId: string,
  objectId: string,
  property: string,
  binding: PropertyBinding,
): DesignDocument {
  const page = findPage(document, pageId);
  const object = page.objects.find((candidate) => candidate.id === objectId);
  if (!object) throw new EditorCommandError(`Object "${objectId}" does not exist on this page`);
  const kind = bindablePropertyKind(object, property);
  if (!kind) {
    throw new EditorCommandError(
      `"${property}" of a ${object.type} object cannot be bound to data`,
    );
  }
  const [problem] = checkPropertyBinding(
    property,
    kind,
    binding,
    fieldLookup(document.dataSchema.fields),
  );
  if (problem) throw new EditorCommandError(problem.message);
  const current = (object.bindings as Readonly<Record<string, PropertyBinding>>)[property];
  if (current && canonicalizeJson(current) === canonicalizeJson(binding)) return document;
  return withObjects(
    document,
    pageId,
    [objectId],
    (target) =>
      ({
        ...target,
        bindings: { ...target.bindings, [property]: binding },
      }) as ArtworkObject,
  );
}

export function setMissingDataPolicy(
  document: DesignDocument,
  missingDataPolicy: MissingDataPolicy,
): DesignDocument {
  return document.settings.missingDataPolicy === missingDataPolicy
    ? document
    : { ...document, settings: { ...document.settings, missingDataPolicy } };
}
