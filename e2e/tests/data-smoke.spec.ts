import { expect, test } from '@playwright/test';
import { VARIABLE_DATA_RECORD } from '@smarttag/document-utils/fixtures';
import { E2E_PASSWORD, E2E_WEB_URL } from '../environment.mjs';
import { getVersion, waitForEditor } from '../support/editor.ts';
import {
  canvasDataDisplay,
  createVariableDataDraft,
  enableDataPreview,
  openDataPanel,
  setTestValue,
  useTestRecord,
} from '../support/data.ts';
import { USERS } from '../support/users.ts';

/**
 * Cross-browser smoke test (Chromium, Firefox, WebKit): the Phase 3 path through the product with
 * a real login, the designer, the Data panel, test data, the live preview and a saved draft.
 */
test('login, open the designer, preview test data and save the draft', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByLabel('Email').fill(USERS.designer);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/(dashboard|templates)/);

  const draft = await createVariableDataDraft(page.request);
  await page.addInitScript(() => window.localStorage.setItem('smarttag:editor-diagnostics', '1'));
  await page.goto(`${E2E_WEB_URL}/templates/${draft.template.id}/versions/${draft.versionId}/edit`);
  await waitForEditor(page);

  await openDataPanel(page);
  await expect(page.getByTestId('data-field-row-product_name')).toBeVisible();

  await useTestRecord(page, VARIABLE_DATA_RECORD);
  await enableDataPreview(page);
  await expect
    .poll(async () => (await canvasDataDisplay(page, 'vd-product-name'))?.object?.content)
    .toBe('Premium Cotton Shirt');

  await setTestValue(page, 'product_name', 'Linen Overshirt');
  await expect
    .poll(async () => (await canvasDataDisplay(page, 'vd-product-name'))?.object?.content)
    .toBe('Linen Overshirt');

  // A schema change is saved; the test data is not.
  await openDataPanel(page, 'fields');
  await page.getByTestId('add-field').click();
  await page.getByTestId('field-display-name').fill('Care Note');
  await page.getByTestId('field-save').click();
  await expect(page.getByTestId('data-field-row-care_note')).toBeVisible();
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'SAVED');

  const saved = await getVersion(page.request, draft.versionId);
  expect(saved.document.dataSchema.fields.map((field) => field.key)).toContain('care_note');
  expect(JSON.stringify(saved.document)).not.toContain('Linen Overshirt');
});
