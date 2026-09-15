import type {
  ArtworkObjectType,
  BindablePropertyKind,
  DesignDocument,
} from '@smarttag/document-schema';
import { bindingFieldKeys, forEachBinding } from '@smarttag/document-utils';
import { describeBindableProperty } from './issues';

/** One artwork property that reads a data field. */
export interface FieldUsage {
  readonly pageId: string;
  readonly pageName: string;
  readonly objectId: string;
  readonly objectName: string;
  readonly objectType: ArtworkObjectType;
  readonly property: string;
  readonly kind: BindablePropertyKind;
  readonly mode: 'FIELD' | 'EXPRESSION';
  /** "Front / Product Name / Content" */
  readonly label: string;
}

/**
 * Where each data field is used: every field or expression binding that reads it. Keys without
 * usages are present with an empty list (keys referenced but not defined are included too, so
 * dangling references are visible).
 */
export function collectFieldUsages(
  document: DesignDocument,
): ReadonlyMap<string, readonly FieldUsage[]> {
  const usages = new Map<string, FieldUsage[]>();
  for (const field of document.dataSchema.fields) usages.set(field.key, []);
  for (const page of document.pages) {
    for (const object of page.objects) {
      forEachBinding(object, (property, kind, binding) => {
        if (binding.mode === 'STATIC') return;
        for (const key of bindingFieldKeys(binding)) {
          const list = usages.get(key) ?? [];
          list.push({
            pageId: page.id,
            pageName: page.name,
            objectId: object.id,
            objectName: object.name,
            objectType: object.type,
            property,
            kind,
            mode: binding.mode,
            label: `${page.name} / ${object.name || object.id} / ${describeBindableProperty(property)}`,
          });
          usages.set(key, list);
        }
      });
    }
  }
  return usages;
}
