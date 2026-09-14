import { expect, test } from '@playwright/test';
import type { ArtworkObject } from '@smarttag/document-schema';
import {
  createBarcodeObject,
  createEllipseObject,
  createImageObject,
  createLineObject,
  createQrCodeObject,
  createRectangleObject,
  createTextObject,
  mmToPt,
} from '@smarttag/document-utils';
import {
  SAMPLE_BRAND_LOGO_ASSET_ID,
  SAMPLE_FONT_ASSET_IDS,
  createSampleHangTagDocument,
} from '@smarttag/document-utils/fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createDraft,
  drag,
  getVersion,
  objectCenter,
  objectOf,
  openEditor,
  save,
} from '../support/editor.ts';
import { storageStatePath } from '../support/users.ts';

test.use({ storageState: storageStatePath('designer') });

const OBJECT_COUNT = 120;

function representativeObjects(): ArtworkObject[] {
  const mm = mmToPt;
  const objects: ArtworkObject[] = [];
  for (let index = 0; index < OBJECT_COUNT; index += 1) {
    const frame = {
      id: `perf-${index}`,
      name: `Object ${index}`,
      x: mm(1 + (index % 6) * 8),
      y: mm(1 + Math.floor(index / 6) * 4.4),
      width: mm(7),
      height: mm(4),
      zIndex: index,
      rotation: index % 9 === 0 ? 10 : 0,
    };
    switch (index % 7) {
      case 0:
      case 1:
        objects.push(
          createTextObject({
            ...frame,
            content: `Item ${index} organic cotton`,
            fontSize: 4,
            fontAssetId: SAMPLE_FONT_ASSET_IDS.notoSansRegular,
            fontFamily: 'Noto Sans',
            fontWeight: 400,
          }),
        );
        break;
      case 2:
        objects.push(createRectangleObject({ ...frame, cornerRadius: 1 }));
        break;
      case 3:
        objects.push(
          index % 2 ? createEllipseObject(frame) : createLineObject({ ...frame, height: 0 }),
        );
        break;
      case 4:
        objects.push(createImageObject({ ...frame, assetId: SAMPLE_BRAND_LOGO_ASSET_ID }));
        break;
      case 5:
        objects.push(
          createBarcodeObject({
            ...frame,
            symbology: 'CODE128',
            value: `ST-${index}`,
            barHeight: mm(3),
            quietZone: 10,
          }),
        );
        break;
      default:
        objects.push(
          createQrCodeObject({ ...frame, width: mm(4), value: `https://example.com/${index}` }),
        );
    }
  }
  return objects;
}

test('stays responsive with 120 artwork objects', async ({ page }) => {
  test.setTimeout(120_000);
  const draft = await createDraft(page.request, (templateId) => {
    const base = createSampleHangTagDocument({ documentId: templateId });
    return {
      ...base,
      pages: [{ ...base.pages[0]!, groups: [], objects: representativeObjects() }, base.pages[1]!],
    };
  });

  const navigationStart = Date.now();
  await openEditor(page, draft);
  await expect(page.getByTestId('layers-panel').getByRole('option')).toHaveCount(OBJECT_COUNT);
  const openMs = Date.now() - navigationStart;
  const mountMs = await page.evaluate(
    () => performance.getEntriesByName('st-editor-canvas-mount')[0]?.duration ?? -1,
  );

  // Frame rate while dragging an object continuously for ~1 second.
  const target = objectOf(
    (await getVersion(page.request, draft.versionId)).document,
    'page-front',
    'perf-60',
  );
  const center = await objectCenter(page, target);
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __counting: boolean };
    w.__frames = 0;
    w.__counting = true;
    const tick = () => {
      if (!w.__counting) return;
      w.__frames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const dragStart = Date.now();
  await page.keyboard.down('Alt');
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  for (let step = 1; step <= 60; step += 1) {
    await page.mouse.move(center.x + step * 2, center.y + Math.sin(step / 6) * 20);
  }
  const dragMs = Date.now() - dragStart;
  const commitStart = Date.now();
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'UNSAVED');
  const commitMs = Date.now() - commitStart;
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __counting: boolean };
    w.__counting = false;
    return w.__frames;
  });
  const fps = (frames / dragMs) * 1000;

  const saveStart = Date.now();
  await save(page);
  const saveMs = Date.now() - saveStart;

  // Keyboard edits on a crowded page.
  await page.getByTestId('layer-row-perf-10').click();
  const nudgeStart = Date.now();
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'UNSAVED');
  const tenNudgesMs = Date.now() - nudgeStart;

  const report = {
    objects: OBJECT_COUNT,
    browser: 'Chromium (Playwright, headless)',
    editorOpenMs: openMs,
    canvasMountMs: Math.round(mountMs),
    dragDurationMs: dragMs,
    dragFramesPerSecond: Math.round(fps),
    gestureCommitMs: commitMs,
    saveMs,
    tenKeyboardNudgesMs: tenNudgesMs,
  };
  const directory = resolve(import.meta.dirname, '..', 'test-results');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, 'editor-performance.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const moved = objectOf(
    (await getVersion(page.request, draft.versionId)).document,
    'page-front',
    'perf-60',
  );
  expect(moved.x).toBeGreaterThan(target.x);
  expect(openMs).toBeLessThan(15_000);
  expect(mountMs).toBeLessThan(3_000);
  expect(fps).toBeGreaterThan(20);
  expect(commitMs).toBeLessThan(2_000);
  void drag;
});
