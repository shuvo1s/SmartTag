import { expect, test } from '@playwright/test';
import { buildXlsxWorkbook } from '@smarttag/tabular-sources/testing';
import {
  HEADERS,
  expectStatus,
  importTemplate,
  mapColumns,
  startImport,
} from '../support/imports.ts';
import { storageStatePath } from '../support/users.ts';

test.use({ storageState: storageStatePath('dataOperator') });

test('XLSX import: choose the worksheet and header row, map, validate, preview and finalize', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const draft = await importTemplate();
  const workbook = buildXlsxWorkbook({
    sheets: [
      { name: 'Instructions', rows: [['Fill in the Tags sheet'], ['Do not rename columns']] },
      {
        name: 'Tags',
        rows: [
          ['Customer ABC — FW26 order'],
          [...HEADERS],
          ['YT-2045', 'Premium Cotton Shirt', 'Navy', 'XL', 39.95, 9501234567891, null],
          ['YT-2046', 'Linen Shirt', 'White', 'M', 24.5, { zeroPadded: 9501234567891 }, null],
        ],
      },
    ],
  });
  await startImport(page, draft, {
    name: 'fw26-order.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook,
  });

  // Two worksheets: the wizard asks instead of assuming the first one.
  await expectStatus(page, 'MAPPING_REQUIRED');
  await expect(page.getByTestId('wizard-step-source')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('source-problems')).toContainText('Choose the worksheet');
  await expect(page.getByTestId('continue-to-mapping')).toBeDisabled();
  await page.getByTestId('source-sheet').selectOption('Tags');
  await expect(page.getByTestId('source-preview-row-2')).toContainText('PRODUCT NAME');
  await page.getByTestId('source-header-row').fill('2');
  await page.getByTestId('apply-source-settings').click();
  await expect(page.getByTestId('source-row-count')).toHaveText('2');
  await expect(page.getByTestId('source-problems')).toHaveCount(0);
  await page.getByTestId('continue-to-mapping').click();

  await mapColumns(page, {
    A: 'style',
    B: 'product_name',
    C: 'color',
    D: 'size',
    E: 'price',
    F: 'gtin',
  });
  await page.getByTestId('save-mapping').click();
  await page.getByTestId('save-configuration').click();
  await page.getByTestId('start-validation').click();
  await expectStatus(page, 'READY');
  await expect(page.getByTestId('summary-rows')).toHaveText('2');

  // Typed spreadsheet values: numbers stay exact, a zero-padded GTIN keeps its digits.
  await page.getByTestId('record-row-4').click();
  await expect(page.getByTestId('row-value-price')).toHaveText('24.5');
  await expect(page.getByTestId('row-value-gtin')).toHaveText('9501234567891');
  await expect(
    page.getByTestId('row-preview').getByTestId('document-preview-canvas').locator('svg'),
  ).toBeVisible();

  await page.getByTestId('continue-to-save').click();
  await page.getByTestId('dataset-name').fill(`XLSX dataset ${Date.now()}`);
  await page.getByTestId('finalize-dataset').click();
  await expect(page).toHaveURL(/\/dataset-versions\//);
  await expect(page.getByTestId('version-rows')).toHaveText('2');
});
