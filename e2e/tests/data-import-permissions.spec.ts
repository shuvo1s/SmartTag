import { expect, test } from '@playwright/test';
import {
  ORIGIN,
  STANDARD_MAPPING,
  apiAs,
  csv,
  expectStatus,
  getImport,
  importTemplate,
  mapColumns,
  startImport,
} from '../support/imports.ts';
import { storageStatePath } from '../support/users.ts';

const ROWS = [['YT-2045', 'Shirt', 'Navy', 'XL', '39.95', '9501234567891', '']];

test.describe('data import permissions', () => {
  let importId: string;
  let versionId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const draft = await importTemplate();
    versionId = draft.versionId;
    const context = await browser.newContext({ storageState: storageStatePath('dataOperator') });
    const page = await context.newPage();
    importId = await startImport(page, draft, csv(ROWS));
    await expectStatus(page, 'MAPPING_REQUIRED');
    await mapColumns(page, STANDARD_MAPPING);
    await page.getByTestId('save-mapping').click();
    await page.getByTestId('save-configuration').click();
    await page.getByTestId('start-validation').click();
    await expectStatus(page, 'READY');
    await context.close();
  });

  test.describe('data operator', () => {
    test.use({ storageState: storageStatePath('dataOperator') });
    test('can import from the Data page', async ({ page }) => {
      await page.goto('/datasets');
      await expect(page.getByTestId('new-import')).toBeVisible();
      await page.getByTestId('data-tab-imports').click();
      await expect(page.getByTestId(`import-row-${importId}`)).toBeVisible();
    });
  });

  test.describe('viewer', () => {
    test.use({ storageState: storageStatePath('viewer') });
    test('reads imports but cannot upload, change or finalize', async ({ page }) => {
      await page.goto('/datasets');
      await expect(page.getByRole('heading', { name: 'Data' })).toBeVisible();
      await expect(page.getByTestId('new-import')).toHaveCount(0);
      await page.goto(`/data-imports/${importId}`);
      await expectStatus(page, 'READY');
      await expect(page.getByTestId('cancel-import')).toHaveCount(0);

      const upload = await page.request.post(`/api/v1/template-versions/${versionId}/imports`, {
        headers: ORIGIN,
        multipart: { file: { name: 'tags.csv', mimeType: 'text/csv', buffer: csv(ROWS).buffer } },
      });
      expect(upload.status()).toBe(403);
      const dto = await getImport(page.request, importId);
      const finalize = await page.request.post(`/api/v1/data-imports/${importId}/finalize`, {
        headers: ORIGIN,
        data: {
          expectedRevision: dto.revision,
          acknowledgeWarnings: false,
          dataset: { mode: 'NEW', name: 'viewer' },
        },
      });
      expect(finalize.status()).toBe(403);
      expect((await page.request.get(`/api/v1/data-imports/${importId}/source`)).status()).toBe(
        403,
      );
    });
  });

  test.describe('approver without data permissions', () => {
    test.use({ storageState: storageStatePath('approver') });
    test('cannot change data', async ({ page }) => {
      const dto = await getImport(page.request, importId);
      const mapping = await page.request.patch(`/api/v1/data-imports/${importId}/mapping`, {
        headers: ORIGIN,
        data: { expectedRevision: dto.revision, mapping: dto.mapping, profile: null },
      });
      expect(mapping.status()).toBe(403);
      const validate = await page.request.post(`/api/v1/data-imports/${importId}/validate`, {
        headers: ORIGIN,
        data: { expectedRevision: dto.revision },
      });
      expect(validate.status()).toBe(403);
      await page.goto(`/templates/${dto.templateVersion.templateId}/versions/${versionId}`);
      await expect(page.getByTestId('open-designer')).toBeVisible();
      await expect(page.getByTestId('import-data')).toHaveCount(0);
    });
  });

  test.describe('another organization', () => {
    test.use({ storageState: storageStatePath('acmeAdmin') });
    test('cannot see the import', async ({ page }) => {
      expect((await page.request.get(`/api/v1/data-imports/${importId}`)).status()).toBe(404);
      expect((await page.request.get(`/api/v1/data-imports/${importId}/rows`)).status()).toBe(404);
      await page.goto(`/data-imports/${importId}`);
      await expect(
        page.getByRole('alert').filter({ hasText: 'Data import not found' }),
      ).toBeVisible();
      const list = await (await apiAs('acmeAdmin')).get('/api/v1/data-imports');
      expect(
        ((await list.json()) as { items: { id: string }[] }).items.some(
          (item) => item.id === importId,
        ),
      ).toBe(false);
    });
  });
});
