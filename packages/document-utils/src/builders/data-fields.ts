import {
  emptyValidationFor,
  type DataField,
  type DataFieldOfType,
  type DataFieldType,
} from '@smarttag/document-schema';

export type DataFieldInit<T extends DataFieldType> = Pick<DataFieldOfType<T>, 'key' | 'type'> &
  Partial<Omit<DataFieldOfType<T>, 'key' | 'type'>>;

/**
 * Creates a complete, canonical data field with explicit defaults: optional, no default value,
 * no description and no validation rules. The display name defaults to a readable form of the key.
 */
export function createDataField<T extends DataFieldType>(
  init: DataFieldInit<T>,
): DataFieldOfType<T> {
  const field = {
    key: init.key,
    displayName: init.displayName ?? displayNameFromKey(init.key),
    type: init.type,
    required: init.required ?? false,
    defaultValue: init.defaultValue ?? null,
    description: init.description ?? '',
    validation: init.validation ?? emptyValidationFor(init.type),
  };
  return field as DataField as DataFieldOfType<T>;
}

/** "country_of_origin" → "Country of origin". */
export function displayNameFromKey(key: string): string {
  const words = key.split('_').filter(Boolean).join(' ');
  return words.length === 0 ? key : words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Suggests a stable field key from a display name: "Retail Price (€)" → "retail_price".
 * Returns "" when nothing usable remains; callers must still validate the key.
 */
export function suggestFieldKey(displayName: string): string {
  const key = displayName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 64)
    .replace(/_+$/, '');
  return key;
}
