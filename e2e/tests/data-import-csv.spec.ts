import { expect, test } from '@playwright/test';
import { E2E_WEB_URL } from '../environment.mjs';
import {
  ORIGIN,
  apiAs,
  csv,
  expectStatus,
  getImport,
  importTemplate,
  mapColumns,
  startImport,
} from '../support/imports.ts';
import { storageStatePath } from '../support/users.ts';

test.use({ storageState: storageStatePath('dataOperator') });

const ROWS = [
  ['YT-2045', 'Premium Cotton Shirt', 'Navy', 'XL', '39,95', '9501234567891', ''],
  ['YT-2046', 'Linen Shirt', 'White', 'M', '1.234,50', '9501234567891', ''],
  ['YT-2047', 'Denim Jacket', 'Blue', 'L', '89,00', '9501234567891', ''],
];

test.describe('CSV import workflow', () => {
  test('template version → upload → source → mapping → rules → validation → row preview → profile → dataset', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const draft = await importTemplate();

    // Entry point on the template version page.
    await page.goto(`/templates/${draft.template.id}/versions/${draft.versionId}`);
    await page.getByTestId('import-data').click();
    await expect(page).toHaveURL(new RegExp(`/data-imports/new\\?versionId=${draft.versionId}`));
    await expect(page.getByTestId('wizard-step-upload')).toHaveAttribute('aria-current', 'step');
    const importId = await startImport(page, draft, csv(ROWS));

    // Source: inspected in the background; headers, preview and counts.
    await expectStatus(page, 'MAPPING_REQUIRED');
    await expect(page.getByTestId('wizard-step-map')).toHaveAttribute('aria-current', 'step');
    await page.getByTestId('wizard-step-source').click();
    await expect(page.getByTestId('source-preview-row-1')).toContainText('PRODUCT NAME');
    await expect(page.getByTestId('source-row-count')).toHaveText('3');
    await expect(page.getByTestId('source-delimiter')).toHaveValue('comma');
    await page.getByTestId('continue-to-mapping').click();

    // Mapping: non-exact suggestions need confirmation; the rest is mapped explicitly.
    await expect(page.getByTestId('mapping-status-B')).toContainText(
      'Suggested: product_name (confirm)',
    );
    await expect(page.getByTestId('field-state-gtin')).toHaveAttribute('data-state', 'missing');
    await page.getByTestId('accept-suggestion-B').click();
    await mapColumns(page, { A: 'style', C: 'color', D: 'size', E: 'price', F: 'gtin' });
    await expect(page.getByTestId('field-state-gtin')).toHaveAttribute('data-state', 'mapped');
    // A field already mapped to another column cannot be chosen twice.
    await expect(
      page.getByTestId('mapping-select-G').locator('option[value="gtin"]'),
    ).toBeDisabled();
    await page.getByTestId('save-mapping').click();

    // Import rules: decimal comma and thousands dot, previewed on the samples.
    await expect(page.getByTestId('wizard-step-configure')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('parse-preview-price')).toContainText('cannot parse "39,95"');
    await page.getByTestId('rule-number-decimal').selectOption(',');
    await page.getByTestId('rule-number-thousands').selectOption('.');
    await expect(page.getByTestId('parse-preview-price')).toContainText('39,95 → 39.95');
    await expect(page.getByTestId('parse-preview-price')).toContainText('1.234,50 → 1234.50');
    await page.getByTestId('save-configuration').click();

    // Validation runs in the worker; the wizard moves to review when it finishes.
    await expect(page.getByTestId('wizard-step-validate')).toHaveAttribute('aria-current', 'step');
    await page.getByTestId('start-validation').click();
    await expectStatus(page, 'READY');
    await expect(page.getByTestId('summary-rows')).toHaveText('3');
    await expect(page.getByTestId('summary-valid')).toHaveText('3');
    await expect(page.getByTestId('summary-errors')).toHaveText('0');

    // Row preview through the Phase 3 resolver and renderer.
    await page.getByTestId('record-row-3').click();
    await expect(page.getByTestId('row-value-price')).toHaveText('1234.50');
    await expect(
      page.getByTestId('row-preview').getByTestId('document-preview-canvas').locator('svg'),
    ).toBeVisible();
    await expect(page.getByTestId('row-preview')).toContainText('Linen Shirt');
    await page.getByTestId('row-next').click();
    await expect(page.getByTestId('row-inspector')).toContainText('Row 4');

    // Reusable mapping profile.
    await page.getByTestId('save-profile').click();
    await page.getByTestId('profile-name').fill(`ABC ERP export ${Date.now()}`);
    await page.getByTestId('confirm-save-profile').click();
    await expect(page.getByTestId('profile-saved')).toBeVisible();

    // Save the dataset version.
    await page.getByTestId('continue-to-save').click();
    const datasetName = `FW26 hang tags ${Date.now()}`;
    await page.getByTestId('dataset-mode-new').check();
    await page.getByTestId('dataset-name').fill(datasetName);
    await page.getByTestId('finalize-dataset').click();
    await expect(page).toHaveURL(/\/dataset-versions\/[0-9a-f-]{36}/);
    await expect(page.getByTestId('dataset-version-status')).toContainText('immutable');
    await expect(page.getByTestId('version-rows')).toHaveText('3');
    const hash = await page.getByTestId('dataset-hash').textContent();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // After a reload the dataset is still there and still immutable.
    await page.reload();
    await expect(page.getByTestId('dataset-hash')).toHaveText(hash!);
    await expect(page.getByTestId('records-total')).toContainText('3 rows');
    const api = await apiAs('dataOperator');
    const imported = await getImport(api, importId);
    const change = await api.patch(`/api/v1/data-imports/${importId}/mapping`, {
      headers: ORIGIN,
      data: { expectedRevision: imported.revision, mapping: imported.mapping, profile: null },
    });
    expect(change.status()).toBe(409);
    expect(((await change.json()) as { error: { code: string } }).error.code).toBe(
      'DATASET_IMMUTABLE',
    );
    await api.dispose();

    await page.goto(`${E2E_WEB_URL}/datasets`);
    await expect(page.getByTestId(`dataset-row-${datasetName}`)).toContainText('Version 1');
  });

  test('a 10,000-row CSV is processed in the background and reviewed page by page', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const draft = await importTemplate();
    const rows = Array.from({ length: 10_000 }, (_, index) => [
      `YT-${String(index).padStart(4, '0')}`,
      `Shirt ${index}`,
      'Navy',
      ['S', 'M', 'L', 'XL'][index % 4]!,
      `${(index % 900) + 10},95`,
      '9501234567891',
      '',
    ]);
    await startImport(page, draft, csv(rows));
    await expectStatus(page, 'MAPPING_REQUIRED');
    await expect(page.getByTestId('wizard-step-map')).toHaveAttribute('aria-current', 'step');
    await mapColumns(page, {
      A: 'style',
      B: 'product_name',
      C: 'color',
      D: 'size',
      E: 'price',
      F: 'gtin',
    });
    await page.getByTestId('save-mapping').click();
    await page.getByTestId('rule-number-decimal').selectOption(',');
    await page.getByTestId('save-configuration').click();
    await page.getByTestId('start-validation').click();
    await expect(page.getByTestId('validation-progress')).toBeVisible();
    await expectStatus(page, 'READY', 120_000);
    await expect(page.getByTestId('summary-rows')).toHaveText('10,000');
    // Only one page of rows is ever rendered.
    await expect(page.getByTestId('records-table').locator('tbody tr')).toHaveCount(50);
    await expect(page.getByTestId('records-total')).toContainText('10,000 rows · page 1 of 200');
    await page.getByTestId('row-search').fill('YT-9999');
    await expect(page.getByTestId('records-table').locator('tbody tr')).toHaveCount(1);
  });
});
