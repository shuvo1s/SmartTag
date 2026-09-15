import { expect, test } from '@playwright/test';
import {
  createLargeVariableDataDocument,
  createLargeVariableDataRecord,
} from '@smarttag/document-utils/fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDraft, openEditor } from '../support/editor.ts';
import {
  canvasDataDisplay,
  enableDataPreview,
  openDataPanel,
  setTestValue,
  summaryCount,
  useTestRecord,
} from '../support/data.ts';
import { storageStatePath } from '../support/users.ts';

test.use({ storageState: storageStatePath('designer') });

test('stays interactive with 120 objects, 40 fields, 60 bindings and 20 expressions', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const draft = await createDraft(page.request, (templateId) =>
    createLargeVariableDataDocument({ documentId: templateId }),
  );

  const navigationStart = Date.now();
  await openEditor(page, draft);
  await expect(page.getByTestId('layers-panel').getByRole('option')).toHaveCount(120);
  const editorOpenMs = Date.now() - navigationStart;

  const recordStart = Date.now();
  await useTestRecord(page, createLargeVariableDataRecord());
  await expect(summaryCount(page, 'checked')).toHaveText('40');
  await expect(summaryCount(page, 'errors')).toHaveText('0');
  const firstValidationMs = Date.now() - recordStart;

  const enableStart = Date.now();
  await enableDataPreview(page);
  await expect
    .poll(async () => (await canvasDataDisplay(page, 'perf-41'))?.object?.content)
    .toBe('VALUE 1-VALUE 2');
  const firstPreviewMs = Date.now() - enableStart;

  // Change one test value repeatedly and measure until the canvas shows it.
  await openDataPanel(page, 'test');
  const updates: number[] = [];
  for (let run = 1; run <= 10; run += 1) {
    const start = Date.now();
    await setTestValue(page, 'field_1', `Typed ${run}`);
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'perf-1'))?.object?.content, {
        intervals: [10, 20, 50],
      })
      .toBe(`Typed ${run}`);
    updates.push(Date.now() - start);
  }
  updates.sort((a, b) => a - b);

  const inBrowser = await page.evaluate(() => {
    const editor = (
      window as unknown as {
        __smarttagEditor: {
          canvas: { renderAllTimed(): number };
        };
      }
    ).__smarttagEditor;
    const median = (name: string) => {
      const durations = performance
        .getEntriesByName(name)
        .map((entry) => entry.duration)
        .sort((a, b) => a - b);
      return durations[Math.floor(durations.length / 2)] ?? -1;
    };
    return {
      // Record validation + binding resolution + object and layout checks (data-core pipeline).
      previewPipelineMedianMs: median('st-data-preview-compute'),
      // Pushing the resolved preview to Fabric and redrawing the canvas.
      canvasRefreshMedianMs: median('st-data-preview-canvas'),
      fullCanvasRenderMs: editor.canvas.renderAllTimed(),
    };
  });
  const report = {
    scenario: { objects: 120, fields: 40, boundProperties: 60, expressions: 20 },
    browser: 'Chromium (Playwright, headless)',
    editorOpenMs,
    firstValidationMs,
    firstPreviewMs,
    changeOneFieldMedianMs: updates[Math.floor(updates.length / 2)],
    changeOneFieldMaxMs: updates.at(-1),
    ...inBrowser,
    note: 'changeOneField timings include Playwright input and polling overhead (10–50 ms intervals).',
  };
  const directory = resolve(import.meta.dirname, '..', 'test-results');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, 'data-performance.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  expect(editorOpenMs).toBeLessThan(15_000);
  expect(report.changeOneFieldMedianMs).toBeLessThan(1_000);
  expect(inBrowser.previewPipelineMedianMs).toBeLessThan(50);
  expect(inBrowser.canvasRefreshMedianMs).toBeLessThan(250);
});
