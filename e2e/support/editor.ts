import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { ArtworkObject, DesignDocument } from '@smarttag/document-schema';
import { createSampleHangTagDocument } from '@smarttag/document-utils/fixtures';
import type { TemplateDto, TemplateVersionDetailDto } from '@smarttag/shared-types';
import { E2E_WEB_URL } from '../environment.mjs';

const ORIGIN = { origin: E2E_WEB_URL };
let counter = 0;

export interface Draft {
  readonly template: TemplateDto;
  readonly versionId: string;
}

/** Creates an isolated template whose draft holds the sample hang tag (or a custom document). */
export async function createDraft(
  request: APIRequestContext,
  build: (templateId: string) => DesignDocument = (templateId) =>
    createSampleHangTagDocument({ documentId: templateId }),
): Promise<Draft> {
  counter += 1;
  const code = `E2E-${Date.now().toString(36).toUpperCase()}-${counter}`;
  const created = await request.post('/api/v1/templates', {
    headers: ORIGIN,
    data: {
      name: `E2E ${code}`,
      code,
      documentType: 'HANG_TAG',
      dimensions: { unit: 'mm', width: 50, height: 90, bleed: 3, safeMargin: 3 },
      pageLayout: 'FRONT_AND_BACK',
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const template = (await created.json()) as TemplateDto;
  const versionId = template.currentVersion!.id;
  const patched = await request.patch(`/api/v1/template-versions/${versionId}`, {
    headers: ORIGIN,
    data: { document: build(template.id), expectedRevision: 1 },
  });
  expect(patched.status(), await patched.text()).toBe(200);
  return { template, versionId };
}

/** Creates a template through the API exactly as the New template form does: blank v1 draft. */
export async function createBlankTemplate(
  request: APIRequestContext,
  options: {
    pageLayout?: 'FRONT_ONLY' | 'FRONT_AND_BACK';
    dimensions?: { unit: 'mm'; width: number; height: number; bleed: number; safeMargin: number };
  } = {},
): Promise<Draft> {
  counter += 1;
  const code = `E2E-BLANK-${Date.now().toString(36).toUpperCase()}-${counter}`;
  const created = await request.post('/api/v1/templates', {
    headers: ORIGIN,
    data: {
      name: `E2E blank ${code}`,
      code,
      documentType: 'HANG_TAG',
      dimensions: options.dimensions ?? {
        unit: 'mm',
        width: 50,
        height: 90,
        bleed: 3,
        safeMargin: 3,
      },
      pageLayout: options.pageLayout ?? 'FRONT_AND_BACK',
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const template = (await created.json()) as TemplateDto;
  return { template, versionId: template.currentVersion!.id };
}

export async function getVersion(
  request: APIRequestContext,
  versionId: string,
): Promise<TemplateVersionDetailDto & { document: DesignDocument }> {
  const response = await request.get(`/api/v1/template-versions/${versionId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as TemplateVersionDetailDto & { document: DesignDocument };
}

export function objectOf(
  document: DesignDocument,
  pageId: string,
  objectId: string,
): ArtworkObject {
  const object = document.pages
    .find((page) => page.id === pageId)
    ?.objects.find((o) => o.id === objectId);
  if (!object) throw new Error(`Object ${objectId} not found on ${pageId}`);
  return object;
}

export async function openEditor(
  page: Page,
  draft: { template: { id: string }; versionId: string },
) {
  await page.addInitScript(() => window.localStorage.setItem('smarttag:editor-diagnostics', '1'));
  await page.goto(`/templates/${draft.template.id}/versions/${draft.versionId}/edit`);
  await waitForEditor(page);
}

/** Waits until the designer on the current page has loaded and fitted the page. */
export async function waitForEditor(page: Page) {
  await expect(page.getByTestId('editor-canvas')).toBeVisible();
  await expect(page.getByTestId('layers-panel')).toBeVisible();
  // Wait until the canvas has fitted the page (viewport attributes set).
  await expect
    .poll(async () => Number(await page.getByTestId('editor-canvas').getAttribute('data-zoom')))
    .not.toBe(1);
}

/** Screen position (CSS px) of a trim-space point, from the canvas viewport attributes. */
export async function screenPoint(page: Page, xPt: number, yPt: number) {
  const canvas = page.getByTestId('editor-canvas');
  const box = (await canvas.boundingBox())!;
  const zoom = Number(await canvas.getAttribute('data-zoom'));
  const panX = Number(await canvas.getAttribute('data-pan-x'));
  const panY = Number(await canvas.getAttribute('data-pan-y'));
  const scale = zoom * (96 / 72);
  return { x: box.x + xPt * scale + panX, y: box.y + yPt * scale + panY, scale };
}

export async function objectCenter(page: Page, object: ArtworkObject) {
  return screenPoint(page, object.x + object.width / 2, object.y + object.height / 2);
}

/** Drags with intermediate steps, holding Alt to bypass snapping when requested. */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { noSnap?: boolean; steps?: number } = {},
) {
  if (options.noSnap) await page.keyboard.down('Alt');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: options.steps ?? 12 });
  await page.mouse.up();
  if (options.noSnap) await page.keyboard.up('Alt');
}

export async function save(page: Page) {
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'SAVED');
}

/** Counts dark pixels of the rendered canvas inside a trim-space rectangle. */
export async function darkPixelsIn(
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
) {
  const topLeft = await screenPoint(page, rect.x, rect.y);
  const bottomRight = await screenPoint(page, rect.x + rect.width, rect.y + rect.height);
  return page.evaluate(
    ({ left, top, right, bottom }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="editor-canvas"] canvas.lower-canvas, [data-testid="editor-canvas"] canvas',
      );
      if (!canvas) return -1;
      const bounds = canvas.getBoundingClientRect();
      const ratio = canvas.width / bounds.width;
      const context = canvas.getContext('2d');
      if (!context) return -1;
      const x = Math.round((left - bounds.left) * ratio);
      const y = Math.round((top - bounds.top) * ratio);
      const width = Math.max(1, Math.round((right - left) * ratio));
      const height = Math.max(1, Math.round((bottom - top) * ratio));
      const data = context.getImageData(x, y, width, height).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! < 60 && data[i + 1]! < 60 && data[i + 2]! < 60) dark += 1;
      }
      return dark;
    },
    { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y },
  );
}

/** Canvas diagnostics (enabled by openEditor through a localStorage flag). */
export async function canvasDebug(page: Page, objectId: string) {
  return page.evaluate((id) => {
    const editor = (
      window as unknown as {
        __smarttagEditor?: {
          store: { getState(): { changeCount: number; selection: string[]; interacting: boolean } };
          canvas: {
            fabric: { _offset: unknown; viewportTransform: number[] };
            getFabricObject(id: string): { left: number; top: number } | undefined;
            getViewport(): unknown;
          };
        };
      }
    ).__smarttagEditor;
    if (!editor) return null;
    const object = editor.canvas.getFabricObject(id);
    return {
      offset: editor.canvas.fabric._offset,
      vpt: editor.canvas.fabric.viewportTransform,
      viewport: editor.canvas.getViewport(),
      fabric: object ? { left: object.left, top: object.top } : null,
      state: editor.store.getState().changeCount,
      selection: editor.store.getState().selection,
      interacting: editor.store.getState().interacting,
    };
  }, objectId);
}
