import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { DesignDocument } from '@smarttag/document-schema';
import { createVariableDataHangTagDocument } from '@smarttag/document-utils/fixtures';
import { createDraft, type Draft } from './editor.ts';

/** A draft holding the Phase 3 variable-data hang tag (fields, rules, bindings, expressions). */
export function createVariableDataDraft(
  request: APIRequestContext,
  customize: (document: DesignDocument) => DesignDocument = (document) => document,
): Promise<Draft> {
  return createDraft(request, (templateId) =>
    customize(createVariableDataHangTagDocument({ documentId: templateId })),
  );
}

export async function openDataPanel(page: Page, tab: 'fields' | 'test' = 'fields') {
  await page.getByTestId('panel-data').click();
  await expect(page.getByTestId('data-panel')).toBeVisible();
  await page.getByTestId(`data-tab-${tab}`).click();
}

/** Sets one test value with the control of its type. */
export async function setTestValue(page: Page, key: string, value: string) {
  const input = page.getByTestId(`test-input-${key}`);
  const tag = await input.evaluate((element) => element.tagName);
  if (tag === 'SELECT') await input.selectOption(value);
  else await input.fill(value);
}

/** Replaces the whole test record through the JSON editor. */
export async function useTestRecord(page: Page, record: Record<string, unknown>) {
  await openDataPanel(page, 'test');
  const toggle = page.getByTestId('test-data-json-toggle');
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await page.getByTestId('test-data-json').fill(JSON.stringify(record, null, 2));
  await page.getByTestId('apply-test-json').click();
}

export async function enableDataPreview(page: Page) {
  await page.getByTestId('preview-mode-data').click();
  await expect(page.getByTestId('data-preview-banner')).toBeVisible();
}

/** The editor's in-memory canonical document (diagnostics enabled by openEditor). */
export async function editorDocument(page: Page): Promise<DesignDocument> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __smarttagEditor: { store: { getState(): { document: unknown } } };
        }
      ).__smarttagEditor.store.getState().document as never,
  );
}

/** What the canvas draws for an object in Data preview. */
export async function canvasDataDisplay(page: Page, objectId: string) {
  return page.evaluate((id) => {
    const editor = (
      window as unknown as {
        __smarttagEditor: {
          canvas: {
            getFabricObject(id: string):
              | {
                  dataDisplay: {
                    object: Record<string, unknown> | null;
                    hidden: boolean;
                    issue: string | null;
                  };
                  lastIssues: string[];
                }
              | undefined;
          };
        };
      }
    ).__smarttagEditor;
    const object = editor.canvas.getFabricObject(id);
    return object ? { ...object.dataDisplay, lastIssues: [...object.lastIssues] } : null;
  }, objectId);
}

export function summaryCount(
  page: Page,
  kind: 'checked' | 'valid' | 'warnings' | 'errors',
): Locator {
  return page.getByTestId(`summary-${kind}`);
}

export async function selectLayer(page: Page, objectId: string) {
  await page.getByTestId('panel-layers').click();
  await page.getByTestId(`layer-row-${objectId}`).click();
}

/** Chooses a field in the field picker of a property. */
export async function pickField(page: Page, property: string, key: string) {
  await page.getByTestId(`field-picker-${property}-button`).click();
  await page.getByTestId('field-picker-search').fill(key);
  await page.getByTestId(`field-option-${key}`).click();
}

/** Types an expression for a property and applies it. */
export async function applyExpression(page: Page, property: string, expression: string) {
  await page.getByTestId(`expression-input-${property}`).fill(expression);
  await page.getByTestId(`expression-apply-${property}`).click();
}
