import {
  mappingEntry,
  type DataImportStatus,
  type MappingDefinition,
  type MappingSuggestion,
  type SourceColumn,
} from '@smarttag/import-core';
import type { DataImportDto } from '@smarttag/shared-types';

export const WIZARD_STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'source', label: 'Source' },
  { id: 'map', label: 'Map fields' },
  { id: 'configure', label: 'Configure' },
  { id: 'validate', label: 'Validate' },
  { id: 'review', label: 'Review' },
  { id: 'save', label: 'Save dataset' },
] as const;
export type WizardStepId = (typeof WIZARD_STEPS)[number]['id'];

export function isWizardStep(value: string | null): value is WizardStepId {
  return WIZARD_STEPS.some((step) => step.id === value);
}

/** The step an import naturally belongs to, from its server state. */
export function defaultStep(
  dto: Pick<DataImportDto, 'status' | 'sourceProblems' | 'columns' | 'failure'>,
): WizardStepId {
  switch (dto.status) {
    case 'UPLOADED':
    case 'INSPECTING':
      return 'source';
    case 'MAPPING_REQUIRED':
      return dto.sourceProblems.length > 0 || dto.columns.length === 0 ? 'source' : 'map';
    case 'READY_TO_VALIDATE':
    case 'VALIDATING':
      return 'validate';
    case 'READY':
    case 'READY_WITH_WARNINGS':
    case 'HAS_ERRORS':
    case 'FINALIZED':
      return 'review';
    case 'FAILED':
      return dto.failure?.stage === 'VALIDATION' ? 'validate' : 'source';
    case 'CANCELLED':
      return 'source';
  }
}

/** Steps the user may open, given the server state. */
export function availableSteps(
  dto: Pick<DataImportDto, 'status' | 'sourceProblems' | 'columns' | 'mappingValidation'>,
): Set<WizardStepId> {
  const steps = new Set<WizardStepId>(['upload', 'source']);
  const status: DataImportStatus = dto.status;
  const inspected = dto.columns.length > 0 && dto.sourceProblems.length === 0;
  if (inspected && status !== 'INSPECTING' && status !== 'UPLOADED') {
    steps.add('map');
    steps.add('configure');
  }
  if (dto.mappingValidation?.complete && status !== 'MAPPING_REQUIRED') steps.add('validate');
  if (['READY', 'READY_WITH_WARNINGS', 'HAS_ERRORS', 'FINALIZED'].includes(status)) {
    steps.add('validate');
    steps.add('review');
    steps.add('save');
  }
  return steps;
}

/** Index of the furthest step the import has completed (for the stepper's check marks). */
export function completedThrough(status: DataImportStatus): number {
  switch (status) {
    case 'UPLOADED':
    case 'INSPECTING':
    case 'FAILED':
    case 'CANCELLED':
      return 0;
    case 'MAPPING_REQUIRED':
      return 1;
    case 'READY_TO_VALIDATE':
    case 'VALIDATING':
      return 3;
    case 'READY':
    case 'READY_WITH_WARNINGS':
    case 'HAS_ERRORS':
      return 5;
    case 'FINALIZED':
      return 6;
  }
}

/** The column a draft mapping assigns to a field, if any. */
export function columnForField(mapping: MappingDefinition, field: string): number | null {
  return mapping.entries.find((entry) => entry.field === field)?.column.index ?? null;
}

/** Fields fed by a column (a column may feed several fields). */
export function fieldsForColumn(mapping: MappingDefinition, columnIndex: number): string[] {
  return mapping.entries
    .filter((entry) => entry.column.index === columnIndex)
    .map((entry) => entry.field);
}

/**
 * Assigns a column to a field (null removes the field's mapping). A field takes values from one
 * column only, so an earlier column for the same field is replaced, never kept alongside.
 */
export function assignField(
  mapping: MappingDefinition,
  field: string,
  column: Pick<SourceColumn, 'index' | 'header'> | null,
): MappingDefinition {
  const existing = mapping.entries.find((entry) => entry.field === field);
  const others = mapping.entries.filter((entry) => entry.field !== field);
  if (!column) return { ...mapping, entries: others };
  const entry = existing
    ? { ...existing, column: { index: column.index, header: column.header } }
    : mappingEntry(field, column);
  return { ...mapping, entries: [...others, entry] };
}

/** Maps a column to exactly the given field (or ignores it when null). */
export function assignColumn(
  mapping: MappingDefinition,
  column: Pick<SourceColumn, 'index' | 'header'>,
  field: string | null,
): MappingDefinition {
  const withoutColumn: MappingDefinition = {
    ...mapping,
    entries: mapping.entries.filter((entry) => entry.column.index !== column.index),
  };
  return field ? assignField(withoutColumn, field, column) : withoutColumn;
}

/** Applies suggestions to fields that are not mapped yet (exact ones only unless told otherwise). */
export function applySuggestions(
  mapping: MappingDefinition,
  suggestions: readonly MappingSuggestion[],
  { exactOnly }: { exactOnly: boolean },
): MappingDefinition {
  let next = mapping;
  for (const suggestion of suggestions) {
    if (exactOnly && !suggestion.exact) continue;
    if (columnForField(next, suggestion.field) !== null) continue;
    next = assignField(next, suggestion.field, suggestion.column);
  }
  return next;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function progressPercent(processed: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.floor((processed / total) * 100));
}
