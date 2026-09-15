import {
  OBJECT_BINDABLE_PROPERTIES,
  type ArtworkObject,
  type ArtworkObjectType,
  type BindablePropertyKind,
  type DesignDocument,
  type PropertyBinding,
} from '@smarttag/document-schema';
import { expressionDependencies, parseExpression } from '@smarttag/expression-core';

export interface BoundProperty {
  readonly pageId: string;
  readonly objectId: string;
  readonly objectType: ArtworkObjectType;
  readonly property: string;
  readonly kind: BindablePropertyKind;
  readonly mode: 'FIELD' | 'EXPRESSION';
  /** The bound field key for FIELD bindings; null for expressions. */
  readonly field: string | null;
  /** Expression source for EXPRESSION bindings; null for field bindings. */
  readonly expression: string | null;
  /**
   * Every field key the property reads: the bound field, or the fields the expression references
   * (empty when the expression does not parse).
   */
  readonly fields: readonly string[];
}

/** Iterates every bindable property of an object together with its binding. */
export function forEachBinding(
  object: ArtworkObject,
  visit: (property: string, kind: BindablePropertyKind, binding: PropertyBinding) => void,
): void {
  const properties: Readonly<Record<string, BindablePropertyKind>> =
    OBJECT_BINDABLE_PROPERTIES[object.type];
  const bindings = object.bindings as Readonly<Record<string, PropertyBinding | undefined>>;
  for (const [property, kind] of Object.entries(properties)) {
    const binding = bindings[property];
    if (binding) {
      visit(property, kind, binding);
    }
  }
}

const dependencyCache = new Map<string, readonly string[]>();
const DEPENDENCY_CACHE_LIMIT = 1_000;

/** Field keys an expression references (cached by source; [] when it does not parse). */
export function fieldsReferencedByExpression(expression: string): readonly string[] {
  const cached = dependencyCache.get(expression);
  if (cached) return cached;
  const parsed = parseExpression(expression);
  const fields = Object.freeze(parsed.ok ? expressionDependencies(parsed.ast) : []);
  if (dependencyCache.size >= DEPENDENCY_CACHE_LIMIT) dependencyCache.clear();
  dependencyCache.set(expression, fields);
  return fields;
}

/** The field keys a single binding reads. */
export function bindingFieldKeys(binding: PropertyBinding): readonly string[] {
  switch (binding.mode) {
    case 'STATIC':
      return [];
    case 'FIELD':
      return [binding.field];
    case 'EXPRESSION':
      return fieldsReferencedByExpression(binding.expression);
  }
}

/** Lists every property in the document that is bound to data (field or expression). */
export function collectBoundProperties(document: DesignDocument): BoundProperty[] {
  const result: BoundProperty[] = [];
  for (const page of document.pages) {
    for (const object of page.objects) {
      forEachBinding(object, (property, kind, binding) => {
        if (binding.mode === 'STATIC') return;
        result.push({
          pageId: page.id,
          objectId: object.id,
          objectType: object.type,
          property,
          kind,
          mode: binding.mode,
          field: binding.mode === 'FIELD' ? binding.field : null,
          expression: binding.mode === 'EXPRESSION' ? binding.expression : null,
          fields: bindingFieldKeys(binding),
        });
      });
    }
  }
  return result;
}

/** Distinct data field keys referenced by bindings and expressions, in first-use order. */
export function listBoundFieldKeys(document: DesignDocument): string[] {
  return [...new Set(collectBoundProperties(document).flatMap((bound) => bound.fields))];
}

/** Whether an object has at least one property driven by data. */
export function isObjectDataBound(object: ArtworkObject): boolean {
  let bound = false;
  forEachBinding(object, (_property, _kind, binding) => {
    if (binding.mode !== 'STATIC') bound = true;
  });
  return bound;
}
