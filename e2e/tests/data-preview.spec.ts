import { expect, test, type Page } from '@playwright/test';
import type { TextObject } from '@smarttag/document-schema';
import { computeDocumentHash } from '@smarttag/document-utils';
import { VARIABLE_DATA_RECORD } from '@smarttag/document-utils/fixtures';
import { getVersion, objectOf, openEditor, save } from '../support/editor.ts';
import {
  canvasDataDisplay,
  createVariableDataDraft,
  editorDocument,
  enableDataPreview,
  openDataPanel,
  selectLayer,
  setTestValue,
  summaryCount,
  useTestRecord,
} from '../support/data.ts';
import { storageStatePath } from '../support/users.ts';

test.use({ storageState: storageStatePath('designer') });

const issue = (page: Page, code: string) =>
  page.getByTestId('preview-issue').and(page.locator(`[data-code="${code}"]`));

test.describe('test data and data preview', () => {
  test('entering a record updates the artwork immediately and never changes the template', async ({
    page,
  }) => {
    const draft = await createVariableDataDraft(page.request);
    await openEditor(page, draft);
    const stored = await getVersion(page.request, draft.versionId);

    await openDataPanel(page, 'test');
    await page.getByTestId('enable-data-preview').click();
    await expect(page.getByTestId('data-preview-banner')).toContainText('template is not changed');

    // Type-specific controls.
    await expect(page.getByTestId('test-input-is_sustainable')).toHaveJSProperty(
      'tagName',
      'SELECT',
    );
    await expect(page.getByTestId('test-input-product_image')).toHaveJSProperty(
      'tagName',
      'SELECT',
    );
    await expect(page.getByTestId('test-input-product_url')).toHaveAttribute('type', 'url');
    await expect(page.getByTestId('test-input-price')).toHaveAttribute('inputmode', 'decimal');

    for (const [key, value] of Object.entries({
      product_name: 'Premium Cotton Shirt',
      style: 'YT-2045',
      color: 'Navy',
      size: 'XL',
      price: '39.95',
      gtin: '9501234567891',
      is_sustainable: 'true',
    })) {
      await setTestValue(page, key, value);
    }
    await expect(summaryCount(page, 'checked')).toHaveText('11');
    await expect(summaryCount(page, 'errors')).toHaveText('0');
    await expect(page.getByTestId('production-valid')).toHaveAttribute('data-valid', 'true');

    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-size'))?.object?.content)
      .toBe('SIZE: XL');
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-price'))?.object?.content)
      .toBe('USD 39.95');
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-sku'))?.object?.content)
      .toBe('YT-2045-NAVY-XL');
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-recycled'))?.hidden)
      .toBe(false);

    // One changed value re-resolves only what depends on it.
    await setTestValue(page, 'size', 'M');
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-sku'))?.object?.content)
      .toBe('YT-2045-NAVY-M');

    // The canonical renderer preview shows the same resolved artwork.
    await page.getByTestId('toggle-preview').click();
    await expect(page.getByTestId('canonical-preview')).toContainText('YT-2045-NAVY-M');
    await page.getByTestId('toggle-preview').click();

    // Switching back shows template values; nothing was stored in the document.
    await page.getByTestId('preview-mode-template').click();
    await expect(page.getByTestId('data-preview-banner')).toHaveCount(0);
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-size'))?.object ?? null)
      .toBeNull();
    const inEditor = await editorDocument(page);
    expect(await computeDocumentHash(inEditor)).toBe(stored.documentHash);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'SAVED');
    await page.getByTestId('save-button').click();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'SAVED');
    const after = await getVersion(page.request, draft.versionId);
    expect(after.documentHash).toBe(stored.documentHash);
    expect(after.revision).toBe(stored.revision);
    expect(JSON.stringify(after.document)).not.toContain('Premium Cotton Shirt');
  });

  test('validation: missing required value, wrong type, min/max and an invalid barcode after resolution', async ({
    page,
  }) => {
    const draft = await createVariableDataDraft(page.request);
    await openEditor(page, draft);
    await useTestRecord(page, VARIABLE_DATA_RECORD);
    await enableDataPreview(page);
    await expect(summaryCount(page, 'errors')).toHaveText('0');

    await setTestValue(page, 'size', '');
    await expect(page.getByTestId('test-field-issue-size')).toHaveAttribute(
      'data-code',
      'REQUIRED_VALUE_EMPTY',
    );
    await expect(summaryCount(page, 'errors')).toHaveText('1');
    await expect(summaryCount(page, 'valid')).toHaveText('10');
    await setTestValue(page, 'size', 'XL');

    await setTestValue(page, 'price', 'abc');
    await expect(page.getByTestId('test-field-issue-price')).toHaveAttribute(
      'data-code',
      'INVALID_VALUE',
    );
    await setTestValue(page, 'price', '0');
    await expect(page.getByTestId('test-field-issue-price')).toHaveAttribute(
      'data-code',
      'VALUE_BELOW_MINIMUM',
    );
    await setTestValue(page, 'price', '10000');
    await expect(page.getByTestId('test-field-issue-price')).toHaveAttribute(
      'data-code',
      'VALUE_ABOVE_MAXIMUM',
    );
    await setTestValue(page, 'price', '39.95');
    await expect(page.getByTestId('test-field-issue-price')).toHaveCount(0);

    // The specification's example GTIN fails the EAN-13 check digit: an OBJECT issue after resolution.
    await setTestValue(page, 'gtin', '9501234567893');
    await expect(issue(page, 'BARCODE_VALUE_INVALID')).toContainText('Check digit should be 1');
    await expect(issue(page, 'BARCODE_VALUE_INVALID')).toHaveAttribute('data-layer', 'OBJECT');
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-barcode'))?.issue)
      .toBe('ERROR');
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-barcode'))?.lastIssues)
      .toContain('SYMBOL_INVALID');
    await expect(page.getByTestId('data-issue-count')).toContainText('1 error');

    // Choosing the issue selects the artwork.
    await issue(page, 'BARCODE_VALUE_INVALID').click();
    await expect(page.getByTestId('object-properties')).toHaveAttribute(
      'data-object-id',
      'vd-barcode',
    );
  });

  test('long real data triggers an overflow warning instead of silent truncation', async ({
    page,
  }) => {
    const draft = await createVariableDataDraft(page.request);
    await openEditor(page, draft);
    await useTestRecord(page, {
      ...VARIABLE_DATA_RECORD,
      color: 'Midnight Navy Heather With Contrast Stitching',
    });
    await enableDataPreview(page);
    await expect(issue(page, 'TEXT_OVERFLOW')).toBeVisible();
    await expect(issue(page, 'TEXT_OVERFLOW')).toHaveAttribute('data-layer', 'LAYOUT');
    await expect(issue(page, 'TEXT_OVERFLOW')).toContainText('SKU code');
    const sku = await canvasDataDisplay(page, 'vd-sku');
    expect(sku?.object?.content).toBe('YT-2045-MIDNIGHT NAVY HEATHER WITH CONTRAST STITCHING-XL');
    expect(sku?.issue).toBe('WARNING');
  });

  test('expressions: preview result, invalid and unknown references, unsafe input and conditional visibility', async ({
    page,
  }) => {
    const draft = await createVariableDataDraft(page.request);
    await openEditor(page, draft);
    await useTestRecord(page, VARIABLE_DATA_RECORD);
    await enableDataPreview(page);
    await selectLayer(page, 'vd-size');
    const input = page.getByTestId('expression-input-content');
    await expect(input).toHaveValue('concat("SIZE: ", size)');
    await expect(page.getByTestId('expression-result-content')).toHaveText('SIZE: XL');

    // Invalid expressions are explained and never applied.
    const before = await editorDocument(page);
    for (const [expression, code] of [
      ['concat("SIZE: ", size', 'EXPRESSION_PARSE_ERROR'],
      ['concat("SIZE: ", sise)', 'UNKNOWN_FIELD'],
      ['process.env.SECRET', 'EXPRESSION_PARSE_ERROR'],
      ['fetch("https://attacker.example")', 'UNKNOWN_FUNCTION'],
      ['constructor("alert(1)")', 'UNKNOWN_FUNCTION'],
      ['upper(price)', 'TYPE_MISMATCH'],
    ] as const) {
      await input.fill(expression);
      await expect(page.getByTestId('expression-issues-content')).toContainText(code);
      await expect(page.getByTestId('expression-apply-content')).toBeDisabled();
    }
    await input.press('Escape');
    expect(await editorDocument(page)).toEqual(before);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'SAVED');

    // A valid expression previews its result and applies as one undo step.
    await input.fill('concat("SIZE ", size, " · ", currency, " ", formatNumber(price, 2))');
    await expect(page.getByTestId('expression-result-content')).toHaveText('SIZE XL · USD 39.95');
    await page.getByTestId('expression-apply-content').click();
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-size'))?.object?.content)
      .toBe('SIZE XL · USD 39.95');
    await expect(page.getByTestId('undo')).toHaveAttribute(
      'aria-label',
      'Undo Change expression (content)',
    );

    // Conditional visibility uses the same engine.
    await selectLayer(page, 'vd-recycled');
    await expect(page.getByTestId('expression-input-visible')).toHaveValue(
      'is_sustainable == true',
    );
    await openDataPanel(page, 'test');
    await setTestValue(page, 'is_sustainable', 'false');
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-recycled'))?.hidden)
      .toBe(true);
    await setTestValue(page, 'is_sustainable', 'true');
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-recycled'))?.hidden)
      .toBe(false);

    await save(page);
    await page.reload();
    await openEditor(page, draft);
    const { document } = await getVersion(page.request, draft.versionId);
    expect((objectOf(document, 'page-front', 'vd-size') as TextObject).bindings.content).toEqual({
      mode: 'EXPRESSION',
      expression: 'concat("SIZE ", size, " · ", currency, " ", formatNumber(price, 2))',
    });
    expect(objectOf(document, 'page-front', 'vd-recycled').bindings.visible).toEqual({
      mode: 'EXPRESSION',
      expression: 'is_sustainable == true',
    });
  });
});
