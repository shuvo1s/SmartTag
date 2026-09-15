import { expect, test, type Browser, type Page } from '@playwright/test';
import { mmToPt } from '@smarttag/document-utils';
import { E2E_WEB_URL } from '../environment.mjs';
import {
  createBlankTemplate,
  createDraft,
  getVersion,
  save,
  waitForEditor,
} from '../support/editor.ts';
import { storageStatePath, type SeedUser } from '../support/users.ts';

const ORIGIN = { origin: E2E_WEB_URL };
const DESIGNER_URL = /\/templates\/([0-9a-f-]{36})\/versions\/([0-9a-f-]{36})\/edit$/;

async function contextFor(browser: Browser, user: SeedUser) {
  return browser.newContext({
    storageState: storageStatePath(user),
    baseURL: E2E_WEB_URL,
    viewport: { width: 1600, height: 1000 },
  });
}

function versionRow(page: Page, versionNumber: number) {
  return page.getByTestId(`version-row-${versionNumber}`);
}

test.describe('new template → designer workflow', () => {
  test('a designer creates a blank template in the UI and lands in its empty draft in the designer', async ({
    browser,
  }) => {
    const context = await contextFor(browser, 'designer');
    const page = await context.newPage();
    const code = `E2E-UI-${Date.now().toString(36).toUpperCase()}`;

    await page.goto('/templates');
    await page.getByRole('link', { name: 'New template' }).click();
    await page.getByLabel('Template name').fill(`UI blank ${code}`);
    await page.getByLabel('Template code').fill(code);
    await page.getByLabel('Trim width (mm)').fill('60');
    await page.getByLabel('Trim height (mm)').fill('100');
    await page.getByLabel('Bleed (mm)').fill('2');
    await page.getByLabel('Safe margin (mm)').fill('4');
    await page.getByLabel('Front + back').check();
    await page.getByRole('button', { name: 'Create template' }).click();

    // Straight into the designer for the new v1 draft — no URL typing.
    await expect(page).toHaveURL(DESIGNER_URL);
    await waitForEditor(page);
    const [, templateId, versionId] = DESIGNER_URL.exec(new URL(page.url()).pathname)!;

    const created = await getVersion(context.request, versionId!);
    expect(created).toMatchObject({ templateId, versionNumber: 1, status: 'DRAFT', revision: 1 });
    expect(created.document.schemaVersion).toBe(2);
    expect(created.document.pages.map((p) => [p.side, p.objects.length])).toEqual([
      ['FRONT', 0],
      ['BACK', 0],
    ]);
    expect(created.document.dimensions).toMatchObject({
      width: mmToPt(60),
      height: mmToPt(100),
      bleed: { top: mmToPt(2), right: mmToPt(2), bottom: mmToPt(2), left: mmToPt(2) },
      safeArea: { top: mmToPt(4), right: mmToPt(4), bottom: mmToPt(4), left: mmToPt(4) },
    });

    // Blank artboard: the template's size, bleed, safe area and sides; no demo artwork.
    await expect(page.getByTestId('read-only-banner')).toHaveCount(0);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'SAVED');
    await expect(page.getByTestId('page-tab-page-front')).toBeVisible();
    await expect(page.getByTestId('page-tab-page-back')).toBeVisible();
    await expect(page.getByTestId('layers-panel').getByRole('option')).toHaveCount(0);
    await expect(page.getByTestId('layers-panel')).toContainText('No objects on this page yet.');
    await expect(page.getByTestId('page-width')).toHaveValue('60');
    await expect(page.getByTestId('page-height')).toHaveValue('100');
    await expect(page.getByTestId('page-bleed')).toHaveValue('2');
    await expect(page.getByTestId('page-safe')).toHaveValue('4');

    // Add text, save, reload: the text survives.
    await page.getByTestId('tool-text').click();
    await page.getByTestId('prop-text-content').fill('First text on a blank template');
    await save(page);
    await page.reload();
    await waitForEditor(page);
    const saved = await getVersion(context.request, versionId!);
    expect(saved.revision).toBe(2);
    const text = saved.document.pages[0]!.objects.find(
      (object) => object.type === 'text' && object.content === 'First text on a blank template',
    );
    expect(text).toBeDefined();
    await page.getByTestId(`layer-row-${text!.id}`).click();
    await expect(page.getByTestId('prop-text-content')).toHaveValue(
      'First text on a blank template',
    );

    // Back on the template page: the draft offers Edit in designer and Submit for review.
    await page.getByRole('button', { name: 'Back to template' }).click();
    await expect(page).toHaveURL(new RegExp(`/templates/${templateId}$`));
    const row = versionRow(page, 1);
    await expect(row.getByRole('link', { name: 'Edit in designer' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Submit for review' })).toBeVisible();
    await expect(
      page
        .locator('dt', { hasText: /^Artwork objects$/ })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('1');
    await context.close();
  });

  test('a just-created zero-object draft opens from the template page (front only)', async ({
    browser,
  }) => {
    const context = await contextFor(browser, 'designer');
    const draft = await createBlankTemplate(context.request, { pageLayout: 'FRONT_ONLY' });
    const page = await context.newPage();
    await page.goto(`/templates/${draft.template.id}`);

    const row = versionRow(page, 1);
    await expect(row).toContainText('Draft');
    await expect(row.getByRole('button', { name: 'Submit for review' })).toBeVisible();
    await expect(page.getByTestId('template-edit-in-designer')).toBeVisible();
    await row.getByRole('link', { name: 'Edit in designer' }).click();

    await expect(page).toHaveURL(
      new RegExp(`/templates/${draft.template.id}/versions/${draft.versionId}/edit$`),
    );
    await waitForEditor(page);
    await expect(page.getByTestId('read-only-banner')).toHaveCount(0);
    await expect(page.getByTestId('page-tab-page-front')).toBeVisible();
    await expect(page.getByTestId('page-tab-page-back')).toHaveCount(0);
    await expect(page.getByTestId('layers-panel').getByRole('option')).toHaveCount(0);
    await expect(page.getByTestId('page-width')).toHaveValue('50');
    await expect(page.getByTestId('page-height')).toHaveValue('90');

    // Opening and saving without changes keeps the stored document untouched.
    const before = await getVersion(context.request, draft.versionId);
    await page.getByTestId('save-button').click();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'SAVED');
    const after = await getVersion(context.request, draft.versionId);
    expect(after.revision).toBe(before.revision);
    expect(after.documentHash).toBe(before.documentHash);
    await context.close();
  });

  for (const [role, who] of [
    ['viewer', 'a viewer'],
    ['approver', 'an approver (no designer role)'],
  ] as const) {
    test(`${who} is not offered Edit in designer and the API refuses the edit`, async ({
      browser,
    }) => {
      const designer = await contextFor(browser, 'designer');
      const draft = await createBlankTemplate(designer.request);
      const context = await contextFor(browser, role);
      const page = await context.newPage();

      await page.goto(`/templates/${draft.template.id}`);
      const row = versionRow(page, 1);
      await expect(row).toContainText('Draft');
      await expect(row.getByRole('link', { name: 'Edit in designer' })).toHaveCount(0);
      await expect(row.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);
      await expect(page.getByTestId('template-edit-in-designer')).toHaveCount(0);

      // The version page offers the designer read-only; opening it directly stays read-only.
      await row.getByRole('link', { name: 'v1' }).click();
      await expect(page.getByTestId('open-designer')).toHaveText('Open designer (view only)');
      await page.getByTestId('open-designer').click();
      await waitForEditor(page);
      await expect(page.getByTestId('read-only-banner')).toContainText('view-only');
      await expect(page.getByTestId('save-button')).toBeDisabled();
      await expect(page.getByTestId('tool-text')).toBeDisabled();

      // Server-side authorization is authoritative.
      const version = await getVersion(context.request, draft.versionId);
      const refused = await context.request.patch(`/api/v1/template-versions/${draft.versionId}`, {
        headers: ORIGIN,
        data: { document: version.document, expectedRevision: version.revision },
      });
      expect(refused.status()).toBe(403);
      expect((await getVersion(designer.request, draft.versionId)).revision).toBe(1);
      await context.close();
      await designer.close();
    });
  }

  test('approved versions offer no Edit in designer; a new draft based on them does', async ({
    browser,
  }) => {
    const designer = await contextFor(browser, 'designer');
    const approver = await contextFor(browser, 'approver');
    const draft = await createDraft(designer.request);
    for (const [context, targetStatus] of [
      [designer, 'IN_REVIEW'],
      [approver, 'APPROVED'],
    ] as const) {
      const response = await context.request.post(
        `/api/v1/template-versions/${draft.versionId}/transitions`,
        { headers: ORIGIN, data: { targetStatus } },
      );
      expect(response.status(), await response.text()).toBe(200);
    }

    const page = await designer.newPage();
    await page.goto(`/templates/${draft.template.id}`);
    await expect(versionRow(page, 1)).toContainText('Approved');
    await expect(versionRow(page, 1).getByRole('link', { name: 'Edit in designer' })).toHaveCount(
      0,
    );
    await expect(page.getByTestId('template-edit-in-designer')).toHaveCount(0);

    // A new draft that starts from existing artwork is editable like any other draft.
    await page.getByRole('button', { name: 'New version from v1' }).click();
    const newRow = versionRow(page, 2);
    await expect(newRow).toContainText('Draft');
    await newRow.getByRole('link', { name: 'Edit in designer' }).click();
    await waitForEditor(page);
    await expect(page.getByTestId('read-only-banner')).toHaveCount(0);
    const approved = await getVersion(designer.request, draft.versionId);
    await expect(page.getByTestId('layers-panel').getByRole('option')).toHaveCount(
      approved.document.pages[0]!.objects.length,
    );

    // The approved version itself stays immutable in the designer and at the API.
    await page.goto(`/templates/${draft.template.id}/versions/${draft.versionId}/edit`);
    await waitForEditor(page);
    await expect(page.getByTestId('read-only-banner')).toContainText(
      'approved and cannot be edited',
    );
    const refused = await designer.request.patch(`/api/v1/template-versions/${draft.versionId}`, {
      headers: ORIGIN,
      data: { document: approved.document, expectedRevision: approved.revision },
    });
    expect(refused.status()).toBe(409);
    await approver.close();
    await designer.close();
  });

  test('the seeded HT-DEMO-50X90 draft still opens from its template page', async ({ browser }) => {
    const context = await contextFor(browser, 'designer');
    const page = await context.newPage();
    await page.goto('/templates');
    await page.getByRole('searchbox', { name: 'Search templates' }).fill('HT-DEMO-50X90');
    await page
      .getByRole('link', { name: /Demo Active hang tag/i })
      .first()
      .click();

    await expect(versionRow(page, 1)).toContainText('Approved');
    await expect(versionRow(page, 1).getByRole('link', { name: 'Edit in designer' })).toHaveCount(
      0,
    );
    await expect(versionRow(page, 2)).toContainText('Draft');
    await expect(
      versionRow(page, 2).getByRole('button', { name: 'Submit for review' }),
    ).toBeVisible();
    await expect(page.getByTestId('template-edit-in-designer')).toHaveText('Edit v2 in designer');
    await versionRow(page, 2).getByRole('link', { name: 'Edit in designer' }).click();

    await expect(page).toHaveURL(DESIGNER_URL);
    await waitForEditor(page);
    const [, , versionId] = DESIGNER_URL.exec(new URL(page.url()).pathname)!;
    const seeded = await getVersion(context.request, versionId!);
    expect(seeded).toMatchObject({ versionNumber: 2, status: 'DRAFT' });
    await expect(page.getByTestId('read-only-banner')).toHaveCount(0);
    await expect(page.getByTestId('layers-panel').getByRole('option')).toHaveCount(
      seeded.document.pages[0]!.objects.length,
    );
    // Opened only: the shared seed data is left unchanged for other tests.
    await context.close();
  });
});
