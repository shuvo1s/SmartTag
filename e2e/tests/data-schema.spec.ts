import { expect, test, type Page } from '@playwright/test';
import type { DesignDocument, TextObject } from '@smarttag/document-schema';
import { createBlankTemplate, getVersion, objectOf, openEditor, save } from '../support/editor.ts';
import { createVariableDataDraft, editorDocument, openDataPanel } from '../support/data.ts';
import { storageStatePath } from '../support/users.ts';

test.use({ storageState: storageStatePath('designer') });

async function fillFieldDialog(
  page: Page,
  values: { displayName: string; key?: string; type?: string; required?: boolean },
) {
  await page.getByTestId('field-display-name').fill(values.displayName);
  if (values.key !== undefined) await page.getByTestId('field-key').fill(values.key);
  if (values.type) await page.getByTestId('field-type').selectOption(values.type);
  if (values.required) await page.getByTestId('field-required').check();
}

const fieldsOf = (document: DesignDocument) => document.dataSchema.fields.map((field) => field.key);

test.describe('data schema — fields', () => {
  test('creates, edits and deletes fields; refuses duplicate and dangerous keys; persists after reload', async ({
    page,
  }) => {
    const draft = await createBlankTemplate(page.request);
    await openEditor(page, draft);
    await openDataPanel(page);
    await expect(page.getByTestId('data-panel')).toContainText('no data fields yet');

    // A required string field; the key follows the display name.
    await page.getByTestId('add-field').click();
    await fillFieldDialog(page, { displayName: 'Product Name', required: true });
    await expect(page.getByTestId('field-key')).toHaveValue('product_name');
    await page.getByTestId('rule-max-length').fill('60');
    await page.getByTestId('field-save').click();
    await expect(page.getByTestId('data-field-row-product_name')).toContainText('Required');

    // A decimal field with min/max rules.
    await page.getByTestId('add-field').click();
    await fillFieldDialog(page, { displayName: 'Retail Price', type: 'decimal' });
    await page.getByTestId('rule-min').fill('0.01');
    await page.getByTestId('rule-max').fill('9999.99');
    await page.getByTestId('field-save').click();
    await expect(page.getByTestId('data-field-row-retail_price')).toContainText('Decimal');

    // Duplicate and dangerous keys are refused with an explanation.
    await page.getByTestId('add-field').click();
    await fillFieldDialog(page, { displayName: 'Duplicate', key: 'product_name' });
    await expect(page.getByTestId('field-dialog-error')).toContainText('already exists');
    await expect(page.getByTestId('field-save')).toBeDisabled();
    for (const [key, message] of [
      ['__proto__', 'reserved for system fields'],
      ['constructor', 'reserved'],
      ['prototype', 'reserved'],
      ['Product Name', 'lowercase letter'],
    ] as const) {
      await page.getByTestId('field-key').fill(key);
      await expect(page.getByTestId('field-dialog-error')).toContainText(message);
      await expect(page.getByTestId('field-save')).toBeDisabled();
    }
    // Invalid rules and defaults are explained too.
    await page.getByTestId('field-key').fill('code');
    await page.getByTestId('rule-pattern').fill('(a)\\1');
    await expect(page.getByTestId('field-dialog-error')).toContainText('Back-references');
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Edit the display name; the key stays stable.
    await page.getByTestId('edit-field-retail_price').click();
    await page.getByTestId('field-display-name').fill('Price (retail)');
    await expect(page.getByTestId('field-key')).toHaveValue('retail_price');
    await page.getByTestId('field-save').click();
    await expect(page.getByTestId('data-field-row-retail_price')).toContainText('Price (retail)');

    // An unused field is deleted directly.
    await page.getByTestId('add-field').click();
    await fillFieldDialog(page, { displayName: 'Temporary' });
    await page.getByTestId('field-save').click();
    await page.getByTestId('delete-field-temporary').click();
    await expect(page.getByTestId('delete-field-dialog')).toContainText(
      'No artwork uses this field',
    );
    await page.getByTestId('confirm-delete-field').click();
    await expect(page.getByTestId('data-field-row-temporary')).toHaveCount(0);

    await save(page);
    await page.reload();
    await openEditor(page, draft);
    await openDataPanel(page);
    await expect(page.getByTestId('data-field-row-product_name')).toBeVisible();
    await expect(page.getByTestId('data-field-row-retail_price')).toContainText('Price (retail)');
    const { document, schemaVersion } = await getVersion(page.request, draft.versionId);
    expect(schemaVersion).toBe(3);
    expect(fieldsOf(document)).toEqual(['product_name', 'retail_price']);
    expect(document.dataSchema.fields[1]).toMatchObject({
      type: 'decimal',
      displayName: 'Price (retail)',
      validation: { min: '0.01', max: '9999.99', allowedValues: null },
    });
  });

  test('a used field cannot disappear silently; confirming returns bindings to static values (undoable)', async ({
    page,
  }) => {
    const draft = await createVariableDataDraft(page.request);
    await openEditor(page, draft);
    await openDataPanel(page);

    await expect(page.getByTestId('field-usage-size')).toHaveText('Used by 2');
    await page.getByTestId('field-usage-size').click();
    await expect(page.getByTestId('field-usages-size')).toContainText('Front / Size / Content');
    await expect(page.getByTestId('field-usages-size')).toContainText('Front / SKU code / Content');

    await page.getByTestId('delete-field-size').click();
    await expect(page.getByTestId('delete-field-usage-warning')).toContainText(
      'used by 2 design properties',
    );
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('data-field-row-size')).toBeVisible();

    await page.getByTestId('delete-field-size').click();
    await expect(page.getByTestId('confirm-delete-field')).toHaveText(
      'Remove 2 bindings and delete',
    );
    await page.getByTestId('confirm-delete-field').click();
    await expect(page.getByTestId('data-field-row-size')).toHaveCount(0);
    let document = await editorDocument(page);
    expect(fieldsOf(document)).not.toContain('size');
    expect(objectOf(document, 'page-front', 'vd-size').bindings).toMatchObject({
      content: { mode: 'STATIC' },
    });

    await page.getByTestId('undo').click();
    await expect(page.getByTestId('data-field-row-size')).toBeVisible();
    document = await editorDocument(page);
    expect((objectOf(document, 'page-front', 'vd-size') as TextObject).bindings.content).toEqual({
      mode: 'EXPRESSION',
      expression: 'concat("SIZE: ", size)',
    });
  });

  test('renaming a key updates every binding and expression atomically and persists', async ({
    page,
  }) => {
    const draft = await createVariableDataDraft(page.request);
    await openEditor(page, draft);
    await openDataPanel(page);

    await page.getByTestId('edit-field-size').click();
    await expect(page.getByTestId('field-type')).toBeDisabled();
    await expect(page.getByTestId('type-locked-hint')).toBeVisible();
    await page.getByTestId('field-key').fill('item_size');
    await expect(page.getByTestId('rename-warning')).toHaveText(
      'This field is used by 2 design properties. Renaming it will update all 2 bindings.',
    );
    await page.getByTestId('field-save').click();
    await expect(page.getByTestId('data-field-row-item_size')).toBeVisible();
    await expect(page.getByTestId('field-usage-item_size')).toHaveText('Used by 2');
    await save(page);

    const { document } = await getVersion(page.request, draft.versionId);
    expect(fieldsOf(document)).toContain('item_size');
    expect(fieldsOf(document)).not.toContain('size');
    expect((objectOf(document, 'page-front', 'vd-sku') as TextObject).bindings.content).toEqual({
      mode: 'EXPRESSION',
      expression: 'upper(concat(style, "-", color, "-", item_size))',
    });

    // One undo step restores the old key and every reference.
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('data-field-row-size')).toBeVisible();
    const restored = await editorDocument(page);
    expect((objectOf(restored, 'page-front', 'vd-size') as TextObject).bindings.content).toEqual({
      mode: 'EXPRESSION',
      expression: 'concat("SIZE: ", size)',
    });
  });

  test('dragging a field onto the artboard creates text bound to it; field usage selects artwork', async ({
    page,
  }) => {
    const draft = await createVariableDataDraft(page.request);
    await openEditor(page, draft);
    await openDataPanel(page);
    const before = (await editorDocument(page)).pages[0]!.objects.length;

    await page.getByTestId('data-field-row-gtin').dragTo(page.getByTestId('editor-canvas'));
    await expect
      .poll(async () => (await editorDocument(page)).pages[0]!.objects.length)
      .toBe(before + 1);
    const document = await editorDocument(page);
    const added = document.pages[0]!.objects.at(-1)!;
    // A GTIN field still creates text: users choose Barcode explicitly.
    expect(added).toMatchObject({
      type: 'text',
      name: 'GTIN',
      bindings: { content: { mode: 'FIELD', field: 'gtin' } },
    });
    await expect(page.getByTestId('field-usage-gtin')).toHaveText('Used by 2');

    await page.getByTestId('field-usage-price').click();
    await page.getByTestId('field-usages-price').getByTestId('field-usage-entry').first().click();
    await expect(page.getByTestId('object-properties')).toHaveAttribute(
      'data-object-id',
      'vd-price',
    );
  });
});
