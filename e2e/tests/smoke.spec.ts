import { expect, test } from '@playwright/test';
import { E2E_PASSWORD } from '../environment.mjs';
import { USERS, storageStatePath } from '../support/users.ts';

test.describe('platform smoke', () => {
  test('signs in through the login form and reaches the templates list', async ({ page }) => {
    await page.goto('/templates');
    await expect(page).toHaveURL(/\/login\?next=%2Ftemplates/);
    await page.getByLabel('Email').fill(USERS.designer);
    await page.getByLabel('Password').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/templates$/);
    await expect(page.getByRole('cell', { name: 'HT-DEMO-50X90' })).toBeVisible();
  });

  test.describe('signed in', () => {
    test.use({ storageState: storageStatePath('designer') });

    test('renders a version preview from the canonical document', async ({ page }) => {
      await page.goto('/templates');
      await page
        .getByRole('link', { name: /Demo Active hang tag/i })
        .first()
        .click();
      await expect(page.getByTestId('document-preview-canvas').locator('svg')).toBeVisible();
    });
  });
});
