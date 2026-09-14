import { createBwipBarcodeEncoder } from '@smarttag/barcode-bwip';
import type { ArtworkObject, DesignDocument } from '@smarttag/document-schema';
import {
  createBarcodeObject,
  createEllipseObject,
  createImageObject,
  createLineObject,
  createQrCodeObject,
  createRectangleObject,
  createTextObject,
  fieldBinding,
  mmToPt,
  rgb,
  solidStroke,
} from '@smarttag/document-utils';
import { EditorStore } from '@smarttag/editor-core';
import { createApproximateTextMeasurer, createTextLayoutEngine } from '@smarttag/rendering-core';
import { EditorCanvas, NULL_FONT_PROVIDER, NULL_IMAGE_PROVIDER, type RenderServices } from '../src';

export function testServices(): RenderServices {
  return {
    textLayout: createTextLayoutEngine({ measurer: createApproximateTextMeasurer() }),
    barcodeEncoder: createBwipBarcodeEncoder(),
    fonts: NULL_FONT_PROVIDER,
    images: NULL_IMAGE_PROVIDER,
  };
}

export function mountCanvas(
  document: DesignDocument,
  options: { width?: number; height?: number; readOnly?: boolean } = {},
) {
  const element = window.document.createElement('canvas');
  const store = new EditorStore({ document, readOnly: options.readOnly });
  const canvas = new EditorCanvas(element, {
    width: options.width ?? 1200,
    height: options.height ?? 900,
    services: testServices(),
  });
  canvas.attach(store);
  return { store, canvas };
}

const mm = mmToPt;

/**
 * One object of every type with non-trivial canonical values: full-precision millimetre
 * coordinates, rotation, opacity, hidden/locked flags, bindings, groups and metadata.
 */
export function everyObjectType(): ArtworkObject[] {
  return [
    createTextObject({
      id: 'rt-text',
      name: 'Text ✓ বাংলা',
      x: mm(7.3),
      y: mm(12.1),
      width: mm(33.3),
      height: mm(9.7),
      rotation: 12.5,
      opacity: 0.8,
      zIndex: 3,
      groupId: 'grp-rt',
      content: 'Organic Cotton\nবাংলাদেশে তৈরি',
      fontAssetId: '0192f0a0-5b1e-7c3d-9b01-00000000f700',
      fontFamily: 'Noto Sans',
      fontSize: 9.25,
      fontWeight: 700,
      fontStyle: 'ITALIC',
      textAlign: 'CENTER',
      verticalAlign: 'MIDDLE',
      lineHeight: 1.35,
      letterSpacing: 0.15,
      textColor: rgb('#0B6E4F'),
      direction: 'AUTO',
      language: 'bn',
      wrap: 'WORD',
      overflow: { mode: 'SHRINK_TO_FIT', minFontSize: 6 },
      metadata: { 'erp.field': 'NAME' },
      bindings: { content: fieldBinding('product_name') },
    }),
    createImageObject({
      id: 'rt-image',
      x: mm(-2.2),
      y: mm(20.4),
      width: mm(18.6),
      height: mm(11.1),
      rotation: 359.5,
      zIndex: 1,
      assetId: '0192f0a0-5b1e-7c3d-9a4f-6b7c8d9e0f10',
      fitMode: 'COVER',
      crop: { x: 0.1, y: 0.05, width: 0.8, height: 0.9 },
      preserveAspectRatio: false,
      locked: true,
    }),
    createRectangleObject({
      id: 'rt-rect',
      x: mm(1.1),
      y: mm(2.2),
      width: mm(40.9),
      height: mm(5.5),
      zIndex: 0,
      fill: { space: 'CMYK', c: 10, m: 0, y: 20, k: 5 },
      stroke: {
        color: rgb('#112233'),
        width: 0.75,
        dashPattern: [2, 1.5],
        lineCap: 'ROUND',
        lineJoin: 'BEVEL',
      },
      cornerRadius: mm(1.5),
    }),
    createEllipseObject({
      id: 'rt-ellipse',
      x: mm(30),
      y: mm(40),
      width: mm(9.99),
      height: mm(4.44),
      rotation: 90,
      zIndex: 4,
      fill: null,
      stroke: solidStroke(rgb('#FF0000'), 0.35),
      visible: false,
    }),
    createLineObject({
      id: 'rt-line',
      x: mm(5),
      y: mm(57),
      width: mm(42),
      height: 0,
      rotation: 45,
      zIndex: 2,
      stroke: solidStroke(rgb('#CBD2D9'), 0.5),
    }),
    createBarcodeObject({
      id: 'rt-barcode',
      x: mm(7),
      y: mm(61),
      width: mm(36),
      height: mm(23),
      rotation: 180,
      zIndex: 5,
      symbology: 'EAN13',
      value: '4006381333931',
      barHeight: mm(19),
      quietZone: 11,
      bindings: { value: fieldBinding('gtin') },
    }),
    createQrCodeObject({
      id: 'rt-qr',
      x: mm(15),
      y: mm(58),
      width: mm(20),
      height: mm(20),
      rotation: 270,
      opacity: 0.55,
      zIndex: 6,
      value: 'https://example.com/products/st-1001',
      errorCorrection: 'Q',
      backgroundColor: null,
      bindings: { value: fieldBinding('product_url') },
    }),
  ];
}
