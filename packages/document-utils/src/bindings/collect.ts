import {
  OBJECT_BINDABLE_PROPERTIES,
  type ArtworkObject,
  type ArtworkObjectType,
  type BindablePropertyKind,
  type DesignDocument,
  type PropertyBinding,
} from '@smarttag/document-schema';

export interface BoundProperty {
  readonly pageId: string;
  readonly objectId: string;
  readonly objectType: ArtworkObjectType;
  readonly property: string;
  readonly kind: BindablePropertyKind;
  readonly field: string;
}

/** Iterates every bindable property of an object together with its binding. */
export function forEachBinding(
  object: ArtworkObject,
  visit: (property: string, kind: BindablePropertyKind, binding: PropertyBinding) => void,
): void {
  const properties: Readonly<Record<string, BindablePropertyKind>> = OBJECT_BINDABLE_PROPERTIES[object.type];
  const bindings = object.bindings as Readonly<Record<string, PropertyBinding | undefined>>;
  for (const [property, kind] of Object.entries(properties)) {
    const binding = bindings[property];
    if (binding) {
      visit(property, kind, binding);
    }
  }
}

/** Lists every property in the document that is bound to a data field. */
export function collectBoundProperties(document: DesignDocument): BoundProperty[] {
  const result: BoundProperty[] = [];
  for (const page of document.pages) {
    for (const object of page.objects) {
      forEachBinding(object, (property, kind, binding) => {
        if (binding.mode === 'FIELD') {
          result.push({
            pageId: page.id,
            objectId: object.id,
            objectType: object.type,
            property,
            kind,
            field: binding.field,
          });
        }
      });
    }
  }
  return result;
}

/** Distinct data field keys referenced by bindings, in first-use order. */
export function listBoundFieldKeys(document: DesignDocument): string[] {
  return [...new Set(collectBoundProperties(document).map((bound) => bound.field))];
}
