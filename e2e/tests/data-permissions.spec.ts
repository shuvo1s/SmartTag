import { expect, test, type Browser } from '@playwright/test';
import { VARIABLE_DATA_RECORD } from '@smarttag/document-utils/fixtures';
import { E2E_WEB_URL } from '../environment.mjs';
import { createBlankTemplate, getVersion, openEditor, waitForEditor } from '../support/editor.ts';
import {
  canvasDataDisplay,
  createVariableDataDraft,
  enableDataPreview,
  openDataPanel,
  selectLayer,
  useTestRecord,
} from '../support/data.ts';
import { storageStatePath, type SeedUser } from '../support/users.ts';

const ORIGIN = { origin: E2E_WEB_URL };

async function contextFor(browser: Browser, user: SeedUser) {
  return browser.newContext({
    storageState: storageStatePath(user),
    baseURL: E2E_WEB_URL,
    viewport: { width: 1600, height: 1000 },
  });
}

test.describe('data schema and bindings — permissions and immutability', () => {
  for (const user of ['viewer', 'approver'] as const) {
    test(`${user === 'viewer' ? 'a viewer' : 'an approver without the designer role'} can inspect and preview data but not change schema or bindings`, async ({
      browser,
    }) => {
      const designer = await contextFor(browser, 'designer');
      const draft = await createVariableDataDraft(designer.request);
      const context = await contextFor(browser, user);
      const page = await context.newPage();
      await openEditor(page, draft);

      await openDataPanel(page);
      await expect(page.getByTestId('data-field-row-price')).toBeVisible();
      await expect(page.getByTestId('add-field')).toBeDisabled();
      await expect(page.getByTestId('edit-field-price')).toBeDisabled();
      await expect(page.getByTestId('delete-field-price')).toBeDisabled();
      await expect(page.getByTestId('missing-data-policy')).toBeDisabled();

      await selectLayer(page, 'vd-size');
      await expect(page.getByTestId('binding-mode-content-static')).toBeDisabled();
      await expect(page.getByTestId('binding-mode-content-field')).toBeDisabled();
      await expect(page.getByTestId('expression-input-content')).toBeDisabled();

      // Previewing test data is not a change and stays available.
      await useTestRecord(page, VARIABLE_DATA_RECORD);
      await enableDataPreview(page);
      await expect
        .poll(async () => (await canvasDataDisplay(page, 'vd-size'))?.object?.content)
        .toBe('SIZE: XL');

      const version = await getVersion(page.request, draft.versionId);
      const changed = JSON.parse(JSON.stringify(version.document)) as typeof version.document;
      changed.dataSchema.fields.pop();
      const refused = await page.request.patch(`/api/v1/template-versions/${draft.versionId}`, {
        headers: ORIGIN,
        data: { document: changed, expectedRevision: version.revision },
      });
      expect(refused.status()).toBe(403);
      await context.close();
      await designer.close();
    });
  }

  test('an approved version shows its schema, bindings and expressions read-only; the server refuses changes', async ({
    browser,
  }) => {
    const designer = await contextFor(browser, 'designer');
    const approver = await contextFor(browser, 'approver');
    const draft = await createVariableDataDraft(designer.request);
    for (const [context, targetStatus] of [
      [designer, 'IN_REVIEW'],
      [approver, 'APPROVED'],
    ] as const) {
      const response = await context.request.post(
        `/api/v1/template-versions/${draft.versionId}/transitions`,
        { headers: ORIGIN, data: { targetStatus } },
      );
      expect(response.status()).toBe(200);
    }

    const page = await designer.newPage();
    await openEditor(page, draft);
    await expect(page.getByTestId('read-only-banner')).toContainText('approved');
    await openDataPanel(page);
    await page.getByTestId('field-usage-size').click();
    await expect(page.getByTestId('field-usages-size')).toContainText('Front / Size / Content');
    await expect(page.getByTestId('add-field')).toBeDisabled();
    await selectLayer(page, 'vd-sku');
    await expect(page.getByTestId('expression-input-content')).toHaveValue(
      'upper(concat(style, "-", color, "-", size))',
    );
    await expect(page.getByTestId('expression-input-content')).toBeDisabled();

    const version = await getVersion(designer.request, draft.versionId);
    const changed = JSON.parse(JSON.stringify(version.document)) as typeof version.document;
    changed.dataSchema.fields[0]!.displayName = 'Changed after approval';
    const refused = await designer.request.patch(`/api/v1/template-versions/${draft.versionId}`, {
      headers: ORIGIN,
      data: { document: changed, expectedRevision: version.revision },
    });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'VERSION_IMMUTABLE',
    );
    expect((await getVersion(designer.request, draft.versionId)).documentHash).toBe(
      version.documentHash,
    );
    await approver.close();
    await designer.close();
  });
});

test.describe('regression — designer entry points with Phase 3', () => {
  test.use({ storageState: storageStatePath('designer') });

  test('a blank template opens with an empty Data panel and accepts its first field', async ({
    page,
  }) => {
    const draft = await createBlankTemplate(page.request, { pageLayout: 'FRONT_ONLY' });
    await openEditor(page, draft);
    await openDataPanel(page);
    await expect(page.getByTestId('data-panel')).toContainText('no data fields yet');
    await page.getByTestId('add-field').click();
    await page.getByTestId('field-display-name').fill('Size');
    await page.getByTestId('field-save').click();
    await expect(page.getByTestId('data-field-row-size')).toBeVisible();
  });

  test('the seeded HT-DEMO-50X90 schema v2 draft opens migrated, with its data fields', async ({
    page,
  }) => {
    await page.goto('/templates');
    await page.getByRole('searchbox', { name: 'Search templates' }).fill('HT-DEMO-50X90');
    await page
      .getByRole('link', { name: /Demo Active hang tag/i })
      .first()
      .click();
    await page.getByRole('link', { name: 'Edit in designer' }).first().click();
    await waitForEditor(page);
    await expect(page.getByTestId('schema-upgrade-banner')).toContainText(
      'stored with schema version 2',
    );
    await openDataPanel(page);
    await expect(page.getByTestId('data-field-row-product_name')).toBeVisible();
    await expect(page.getByTestId('field-usage-gtin')).toHaveText('Used by 1');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'SAVED');
  });
});
