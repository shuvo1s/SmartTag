import { validateDesignDocument } from '@smarttag/document-schema';
import { collectBoundProperties } from '@smarttag/document-utils';
import {
  createLargeVariableDataDocument,
  createLargeVariableDataRecord,
} from '@smarttag/document-utils/fixtures';
import { createApproximateTextMeasurer, createTextLayoutEngine } from '@smarttag/rendering-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDataPreview,
  checkResolvedLayout,
  checkResolvedObjects,
  resolveDocumentBindings,
  validateDataRecord,
} from '../src';

/** Median of `runs` timings of `work` in milliseconds. */
function measure(work: () => void, runs = 25): number {
  const timings: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    work();
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  return timings[Math.floor(timings.length / 2)]!;
}

describe('performance: 120 objects, 40 fields, 60 bound properties, 20 expressions', () => {
  it('validates, resolves and checks one record interactively (full recomputation)', () => {
    const document = createLargeVariableDataDocument();
    const record = createLargeVariableDataRecord();
    const bound = collectBoundProperties(document);
    expect(document.pages[0]!.objects).toHaveLength(120);
    expect(document.dataSchema.fields).toHaveLength(40);
    expect(bound).toHaveLength(60);
    expect(bound.filter((property) => property.mode === 'EXPRESSION')).toHaveLength(20);

    const documentValidationMs = measure(() => {
      expect(validateDesignDocument(document).valid).toBe(true);
    }, 10);
    const layout = createTextLayoutEngine({ measurer: createApproximateTextMeasurer() });

    const recordValidationMs = measure(() => {
      validateDataRecord(document.dataSchema, record);
    });
    const validation = validateDataRecord(document.dataSchema, record);
    expect(validation.valid).toBe(true);

    const resolutionMs = measure(() => {
      resolveDocumentBindings(document, validation);
    });
    let counter = 0;
    // Changing one field value each run: the realistic "user types in Test Data" case.
    const changedFieldMs = measure(() => {
      counter += 1;
      buildDataPreview(
        document,
        { ...record, field_1: `Typed ${counter}` },
        { textLayout: layout },
      );
    });
    const resolution = resolveDocumentBindings(document, validation);
    const expressionEvaluationMs = measure(() => {
      resolveDocumentBindings(
        {
          ...document,
          pages: [{ ...document.pages[0]!, objects: document.pages[0]!.objects.slice(40, 60) }],
        },
        validation,
      );
    });
    const objectChecksMs = measure(() => checkResolvedObjects(resolution));
    const layoutChecksMs = measure(() => checkResolvedLayout(resolution, layout));
    const fullPreviewMs = measure(() => {
      buildDataPreview(document, record, { textLayout: layout });
    });

    const report = {
      scenario: { objects: 120, fields: 40, boundProperties: 60, expressions: 20 },
      environment: `node ${process.version} (approximate text measurer)`,
      documentValidationMs,
      recordValidationMs,
      resolutionMs,
      expressionEvaluationMs,
      objectChecksMs,
      layoutChecksMs,
      fullPreviewMs,
      changedFieldPreviewMs: changedFieldMs,
    };
    const directory = resolve(__dirname, '..', 'test-results');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      resolve(directory, 'data-performance.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );

    // Generous bounds for slow CI machines; typical values are far below (see the report file).
    expect(recordValidationMs).toBeLessThan(20);
    expect(resolutionMs).toBeLessThan(30);
    expect(changedFieldMs).toBeLessThan(60);
  });
});
