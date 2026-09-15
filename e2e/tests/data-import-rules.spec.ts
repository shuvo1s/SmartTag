import { expect, test, type Page } from '@playwright/test';
import { createDataField } from '@smarttag/document-utils';
import type { AssetDto } from '@smarttag/shared-types';
import { TINY_PNG_BASE64 } from '../support/assets.ts';
import {
  ORIGIN,
  STANDARD_MAPPING,
  apiAs,
  csv,
  expectStatus,
  importTemplate,
  mapColumns,
  startImport,
} from '../support/imports.ts';
import { storageStatePath } from '../support/users.ts';

test.use({ storageState: storageStatePath('dataOperator') });

async function rowIssues(page: Page, rowNumber: number) {
  await page.getByTestId(`record-row-${rowNumber}`).click();
  await expect(page.getByTestId('row-inspector')).toContainText(`Row ${rowNumber}`);
  return page.getByTestId('row-issue');
}

test.describe('mapping profiles and validation failures', () => {
  test('a mapping profile saved from file A is suggested and restores the mapping for file B', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const draft = await importTemplate();
    const rows = [['YT-2045', 'Premium Cotton Shirt', 'Navy', 'XL', '39.95', '9501234567891', '']];
    await startImport(page, draft, csv(rows));
    await expectStatus(page, 'MAPPING_REQUIRED');
    await mapColumns(page, STANDARD_MAPPING);
    await page.getByTestId('save-mapping').click();
    await page.getByTestId('save-configuration').click();
    await page.getByTestId('start-validation').click();
    await expectStatus(page, 'READY');
    const profileName = `Customer ABC ${Date.now()}`;
    await page.getByTestId('save-profile').click();
    await page.getByTestId('profile-name').fill(profileName);
    await page.getByTestId('confirm-save-profile').click();
    await expect(page.getByTestId('profile-saved')).toBeVisible();

    // File B: same headers in another order, plus an extra column.
    const headersB = [
      'EAN_CODE',
      'RETAIL',
      'NOTES',
      'STYLE_NO',
      'PRODUCT NAME',
      'Color',
      'SIZE_CODE',
      'IMAGE',
    ];
    await startImport(
      page,
      draft,
      csv([['9501234567891', '42.00', 'n/a', 'YT-3000', 'Polo', 'Red', 'S', '']], headersB),
    );
    await expectStatus(page, 'MAPPING_REQUIRED');
    const suggestion = page
      .getByTestId('profile-suggestions')
      .locator('[data-testid^="profile-"]', { hasText: profileName });
    await expect(suggestion.getByTestId('profile-compatibility')).toHaveText('Compatible');
    await suggestion.getByRole('button', { name: 'Apply mapping profile' }).click();
    for (const [letter, field] of Object.entries({
      A: 'gtin',
      B: 'price',
      D: 'style',
      E: 'product_name',
      F: 'color',
      G: 'size',
    })) {
      await expect(page.getByTestId(`mapping-select-${letter}`)).toHaveValue(field);
    }
    await expect(page.getByTestId('mapping-select-C')).toHaveValue('');
    await page.getByTestId('save-mapping').click();
    await expect(page.getByTestId('wizard-step-configure')).toHaveAttribute('aria-current', 'step');
  });

  test('missing required mapping blocks validation with a clear message', async ({ page }) => {
    const draft = await importTemplate();
    await startImport(
      page,
      draft,
      csv([['YT-2045', 'Shirt', 'Navy', 'XL', '39.95', '9501234567891', '']]),
    );
    await expectStatus(page, 'MAPPING_REQUIRED');
    const { F: _gtin, ...withoutGtin } = STANDARD_MAPPING;
    await mapColumns(page, withoutGtin);
    await expect(page.getByTestId('mapping-issues')).toContainText(
      'Required field "gtin" (GTIN) is not mapped and has no default',
    );
    await page.getByTestId('save-mapping').click();
    await expectStatus(page, 'MAPPING_REQUIRED');
    await expect(page.getByTestId('wizard-step-validate')).toBeDisabled();
  });

  test("row-level issues: decimal comma without rules, invalid EAN-13, invalid URL and another tenant's asset", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // Another organization's image asset.
    const acme = await apiAs('acmeAdmin');
    const uploaded = await acme.post('/api/v1/assets', {
      headers: ORIGIN,
      multipart: {
        assetType: 'IMAGE',
        file: {
          name: 'acme.png',
          mimeType: 'image/png',
          buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        },
      },
    });
    expect(uploaded.status(), await uploaded.text()).toBe(201);
    const foreignAsset = (await uploaded.json()) as AssetDto;
    await acme.dispose();

    const draft = await importTemplate();
    const headers = [
      'STYLE_NO',
      'PRODUCT NAME',
      'Color',
      'SIZE_CODE',
      'RETAIL',
      'EAN_CODE',
      'IMAGE',
      'URL',
    ];
    await startImport(
      page,
      draft,
      csv(
        [
          ['YT-1001', 'Decimal comma', 'Navy', 'XL', '19,99', '9501234567891', '', ''],
          ['YT-1002', 'Bad check digit', 'Navy', 'XL', '19.99', '9501234567893', '', ''],
          [
            'YT-1003',
            'Bad link',
            'Navy',
            'XL',
            '19.99',
            '9501234567891',
            '',
            'javascript:alert(1)',
          ],
          ['YT-1004', 'Foreign asset', 'Navy', 'XL', '19.99', '9501234567891', foreignAsset.id, ''],
        ],
        headers,
      ),
    );
    await expectStatus(page, 'MAPPING_REQUIRED');
    await mapColumns(page, { ...STANDARD_MAPPING, G: 'product_image', H: 'product_url' });
    await page.getByTestId('save-mapping').click();
    await page.getByTestId('save-configuration').click();
    await page.getByTestId('start-validation').click();
    await expectStatus(page, 'HAS_ERRORS');
    await expect(page.getByTestId('summary-errors')).toHaveText('4');

    const decimal = await rowIssues(page, 2);
    await expect(decimal.first()).toHaveAttribute('data-code', 'DECIMAL_PARSE_FAILED');
    await expect(decimal.first()).toContainText(
      'cannot parse "19,99" using decimal separator "." and no thousands separator',
    );
    await expect(decimal.first()).toContainText('RETAIL — Column E');

    const barcode = await rowIssues(page, 3);
    await expect(
      page.locator('[data-testid="row-issue"][data-code="BARCODE_VALUE_INVALID"]'),
    ).toContainText('Check digit should be 1');
    await expect(barcode.first()).toHaveAttribute('data-layer', 'OBJECT');

    await rowIssues(page, 4);
    await expect(
      page.locator('[data-testid="row-issue"][data-code="INVALID_VALUE"]'),
    ).toContainText('Product URL');

    await rowIssues(page, 5);
    await expect(
      page.locator('[data-testid="row-issue"][data-code="UNKNOWN_ASSET_REFERENCE"]'),
    ).toContainText('is not a placeable image of this organization');

    // Errors block saving; rows are never dropped.
    await page.getByTestId('wizard-step-save').click();
    await expect(page.getByTestId('finalize-blocked')).toContainText('4 rows have errors');
  });

  test('ambiguous dates are never guessed', async ({ page }) => {
    test.setTimeout(120_000);
    const draft = await importTemplate((document) => ({
      ...document,
      dataSchema: {
        fields: [
          ...document.dataSchema.fields,
          createDataField({ key: 'ship_date', displayName: 'Ship date', type: 'date' }),
        ],
      },
    }));
    const headers = [
      'STYLE_NO',
      'PRODUCT NAME',
      'Color',
      'SIZE_CODE',
      'RETAIL',
      'EAN_CODE',
      'SHIP DATE',
    ];
    await startImport(
      page,
      draft,
      csv([['YT-2045', 'Shirt', 'Navy', 'XL', '39.95', '9501234567891', '03/04/2026']], headers),
    );
    await expectStatus(page, 'MAPPING_REQUIRED');
    await mapColumns(page, { ...STANDARD_MAPPING, G: 'ship_date' });
    await page.getByTestId('save-mapping').click();
    await expect(page.getByTestId('date-ambiguity-ship_date')).toContainText(
      'DD/MM/YYYY and MM/DD/YYYY',
    );
    await expect(page.getByTestId('parse-preview-ship_date')).toContainText(
      'choose the date format the file uses',
    );
    await page.getByTestId('save-configuration').click();
    await page.getByTestId('start-validation').click();
    await expectStatus(page, 'HAS_ERRORS');
    await rowIssues(page, 2);
    await expect(
      page.locator('[data-testid="row-issue"][data-code="DATE_PARSE_FAILED"]'),
    ).toContainText('"03/04/2026"');
  });
});
