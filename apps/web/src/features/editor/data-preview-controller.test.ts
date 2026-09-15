import { computeDocumentHash } from '@smarttag/document-utils';
import {
  VARIABLE_DATA_RECORD,
  createVariableDataHangTagDocument,
} from '@smarttag/document-utils/fixtures';
import { EditorStore } from '@smarttag/editor-core';
import { createApproximateTextMeasurer, createTextLayoutEngine } from '@smarttag/rendering-core';
import { describe, expect, it } from 'vitest';
import { DataPreviewController, toCanvasPreview } from './data-preview-controller';

function controllerFor(store: EditorStore) {
  const services = {
    textLayout: createTextLayoutEngine({ measurer: createApproximateTextMeasurer() }),
    barcodeEncoder: null,
    fonts: { status: () => 'LOADED' as const, cssFamily: () => null },
    images: { get: () => ({ status: 'FAILED' as const, image: null, width: 0, height: 0 }) },
  };
  return new DataPreviewController(
    store,
    () => services,
    () => 'UNKNOWN',
  );
}

describe('DataPreviewController', () => {
  it('keeps test data out of the document, the history and the template hash', async () => {
    const store = new EditorStore({ document: createVariableDataHangTagDocument() });
    const document = store.getState().document;
    const hash = await computeDocumentHash(document);
    const controller = controllerFor(store);
    let notifications = 0;
    controller.subscribe(() => (notifications += 1));

    controller.setMode('DATA');
    controller.replaceRecord(VARIABLE_DATA_RECORD);
    controller.setValue('size', 'S');
    expect(notifications).toBe(3);
    expect(controller.getState()).toMatchObject({ mode: 'DATA', record: { size: 'S' } });

    const preview = controller.current()!;
    const sku = preview.resolution.document.pages[0]!.objects.find((o) => o.id === 'vd-sku');
    expect(sku).toMatchObject({ content: 'YT-2045-NAVY-S' });
    expect(store.getState().document).toBe(document);
    expect(store.getState().canUndo).toBe(false);
    expect(await computeDocumentHash(store.getState().document)).toBe(hash);
  });

  it('memoizes the pipeline per document and record', () => {
    const store = new EditorStore({ document: createVariableDataHangTagDocument() });
    const controller = controllerFor(store);
    controller.replaceRecord(VARIABLE_DATA_RECORD);
    const first = controller.compute(store.getState().document);
    expect(controller.compute(store.getState().document)).toBe(first);
    controller.setValue('color', 'Olive');
    expect(controller.compute(store.getState().document)).not.toBe(first);
    controller.setValue('color', 'Olive');
    expect(controller.current()).toBeNull();
  });

  it('fills sample values without overwriting what the user already entered', () => {
    const store = new EditorStore({ document: createVariableDataHangTagDocument() });
    const controller = controllerFor(store);
    controller.setValue('size', 'XXL');
    controller.fillSample(store.getState().document);
    expect(controller.getState().record).toMatchObject({ size: 'XXL', currency: 'USD' });
  });

  it('derives canvas display state: changed objects, hidden objects and worst issue per object', () => {
    const store = new EditorStore({ document: createVariableDataHangTagDocument() });
    const controller = controllerFor(store);
    controller.replaceRecord({
      ...VARIABLE_DATA_RECORD,
      gtin: '9501234567893',
      is_sustainable: false,
    });
    const document = store.getState().document;
    const canvas = toCanvasPreview(document, controller.compute(document));
    expect(canvas.objects.get('vd-size')).toMatchObject({ content: 'SIZE: XL' });
    expect(canvas.objects.has('vd-band')).toBe(false);
    expect([...canvas.hiddenObjectIds].sort()).toEqual(['vd-product-image', 'vd-recycled']);
    expect(canvas.issues.get('vd-barcode')).toBe('ERROR');
  });
});
