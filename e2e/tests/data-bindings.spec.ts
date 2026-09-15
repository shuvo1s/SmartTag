import { expect, test } from '@playwright/test';
import type { DesignDocument } from '@smarttag/document-schema';
import { createRectangleObject, mmToPt } from '@smarttag/document-utils';
import { E2E_WEB_URL } from '../environment.mjs';
import { TINY_PNG_BASE64 } from '../support/assets.ts';
import { getVersion, objectOf, openEditor, save } from '../support/editor.ts';
import {
  applyExpression,
  canvasDataDisplay,
  createVariableDataDraft,
  editorDocument,
  enableDataPreview,
  pickField,
  selectLayer,
  useTestRecord,
} from '../support/data.ts';
import { storageStatePath } from '../support/users.ts';
import { VARIABLE_DATA_RECORD } from '@smarttag/document-utils/fixtures';

test.use({ storageState: storageStatePath('designer') });

const ORIGIN = { origin: E2E_WEB_URL };

/** Adds an unbound rectangle and an unbound text to the variable-data document. */
function withPlainObjects(document: DesignDocument): DesignDocument {
  const front = document.pages[0]!;
  front.objects.push(
    createRectangleObject({
      id: 'vd-plain-box',
      name: 'Plain box',
      zIndex: 20,
      x: mmToPt(2),
      y: mmToPt(86),
      width: mmToPt(10),
      height: mmToPt(3),
    }),
  );
  return document;
}

test.describe('bindings — static, field and expression', () => {
  test('binds text content to a field and returns it to static without losing the sample text', async ({
    page,
  }) => {
    const draft = await createVariableDataDraft(page.request);
    await openEditor(page, draft);
    await page.getByTestId('page-tab-page-back').click();
    await selectLayer(page, 'vd-origin');
    const control = page.getByTestId('binding-control-content');
    await expect(control).toHaveAttribute('data-mode', 'EXPRESSION');

    await page.getByTestId('binding-mode-content-field').click();
    await pickField(page, 'content', 'country_of_origin');
    await expect(control).toHaveAttribute('data-mode', 'FIELD');
    await expect(page.getByTestId('field-picker-content-button')).toContainText(
      'country_of_origin',
    );
    await expect(
      page.getByTestId('layer-row-vd-origin').getByTestId('layer-bound'),
    ).toHaveAttribute('data-mode', 'FIELD');
    // The picker only offers compatible types: no image or yes/no fields for text.
    await page.getByTestId('field-picker-content-button').click();
    await page.getByTestId('field-picker-search').fill('');
    await expect(page.getByTestId('field-option-product_image')).toHaveCount(0);
    await expect(page.getByTestId('field-option-is_sustainable')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByTestId('binding-mode-content-static').click();
    await expect(control).toHaveAttribute('data-mode', 'STATIC');
    await expect(page.getByTestId('prop-text-content')).toHaveValue('MADE IN BANGLADESH');
    await page.getByTestId('binding-mode-content-field').click();
    await pickField(page, 'content', 'country_of_origin');
    await save(page);

    const { document } = await getVersion(page.request, draft.versionId);
    expect(objectOf(document, 'page-back', 'vd-origin')).toMatchObject({
      content: 'MADE IN BANGLADESH',
      bindings: { content: { mode: 'FIELD', field: 'country_of_origin' } },
    });
  });

  test('binds a new barcode to gtin and a QR code to an expression; persists after reload', async ({
    page,
  }) => {
    const draft = await createVariableDataDraft(page.request);
    await openEditor(page, draft);
    await page.getByTestId('tool-barcode').click();
    await page.getByTestId('binding-mode-value-field').click();
    await pickField(page, 'value', 'gtin');
    const barcodeId = (await editorDocument(page)).pages[0]!.objects.at(-1)!.id;

    await page.getByTestId('page-tab-page-back').click();
    await selectLayer(page, 'vd-qr');
    await applyExpression(page, 'value', 'concat("https://brand.com/product/", style)');
    // Without test data the preview uses sample values; style has no sample (it has a pattern).
    await expect(page.getByTestId('expression-result-value')).toHaveText(
      'https://brand.com/product/',
    );
    await expect(page.getByTestId('expression-preview-value')).toContainText('No value for style');
    await save(page);

    await page.reload();
    await openEditor(page, draft);
    const { document } = await getVersion(page.request, draft.versionId);
    expect(objectOf(document, 'page-front', barcodeId).bindings).toMatchObject({
      value: { mode: 'FIELD', field: 'gtin' },
    });
    expect(objectOf(document, 'page-back', 'vd-qr').bindings).toMatchObject({
      value: { mode: 'EXPRESSION', expression: 'concat("https://brand.com/product/", style)' },
    });

    await useTestRecord(page, { ...VARIABLE_DATA_RECORD });
    await enableDataPreview(page);
    await page.getByTestId('page-tab-page-front').click();
    await expect
      .poll(async () => (await canvasDataDisplay(page, barcodeId))?.object?.value)
      .toBe('9501234567891');
    await page.getByTestId('page-tab-page-back').click();
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-qr'))?.object?.value)
      .toBe('https://brand.com/product/YT-2045');
  });

  test('binds visibility to a field and to a condition; the canvas hides objects per record', async ({
    page,
  }) => {
    const draft = await createVariableDataDraft(page.request, withPlainObjects);
    await openEditor(page, draft);
    await selectLayer(page, 'vd-plain-box');
    await page.getByTestId('binding-mode-visible-field').click();
    await pickField(page, 'visible', 'is_sustainable');
    await expect(page.getByTestId('binding-control-visible')).toHaveAttribute('data-mode', 'FIELD');

    await useTestRecord(page, { ...VARIABLE_DATA_RECORD, is_sustainable: false, currency: 'CAD' });
    await enableDataPreview(page);
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-plain-box'))?.hidden)
      .toBe(true);
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-recycled'))?.hidden)
      .toBe(true);
    await page.getByTestId('panel-layers').click();
    await expect(
      page.getByTestId('layer-row-vd-recycled').getByTestId('layer-data-hidden'),
    ).toBeVisible();

    // Condition on another field with the same expression engine.
    await selectLayer(page, 'vd-plain-box');
    await page.getByTestId('binding-mode-visible-expression').click();
    await applyExpression(page, 'visible', 'currency == "CAD"');
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-plain-box'))?.hidden)
      .toBe(false);
    await expect(page.getByTestId('resolved-value-visible')).toContainText('visible');
    await save(page);
    const { document } = await getVersion(page.request, draft.versionId);
    expect(objectOf(document, 'page-front', 'vd-plain-box').bindings).toEqual({
      visible: { mode: 'EXPRESSION', expression: 'currency == "CAD"' },
    });
  });

  test('image source binds to an image field; own assets resolve, other organizations are refused', async ({
    page,
    browser,
  }) => {
    const upload = async (request: typeof page.request, name: string) => {
      const response = await request.post('/api/v1/assets', {
        headers: ORIGIN,
        multipart: {
          assetType: 'IMAGE',
          file: { name, mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_BASE64, 'base64') },
        },
      });
      expect(response.status(), await response.text()).toBe(201);
      return ((await response.json()) as { id: string }).id;
    };
    const own = await upload(page.request, 'own-product.png');
    const acme = await browser.newContext({
      storageState: storageStatePath('acmeAdmin'),
      baseURL: E2E_WEB_URL,
    });
    const foreign = await upload(acme.request, 'acme-product.png');
    await acme.close();

    const draft = await createVariableDataDraft(page.request);
    await openEditor(page, draft);
    await selectLayer(page, 'vd-product-image');
    await expect(page.getByTestId('binding-control-assetId')).toHaveAttribute('data-mode', 'FIELD');
    await expect(page.getByTestId('field-picker-assetId-button')).toContainText('product_image');

    await useTestRecord(page, { ...VARIABLE_DATA_RECORD, product_image: own });
    await enableDataPreview(page);
    await expect
      .poll(async () => (await canvasDataDisplay(page, 'vd-product-image'))?.object?.assetId)
      .toBe(own);
    await expect(page.getByTestId('production-valid')).toHaveAttribute('data-valid', 'true');

    await useTestRecord(page, { ...VARIABLE_DATA_RECORD, product_image: foreign });
    await expect(page.getByTestId('preview-issues')).toContainText(
      'not available in this organization',
    );
    await expect(page.getByTestId('production-valid')).toHaveAttribute('data-valid', 'false');
    // The server refuses the foreign asset too.
    const validation = await page.request.post(
      `/api/v1/template-versions/${draft.versionId}/data/validate`,
      { headers: ORIGIN, data: { record: { ...VARIABLE_DATA_RECORD, product_image: foreign } } },
    );
    expect(((await validation.json()) as { issues: { code: string }[] }).issues[0]?.code).toBe(
      'UNKNOWN_ASSET_REFERENCE',
    );
  });
});
