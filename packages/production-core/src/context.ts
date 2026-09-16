import type { NormalizedValue } from '@smarttag/data-core';
import { SYSTEM_FIELD_KEYS, type DesignDocument } from '@smarttag/document-schema';
import { bindingFieldKeys, forEachBinding } from '@smarttag/document-utils';

/**
 * Everything one production instance knows about itself. These values never come from the
 * dataset — the dataset stays exactly as it was imported — and they are not part of any data
 * schema, so adding them changes no template and no dataset hash.
 */
export interface ProductionContext {
  /** Formatted serial number, or null when the job does not use serial numbers. */
  readonly serial: string | null;
  /** 1-based position in the job. */
  readonly instanceIndex: number;
  /** 1-based copy number within the dataset record. */
  readonly copyIndex: number;
  /** Row number of the record in the imported source file. */
  readonly sourceRow: number;
  readonly jobNumber: string;
}

/**
 * The production context as system field values. A serial number that has not been allocated yet
 * is simply absent: resolution then marks the properties that use it as supplied at production
 * time instead of reporting missing data.
 */
export function systemValuesFor(
  context: ProductionContext,
): Readonly<Record<string, NormalizedValue>> {
  const values: Record<string, NormalizedValue> = {
    [SYSTEM_FIELD_KEYS.INSTANCE_INDEX]: context.instanceIndex,
    [SYSTEM_FIELD_KEYS.COPY_INDEX]: context.copyIndex,
    [SYSTEM_FIELD_KEYS.SOURCE_ROW]: context.sourceRow,
    [SYSTEM_FIELD_KEYS.JOB_NUMBER]: context.jobNumber,
  };
  if (context.serial !== null) values[SYSTEM_FIELD_KEYS.SERIAL] = context.serial;
  return values;
}

/** The context in the shape that goes into the instance hash (documented canonicalization). */
export function contextHashPayload(context: ProductionContext): Record<string, unknown> {
  return {
    copyIndex: context.copyIndex,
    instanceIndex: context.instanceIndex,
    jobNumber: context.jobNumber,
    serial: context.serial,
    sourceRow: context.sourceRow,
  };
}

/** System fields a document's bindings and expressions use (in schema order). */
export function documentSystemFields(document: DesignDocument): readonly string[] {
  const used = new Set<string>();
  const system = new Set<string>(Object.values(SYSTEM_FIELD_KEYS));
  for (const page of document.pages) {
    for (const object of page.objects) {
      forEachBinding(object, (_property, _kind, binding) => {
        if (binding.mode === 'STATIC') return;
        for (const key of bindingFieldKeys(binding)) {
          if (system.has(key)) used.add(key);
        }
      });
    }
  }
  return Object.values(SYSTEM_FIELD_KEYS).filter((key) => used.has(key));
}

/**
 * True when the artwork depends on values that differ between the copies of one record (the
 * serial number, the position in the job). When it does not, every copy of a record resolves
 * identically, which lets expansion resolve once per record instead of once per tag.
 */
export function dependsOnInstanceContext(document: DesignDocument): boolean {
  const perInstance: readonly string[] = [
    SYSTEM_FIELD_KEYS.SERIAL,
    SYSTEM_FIELD_KEYS.INSTANCE_INDEX,
    SYSTEM_FIELD_KEYS.COPY_INDEX,
  ];
  return documentSystemFields(document).some((key) => perInstance.includes(key));
}
