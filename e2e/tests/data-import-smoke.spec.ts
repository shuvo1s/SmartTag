import { expect, test } from '@playwright/test';
import { E2E_PASSWORD } from '../environment.mjs';
import {
  STANDARD_MAPPING,
  csv,
  expectStatus,
  mapColumns,
  openSeededVdpVersion,
} from '../support/imports.ts';
import { USERS } from '../support/users.ts';

/**
 * Cross-browser smoke test (Chromium, Firefox, WebKit) for data imports: sign in, open Data, start
 * an import of the seeded variable-data template, map fields and see the validation result.
 */
test('open datasets, start an import, map fields and view the validation result', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByLabel('Email').fill(USERS.dataOperator);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/(dashboard|templates)/);

  await page.getByRole('link', { name: 'Data', exact: true }).click();
  await expect(page).toHaveURL(/\/datasets/);
  const draft = await openSeededVdpVersion(page.request);
  await page.getByTestId('new-import').click();
  await expect(page).toHaveURL(/\/data-imports\/new/);
  await page.getByTestId('import-template').selectOption(draft.template.id);
  await page.getByTestId('import-version').selectOption(draft.versionId);
  await page
    .getByTestId('import-file')
    .setInputFiles(
      csv([['YT-2045', 'Premium Cotton Shirt', 'Navy', 'XL', '39.95', '9501234567891', '']]),
    );
  await page.getByTestId('start-import').click();

  await expectStatus(page, 'MAPPING_REQUIRED');
  await expect(page.getByTestId('mapping-table')).toBeVisible();
  await mapColumns(page, STANDARD_MAPPING);
  await page.getByTestId('save-mapping').click();
  await page.getByTestId('save-configuration').click();
  await page.getByTestId('start-validation').click();
  await expectStatus(page, 'READY');
  await expect(page.getByTestId('summary-rows')).toHaveText('1');
  await expect(page.getByTestId('summary-valid')).toHaveText('1');
});
