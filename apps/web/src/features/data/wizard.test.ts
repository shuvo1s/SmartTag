import { emptyMapping, mappingEntry, type MappingSuggestion } from '@smarttag/import-core';
import type { DataImportDto } from '@smarttag/shared-types';
import { describe, expect, it } from 'vitest';
import {
  applySuggestions,
  assignColumn,
  assignField,
  availableSteps,
  columnForField,
  completedThrough,
  defaultStep,
  fieldsForColumn,
  progressPercent,
} from './wizard';

const column = (index: number, header: string) => ({ index, header });

function dto(overrides: Partial<DataImportDto>): DataImportDto {
  return {
    status: 'MAPPING_REQUIRED',
    sourceProblems: [],
    columns: [
      { index: 0, letter: 'A', header: 'STYLE', occurrence: 1, duplicate: false, samples: [] },
    ],
    failure: null,
    mappingValidation: null,
    ...overrides,
  } as DataImportDto;
}

describe('import wizard steps', () => {
  it('opens the step that matches the server state', () => {
    expect(defaultStep(dto({ status: 'INSPECTING' }))).toBe('source');
    expect(defaultStep(dto({ status: 'MAPPING_REQUIRED' }))).toBe('map');
    expect(
      defaultStep(
        dto({
          status: 'MAPPING_REQUIRED',
          sourceProblems: [{ code: 'SHEET_REQUIRED', message: 'x' }],
        }),
      ),
    ).toBe('source');
    expect(defaultStep(dto({ status: 'READY_TO_VALIDATE' }))).toBe('validate');
    expect(defaultStep(dto({ status: 'VALIDATING' }))).toBe('validate');
    expect(defaultStep(dto({ status: 'HAS_ERRORS' }))).toBe('review');
    expect(
      defaultStep(
        dto({
          status: 'FAILED',
          failure: { code: 'X', message: 'x', stage: 'VALIDATION', retryable: true },
        }),
      ),
    ).toBe('validate');
  });

  it('only offers steps whose prerequisites exist', () => {
    expect([...availableSteps(dto({ status: 'INSPECTING', columns: [] }))]).toEqual([
      'upload',
      'source',
    ]);
    expect([...availableSteps(dto({ status: 'MAPPING_REQUIRED' }))]).toEqual([
      'upload',
      'source',
      'map',
      'configure',
    ]);
    const complete = { complete: true } as DataImportDto['mappingValidation'];
    expect(
      availableSteps(dto({ status: 'READY_TO_VALIDATE', mappingValidation: complete })).has(
        'validate',
      ),
    ).toBe(true);
    expect(
      availableSteps(dto({ status: 'READY_WITH_WARNINGS', mappingValidation: complete })).has(
        'save',
      ),
    ).toBe(true);
    expect(completedThrough('FINALIZED')).toBe(6);
  });
});

describe('mapping draft editing', () => {
  const base = { ...emptyMapping(), entries: [mappingEntry('style', column(0, 'STYLE'))] };

  it('a field takes values from one column only', () => {
    const moved = assignField(base, 'style', column(2, 'STYLE_NO'));
    expect(moved.entries).toHaveLength(1);
    expect(columnForField(moved, 'style')).toBe(2);
    expect(assignField(moved, 'style', null).entries).toEqual([]);
  });

  it('assigning a column replaces what that column fed; one column can feed several fields', () => {
    const shared = assignField(base, 'style_code', column(0, 'STYLE'));
    expect(fieldsForColumn(shared, 0).sort()).toEqual(['style', 'style_code']);
    const reassigned = assignColumn(shared, column(0, 'STYLE'), 'size');
    expect(fieldsForColumn(reassigned, 0)).toEqual(['size']);
    expect(assignColumn(reassigned, column(0, 'STYLE'), null).entries).toEqual([]);
  });

  it('applies exact suggestions unless asked for all, never over an existing mapping', () => {
    const suggestions: MappingSuggestion[] = [
      { field: 'color', column: column(1, 'color'), match: 'EXACT_KEY', exact: true },
      {
        field: 'product_name',
        column: column(2, 'PRODUCT NAME'),
        match: 'NORMALIZED_KEY',
        exact: false,
      },
      { field: 'style', column: column(3, 'Style'), match: 'CASE_INSENSITIVE_KEY', exact: false },
    ];
    expect(
      applySuggestions(base, suggestions, { exactOnly: true }).entries.map((entry) => entry.field),
    ).toEqual(['style', 'color']);
    const all = applySuggestions(base, suggestions, { exactOnly: false });
    expect(all.entries.map((entry) => entry.field)).toEqual(['style', 'color', 'product_name']);
    expect(columnForField(all, 'style')).toBe(0);
  });

  it('reports progress without dividing by zero', () => {
    expect(progressPercent(38_420, 75_000)).toBe(51);
    expect(progressPercent(10, null)).toBeNull();
    expect(progressPercent(10, 0)).toBeNull();
    expect(progressPercent(100, 50)).toBe(100);
  });
});
