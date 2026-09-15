import { buildDataPreview, type DataPreview } from '@smarttag/data-core';
import { parseDesignDocument, type DesignDocument } from '@smarttag/document-schema';
import { computeDocumentHash, createDataField, expressionBinding } from '@smarttag/document-utils';
import {
  SAMPLE_HANG_TAG_V2_JSON,
  VARIABLE_DATA_RECORD,
  createLargeVariableDataDocument,
  createVariableDataHangTagDocument,
} from '@smarttag/document-utils/fixtures';
import { findPage, setObjectFrames, setPropertyBinding } from '@smarttag/editor-core';
import { describe, expect, it } from 'vitest';
import type { CanvasDataPreview } from '../src';
import { mountCanvas } from './helpers';

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function readBackDocument(
  document: DesignDocument,
  preview?: (d: DesignDocument) => CanvasDataPreview,
) {
  const { store, canvas } = mountCanvas(document);
  if (preview) canvas.setDataPreview(preview(document));
  const pages = document.pages.map((page) => {
    store.setActivePage(page.id);
    canvas.fabric.renderAll();
    return canvas.readPage();
  });
  canvas.dispose();
  return { ...document, pages };
}

/** The canvas preview state the designer derives from a data-core preview. */
function toCanvasPreview(document: DesignDocument, preview: DataPreview): CanvasDataPreview {
  const objects = new Map(
    preview.resolution.document.pages.flatMap((page, pageIndex) =>
      page.objects
        .filter((object, index) => object !== document.pages[pageIndex]!.objects[index])
        .map((object) => [object.id, object] as const),
    ),
  );
  const issues = new Map<string, 'ERROR' | 'WARNING'>();
  for (const issue of preview.issues) {
    if (!issue.target) continue;
    if (issues.get(issue.target.objectId) !== 'ERROR')
      issues.set(issue.target.objectId, issue.severity);
  }
  return { objects, hiddenObjectIds: preview.resolution.hiddenObjectIds, issues };
}

describe('Canonical → Fabric → Canonical for Phase 3 documents', () => {
  it('keeps fields, field bindings, expressions and conditional visibility unchanged', async () => {
    const document = createVariableDataHangTagDocument();
    const back = readBackDocument(document);
    back.pages.forEach((page, index) => expect(page).toBe(document.pages[index]));
    expect(back.dataSchema).toBe(document.dataSchema);
    expect(await computeDocumentHash(back)).toBe(await computeDocumentHash(document));
  });

  it('keeps a migrated schema v2 document hash-stable', async () => {
    const parsed = parseDesignDocument(SAMPLE_HANG_TAG_V2_JSON);
    if (!parsed.valid) throw new Error('fixture invalid');
    expect(await computeDocumentHash(readBackDocument(parsed.document))).toBe(
      await computeDocumentHash(parsed.document),
    );
  });

  it('keeps the 120-object / 60-binding / 20-expression document stable', async () => {
    const document = createLargeVariableDataDocument();
    expect(await computeDocumentHash(readBackDocument(document))).toBe(
      await computeDocumentHash(document),
    );
  });

  it('does not drift over repeated open → canvas → save cycles with Data Preview active', async () => {
    const original = createVariableDataHangTagDocument();
    const hash = await computeDocumentHash(original);
    let document = original;
    for (let cycle = 0; cycle < 10; cycle += 1) {
      const preview = (current: DesignDocument) =>
        toCanvasPreview(current, buildDataPreview(current, VARIABLE_DATA_RECORD));
      document = JSON.parse(JSON.stringify(readBackDocument(document, preview))) as DesignDocument;
    }
    expect(await computeDocumentHash(document)).toBe(hash);
  });
});

describe('Data Preview on the canvas', () => {
  it('draws resolved values while the store and read-back stay canonical', async () => {
    const document = createVariableDataHangTagDocument();
    const hash = await computeDocumentHash(document);
    const { store, canvas } = mountCanvas(document);
    const preview = buildDataPreview(document, VARIABLE_DATA_RECORD);
    canvas.setDataPreview(toCanvasPreview(document, preview));
    canvas.fabric.renderAll();

    const size = canvas.getFabricObject('vd-size')!;
    expect(size.dataDisplay.object).toMatchObject({ content: 'SIZE: XL' });
    expect(size.canonical).toMatchObject({ content: 'SIZE: M' });
    expect(canvas.getFabricObject('vd-product-image')!.dataDisplay.hidden).toBe(true);
    expect(canvas.readPage()).toBe(findPage(document, 'page-front'));
    expect(store.getState().document).toBe(document);
    expect(store.getState().changeCount).toBe(0);
    expect(await computeDocumentHash(store.getState().document)).toBe(hash);

    canvas.setDataPreview(null);
    expect(size.dataDisplay.object).toBeNull();
    canvas.dispose();
  });

  it('detects artwork issues on resolved content (an invalid barcode after resolution)', () => {
    const document = createVariableDataHangTagDocument();
    const { canvas } = mountCanvas(document);
    canvas.fabric.renderAll();
    expect(canvas.getFabricObject('vd-barcode')!.lastIssues).toEqual([]);
    const preview = buildDataPreview(document, { ...VARIABLE_DATA_RECORD, gtin: '9501234567893' });
    canvas.setDataPreview(toCanvasPreview(document, preview));
    canvas.fabric.renderAll();
    const barcode = canvas.getFabricObject('vd-barcode')!;
    expect(barcode.dataDisplay.issue).toBe('ERROR');
    expect(barcode.lastIssues).toContain('SYMBOL_INVALID');
    canvas.dispose();
  });

  it('moving an object during Data Preview changes geometry only, never content', async () => {
    const document = createVariableDataHangTagDocument();
    const { store, canvas } = mountCanvas(document);
    canvas.setDataPreview(
      toCanvasPreview(document, buildDataPreview(document, VARIABLE_DATA_RECORD)),
    );
    const size = canvas.getFabricObject('vd-size')!;
    size.set({ left: size.left + 20 });
    canvas.fabric.fire('object:modified', { target: size, action: 'drag' });
    await flushMicrotasks();
    const moved = findPage(store.getState().document, 'page-front').objects.find(
      (o) => o.id === 'vd-size',
    )!;
    expect(moved.x).not.toBe(
      findPage(document, 'page-front').objects.find((o) => o.id === 'vd-size')!.x,
    );
    expect(moved).toMatchObject({ content: 'SIZE: M' });
    // The stale resolved copy is not drawn at the old size; template values show until refreshed.
    canvas.fabric.renderAll();
    canvas.dispose();
  });

  it('follows binding and schema changes without leaking preview values into the document', () => {
    let document = createVariableDataHangTagDocument();
    document = {
      ...document,
      dataSchema: {
        fields: [...document.dataSchema.fields, createDataField({ key: 'note', type: 'string' })],
      },
    };
    const { store, canvas } = mountCanvas(document);
    store.apply('Bind', (current, pageId) =>
      setPropertyBinding(current, pageId, 'vd-sku', 'content', expressionBinding('upper(color)')),
    );
    const current = store.getState().document;
    canvas.setDataPreview(
      toCanvasPreview(current, buildDataPreview(current, VARIABLE_DATA_RECORD)),
    );
    expect(canvas.getFabricObject('vd-sku')!.dataDisplay.object).toMatchObject({ content: 'NAVY' });
    store.apply('Resize', (doc, pageId) =>
      setObjectFrames(doc, pageId, [{ id: 'vd-sku', width: 150 }]),
    );
    canvas.fabric.renderAll();
    expect(
      findPage(store.getState().document, 'page-front').objects.find((o) => o.id === 'vd-sku'),
    ).toMatchObject({ content: 'ST-1001-NAVY-M', width: 150 });
    canvas.dispose();
  });
});
