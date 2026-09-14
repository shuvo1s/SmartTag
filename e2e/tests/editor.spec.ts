import { expect, test } from '@playwright/test';
import { computeDocumentHash, mmToPt } from '@smarttag/document-utils';
import { SAMPLE_BRAND_LOGO_ASSET_ID } from '@smarttag/document-utils/fixtures';
import {
  createDraft,
  darkPixelsIn,
  drag,
  getVersion,
  objectCenter,
  objectOf,
  openEditor,
  save,
  screenPoint,
} from '../support/editor.ts';
import { storageStatePath } from '../support/users.ts';

test.use({ storageState: storageStatePath('designer') });

test.describe('designer — core workflows', () => {
  test('loads a draft with controlled fonts, guides, real symbols and data-bound layers', async ({
    page,
  }) => {
    const draft = await createDraft(page.request);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openEditor(page, draft);

    await expect(page.getByTestId('layers-panel').getByRole('option')).toHaveCount(9);
    await expect(
      page.getByTestId('layer-row-front-product-name').getByTestId('layer-bound'),
    ).toBeVisible();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'SAVED');

    // The EAN-13 is drawn as bars, not a placeholder.
    const { document } = await getVersion(page.request, draft.versionId);
    const barcode = objectOf(document, 'page-front', 'front-barcode');
    await expect.poll(() => darkPixelsIn(page, barcode)).toBeGreaterThan(400);

    // Selecting text shows exact geometry in mm and the loaded production font.
    await page.getByTestId('layer-row-front-product-name').click();
    await expect(page.getByTestId('prop-x')).toHaveValue('4');
    await expect(page.getByTestId('prop-width')).toHaveValue('42');
    await expect(page.getByTestId('binding-indicators')).toContainText('product_name');
    await expect(page.getByTestId('font-status')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('adds text, types content, saves and keeps it after reload', async ({ page }) => {
    const draft = await createDraft(page.request);
    await openEditor(page, draft);
    await page.getByTestId('tool-text').click();
    const content = page.getByTestId('prop-text-content');
    await content.fill('Hello SmartTag — বাংলা');
    await save(page);

    await page.reload();
    await openEditor(page, draft);
    const { document } = await getVersion(page.request, draft.versionId);
    const added = document.pages[0]!.objects.find(
      (object) => object.type === 'text' && object.content === 'Hello SmartTag — বাংলা',
    );
    expect(added).toBeDefined();
    expect(added!.id).toMatch(/^txt_/);
    await page.getByTestId(`layer-row-${added!.id}`).click();
    await expect(page.getByTestId('prop-text-content')).toHaveValue('Hello SmartTag — বাংলা');
  });

  test('moves an object by dragging and persists normalized geometry', async ({ page }) => {
    const draft = await createDraft(page.request);
    await openEditor(page, draft);
    const before = objectOf(
      (await getVersion(page.request, draft.versionId)).document,
      'page-front',
      'front-logo',
    );
    const center = await objectCenter(page, before);
    await drag(page, center, { x: center.x + 60, y: center.y + 30 }, { noSnap: true });
    await expect(page.getByTestId('save-status')).not.toHaveAttribute('data-status', 'SAVED');
    await save(page);

    const after = objectOf(
      (await getVersion(page.request, draft.versionId)).document,
      'page-front',
      'front-logo',
    );
    expect(after.x - before.x).toBeCloseTo(60 / center.scale, 0);
    expect(after.y - before.y).toBeCloseTo(30 / center.scale, 0);
    expect(after.width).toBe(before.width);
    expect(String(after.x).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4);

    await page.reload();
    await openEditor(page, draft);
    await page.getByTestId('layer-row-front-logo').click();
    await expect(page.getByTestId('prop-x')).toHaveValue(
      String(Number(((after.x / 72) * 25.4).toFixed(2))),
    );
  });

  test('resizes a shape with a corner handle and persists the new size', async ({ page }) => {
    const draft = await createDraft(page.request);
    await openEditor(page, draft);
    await page.getByTestId('tool-rectangle').click();
    await save(page);
    const document = (await getVersion(page.request, draft.versionId)).document;
    const rectangle = document.pages[0]!.objects.find(
      (object) => object.type === 'rectangle' && object.name === 'Rectangle',
    )!;
    const corner = await screenPoint(
      page,
      rectangle.x + rectangle.width,
      rectangle.y + rectangle.height,
    );
    await drag(page, corner, { x: corner.x + 50, y: corner.y + 25 }, { noSnap: true });
    await save(page);
    const resized = objectOf(
      (await getVersion(page.request, draft.versionId)).document,
      'page-front',
      rectangle.id,
    );
    expect(resized.width).toBeGreaterThan(rectangle.width + 20 / corner.scale);
    expect(resized.height).toBeGreaterThan(rectangle.height + 10 / corner.scale);
    expect(resized.rotation).toBe(0);
  });

  test('changes layer order and persists it as canonical zIndex', async ({ page }) => {
    const draft = await createDraft(page.request);
    await openEditor(page, draft);
    await page.getByTestId('layer-row-front-band').click();
    await page.getByTestId('layer-front').click();
    await expect(page.getByTestId('layers-panel').getByRole('option').first()).toHaveAttribute(
      'data-testid',
      'layer-row-front-band',
    );
    await save(page);
    const { document } = await getVersion(page.request, draft.versionId);
    const front = document.pages[0]!;
    const top = [...front.objects].sort((a, b) => b.zIndex - a.zIndex)[0]!;
    expect(top.id).toBe('front-band');
    expect(front.objects.map((object) => object.zIndex)).toEqual(
      front.objects.map((_, index) => index),
    );

    await page.reload();
    await openEditor(page, draft);
    await expect(page.getByTestId('layers-panel').getByRole('option').first()).toHaveAttribute(
      'data-testid',
      'layer-row-front-band',
    );
    // Keyboard: Alt+Down moves to the next layer (selection follows) without nudging anything.
    const options = page.getByTestId('layers-panel').getByRole('option');
    await options.first().click();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(options.nth(1)).toBeFocused();
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(options.first()).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'SAVED');
  });

  test('locked objects cannot be moved, nudged or deleted on the canvas', async ({ page }) => {
    const draft = await createDraft(page.request);
    await openEditor(page, draft);
    const logo = objectOf(
      (await getVersion(page.request, draft.versionId)).document,
      'page-front',
      'front-logo',
    );
    await page.getByTestId('layer-row-front-logo').hover();
    await page.getByTestId('layer-lock-front-logo').click();
    await save(page);
    const revision = (await getVersion(page.request, draft.versionId)).revision;

    const center = await objectCenter(page, logo);
    await drag(page, center, { x: center.x + 80, y: center.y + 40 }, { noSnap: true });
    await page.getByTestId('layer-row-front-logo').click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('prop-x')).toBeDisabled();
    await expect(page.getByTestId('layer-row-front-logo')).toBeVisible();

    const after = await getVersion(page.request, draft.versionId);
    expect(after.revision).toBe(revision);
    await page.getByTestId('save-button').click();
    const saved = objectOf(
      (await getVersion(page.request, draft.versionId)).document,
      'page-front',
      'front-logo',
    );
    expect({ x: saved.x, y: saved.y, locked: saved.locked }).toEqual({
      x: logo.x,
      y: logo.y,
      locked: true,
    });
  });

  test('edits front and back independently', async ({ page }) => {
    const draft = await createDraft(page.request);
    const original = (await getVersion(page.request, draft.versionId)).document;
    await openEditor(page, draft);
    await page.getByTestId('layer-row-front-price').click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.getByTestId('page-tab-page-back').click();
    await expect(page.getByTestId('layer-row-back-qr')).toBeVisible();
    await expect(page.getByTestId('layer-row-front-price')).toHaveCount(0);
    await page.getByTestId('layer-row-back-style').click();
    await page.keyboard.press('Shift+ArrowRight');
    await save(page);

    const { document } = await getVersion(page.request, draft.versionId);
    const moved = (pageId: string, id: string) => objectOf(document, pageId, id);
    const was = (pageId: string, id: string) => objectOf(original, pageId, id);
    expect(moved('page-front', 'front-price').y).toBeCloseTo(
      was('page-front', 'front-price').y + mmToPt(1),
      3,
    );
    expect(moved('page-front', 'front-price').x).toBe(was('page-front', 'front-price').x);
    expect(moved('page-back', 'back-style').x).toBeCloseTo(
      was('page-back', 'back-style').x + mmToPt(1),
      3,
    );
    expect(moved('page-back', 'back-color')).toEqual(was('page-back', 'back-color'));
  });

  test('undo and redo one logical step each', async ({ page }) => {
    const draft = await createDraft(page.request);
    await openEditor(page, draft);
    await page.getByTestId('tool-ellipse').click();
    await expect(page.getByTestId('layers-panel').getByRole('option')).toHaveCount(10);
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('layers-panel').getByRole('option')).toHaveCount(9);
    await page.getByTestId('redo').click();
    await expect(page.getByTestId('layers-panel').getByRole('option')).toHaveCount(10);
    await page.getByTestId('editor-root').focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('layers-panel').getByRole('option')).toHaveCount(9);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'SAVED');
  });

  test('places a permitted image asset by reference, never as embedded data', async ({ page }) => {
    const draft = await createDraft(page.request);
    await openEditor(page, draft);
    await page.getByTestId('tool-image').click();
    await expect(page.getByTestId('asset-picker')).toBeVisible();
    await page.getByTestId('asset-search').fill('demo-active');
    await page.getByTestId(`asset-item-${SAMPLE_BRAND_LOGO_ASSET_ID}`).click();
    await expect(page.getByTestId('effective-ppi')).toContainText('Vector artwork');
    await save(page);
    const { document } = await getVersion(page.request, draft.versionId);
    const images = document.pages[0]!.objects.filter((object) => object.type === 'image');
    expect(images).toHaveLength(2);
    const inserted = images.find((image) => image.id !== 'front-logo')!;
    expect(inserted).toMatchObject({ assetId: SAMPLE_BRAND_LOGO_ASSET_ID, fitMode: 'CONTAIN' });
    expect(JSON.stringify(document)).not.toContain('base64');
  });

  test('inserts and renders a barcode, validating values centrally', async ({ page }) => {
    const draft = await createDraft(page.request);
    await openEditor(page, draft);
    await page.getByTestId('tool-barcode').click();
    await expect(page.getByTestId('prop-symbology')).toHaveValue('EAN13');
    await save(page);
    const document = (await getVersion(page.request, draft.versionId)).document;
    const barcode = document.pages[0]!.objects.find(
      (object) => object.type === 'barcode' && object.name === 'Barcode',
    )!;
    await expect.poll(() => darkPixelsIn(page, barcode)).toBeGreaterThan(300);

    await page.getByTestId('prop-barcode-value').fill('4006381333932');
    await expect(page.getByTestId('barcode-validation')).toContainText('Check digit should be 1');
    await page.getByTestId('prop-symbology').selectOption('CODE128');
    await page.getByTestId('prop-barcode-value').fill('ST-1001');
    await expect(page.getByTestId('barcode-validation')).toHaveCount(0);
    await save(page);
    const saved = objectOf(
      (await getVersion(page.request, draft.versionId)).document,
      'page-front',
      barcode.id,
    );
    expect(saved).toMatchObject({ type: 'barcode', symbology: 'CODE128', value: 'ST-1001' });
  });

  test('inserts and renders a QR code from its data and settings', async ({ page }) => {
    const draft = await createDraft(page.request);
    await openEditor(page, draft);
    await page.getByTestId('tool-qrCode').click();
    await page.getByTestId('prop-qr-value').fill('https://smarttag.example/p/1');
    await page.getByTestId('prop-qr-ecc').selectOption('H');
    await save(page);
    const document = (await getVersion(page.request, draft.versionId)).document;
    const qr = document.pages[0]!.objects.find((object) => object.type === 'qrCode')!;
    expect(qr).toMatchObject({ value: 'https://smarttag.example/p/1', errorCorrection: 'H' });
    await expect.poll(() => darkPixelsIn(page, qr)).toBeGreaterThan(200);
  });

  test('duplicate, copy/paste, nudge and delete through keyboard shortcuts', async ({ page }) => {
    const draft = await createDraft(page.request);
    await openEditor(page, draft);
    await page.getByTestId('layer-row-front-size').click();
    await page.getByTestId('editor-root').focus();
    await page.keyboard.press('Control+d');
    await expect(page.getByTestId('layers-panel').getByRole('option')).toHaveCount(10);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(page.getByTestId('layers-panel').getByRole('option')).toHaveCount(11);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('layers-panel').getByRole('option')).toHaveCount(10);
    await save(page);
    const { document } = await getVersion(page.request, draft.versionId);
    const sizes = document.pages[0]!.objects.filter(
      (object) => object.type === 'text' && object.content === 'M',
    );
    expect(sizes).toHaveLength(2);
    expect(new Set(sizes.map((object) => object.id)).size).toBe(2);
    const copy = sizes.find((object) => object.id !== 'front-size')!;
    expect(copy.id).toMatch(/^txt_/);
    expect(copy.type === 'text' && copy.bindings.content).toEqual({ mode: 'FIELD', field: 'size' });
  });

  test('aligns and distributes several objects', async ({ page }) => {
    const draft = await createDraft(page.request);
    await openEditor(page, draft);
    await page.getByTestId('layer-row-front-size-label').click();
    await page.getByTestId('layer-row-front-currency').click({ modifiers: ['Shift'] });
    await page.getByTestId('layer-row-front-divider').click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('multi-selection')).toContainText('3 objects selected');
    await page.getByTestId('align-top').click();
    await save(page);
    const { document } = await getVersion(page.request, draft.versionId);
    const tops = ['front-size-label', 'front-currency', 'front-divider'].map(
      (id) => objectOf(document, 'page-front', id).y,
    );
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(0.001);
  });

  test('snaps a dragged object to the page centre', async ({ page }) => {
    const draft = await createDraft(page.request);
    await openEditor(page, draft);
    const document = (await getVersion(page.request, draft.versionId)).document;
    const logo = objectOf(document, 'page-front', 'front-logo');
    const center = await objectCenter(page, logo);
    await drag(page, center, { x: center.x + 3, y: center.y + 40 });
    await save(page);
    const moved = objectOf(
      (await getVersion(page.request, draft.versionId)).document,
      'page-front',
      'front-logo',
    );
    expect(moved.x + moved.width / 2).toBeCloseTo(document.dimensions.width / 2, 3);
    expect(moved.y).not.toBeCloseTo(logo.y, 1);
  });

  test('zooming and panning never change the document, and a no-op save keeps the hash', async ({
    page,
  }) => {
    const draft = await createDraft(page.request);
    const before = await getVersion(page.request, draft.versionId);
    await openEditor(page, draft);
    await page.getByTestId('zoom-in').click();
    await page.getByTestId('zoom-in').click();
    await page.getByTestId('zoom-out').click();
    await page.getByTestId('zoom-100').click();
    const canvasBox = (await page.getByTestId('editor-canvas').boundingBox())!;
    await page.mouse.move(canvasBox.x + 200, canvasBox.y + 200);
    await page.mouse.wheel(0, 120);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await page.getByTestId('zoom-fit').click();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'SAVED');
    await page.getByTestId('save-button').click();
    const after = await getVersion(page.request, draft.versionId);
    expect(after.revision).toBe(before.revision);
    expect(after.documentHash).toBe(before.documentHash);
    expect(await computeDocumentHash(after.document)).toBe(before.documentHash);
  });

  test('preview renders from the canonical document and compare overlays the renderer', async ({
    page,
  }) => {
    const draft = await createDraft(page.request);
    await openEditor(page, draft);
    await page.getByTestId('toggle-preview').click();
    const preview = page.getByTestId('canonical-preview');
    await expect(preview.locator('svg[data-page-side="FRONT"]')).toBeVisible();
    await expect(preview.locator('[data-symbol="bars"]')).toHaveCount(1);
    await expect(preview.locator('[data-guide]')).toHaveCount(0);
    // Every text in the draft uses a registered font that loaded: no substitute is reported.
    await expect(preview.locator('text').first()).toBeVisible();
    await expect(preview.locator('text[data-font-substitute]')).toHaveCount(0);
    await expect(page.getByTestId('font-availability-notice')).toHaveCount(0);
    await page.getByTestId('toggle-compare').click();
    // The page SVG is the direct child; placed SVG assets nest further <svg> elements inside it.
    const overlay = page.getByTestId('compare-overlay');
    await expect(overlay.locator(':scope > svg[data-page-side="FRONT"]')).toBeVisible();
    await expect(overlay).toHaveCSS('mix-blend-mode', 'difference');
    await expect(overlay.locator('[data-symbol="bars"]')).toHaveCount(1);
    await expect(overlay.locator('[data-guide]')).toHaveCount(0);
  });
});
