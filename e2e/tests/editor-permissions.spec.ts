import { expect, test, type Browser } from '@playwright/test';
import { E2E_WEB_URL } from '../environment.mjs';
import { createDraft, getVersion, openEditor, objectOf, save } from '../support/editor.ts';
import { storageStatePath, type SeedUser } from '../support/users.ts';

const ORIGIN = { origin: E2E_WEB_URL };

async function contextFor(browser: Browser, user: SeedUser) {
  return browser.newContext({
    storageState: storageStatePath(user),
    baseURL: E2E_WEB_URL,
    viewport: { width: 1600, height: 1000 },
  });
}

test.describe('designer — permissions, immutability and concurrency', () => {
  test('a viewer can preview but not manipulate or save; the API refuses the viewer', async ({
    browser,
  }) => {
    const designer = await contextFor(browser, 'designer');
    const draft = await createDraft(designer.request);
    const viewer = await contextFor(browser, 'viewer');
    const page = await viewer.newPage();
    await openEditor(page, draft);

    await expect(page.getByTestId('read-only-banner')).toContainText('view-only');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'READ_ONLY');
    await expect(page.getByTestId('save-button')).toBeDisabled();
    await expect(page.getByTestId('tool-text')).toBeDisabled();
    await page.getByTestId('layer-row-front-logo').click();
    await expect(page.getByTestId('prop-x')).toBeDisabled();
    await page.getByTestId('editor-root').focus();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('layer-row-front-logo')).toBeVisible();

    const version = await getVersion(viewer.request, draft.versionId);
    const response = await viewer.request.patch(`/api/v1/template-versions/${draft.versionId}`, {
      headers: ORIGIN,
      data: { document: version.document, expectedRevision: version.revision },
    });
    expect(response.status()).toBe(403);
    await viewer.close();
    await designer.close();
  });

  test('an approved version opens read-only and the server refuses edits', async ({ browser }) => {
    const designer = await contextFor(browser, 'designer');
    const approver = await contextFor(browser, 'approver');
    const draft = await createDraft(designer.request);
    expect(
      (
        await designer.request.post(`/api/v1/template-versions/${draft.versionId}/transitions`, {
          headers: ORIGIN,
          data: { targetStatus: 'IN_REVIEW' },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await approver.request.post(`/api/v1/template-versions/${draft.versionId}/transitions`, {
          headers: ORIGIN,
          data: { targetStatus: 'APPROVED' },
        })
      ).status(),
    ).toBe(200);

    const page = await designer.newPage();
    await openEditor(page, draft);
    await expect(page.getByTestId('read-only-banner')).toContainText(
      'approved and cannot be edited',
    );
    await expect(page.getByTestId('save-button')).toBeDisabled();

    const version = await getVersion(designer.request, draft.versionId);
    const refused = await designer.request.patch(`/api/v1/template-versions/${draft.versionId}`, {
      headers: ORIGIN,
      data: { document: version.document, expectedRevision: version.revision },
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

  test('a stale editor never overwrites a newer revision', async ({ browser }) => {
    const designer = await contextFor(browser, 'designer');
    const draft = await createDraft(designer.request);
    const page = await designer.newPage();
    await openEditor(page, draft);

    // Another session changes the draft first.
    const current = await getVersion(designer.request, draft.versionId);
    const other = JSON.parse(JSON.stringify(current.document)) as typeof current.document;
    const otherPrice = objectOf(other, 'page-front', 'front-price');
    if (otherPrice.type !== 'text') throw new Error('expected text');
    otherPrice.content = '24.99';
    const otherSave = await designer.request.patch(`/api/v1/template-versions/${draft.versionId}`, {
      headers: ORIGIN,
      data: { document: other, expectedRevision: current.revision },
    });
    expect(otherSave.status()).toBe(200);

    // This editor still holds the old revision.
    await page.getByTestId('layer-row-front-size').click();
    await page.keyboard.press('ArrowRight');
    await page.getByTestId('save-button').click();
    await expect(page.getByTestId('conflict-dialog')).toBeVisible();
    await expect(page.getByTestId('conflict-dialog')).toContainText('changed in another session');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'CONFLICT');

    const server = await getVersion(designer.request, draft.versionId);
    const serverPrice = objectOf(server.document, 'page-front', 'front-price');
    expect(serverPrice.type === 'text' && serverPrice.content).toBe('24.99');
    expect(objectOf(server.document, 'page-front', 'front-size')).toEqual(
      objectOf(current.document, 'page-front', 'front-size'),
    );

    await page.getByTestId('conflict-reload').click();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'SAVED');
    await page.getByTestId('layer-row-front-price').click();
    await expect(page.getByTestId('prop-text-content')).toHaveValue('24.99');
    await page.getByTestId('prop-text-content').fill('29.99');
    await save(page);
    const final = objectOf(
      (await getVersion(designer.request, draft.versionId)).document,
      'page-front',
      'front-price',
    );
    expect(final.type === 'text' && final.content).toBe('29.99');
    await designer.close();
  });
});
