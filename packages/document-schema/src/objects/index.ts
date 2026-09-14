import { z } from 'zod';
import type { BindablePropertyKind } from '../bindings';
import { BarcodeObjectSchema } from './barcode';
import { ImageObjectSchema } from './image';
import { QrCodeObjectSchema } from './qr-code';
import { EllipseObjectSchema, LineObjectSchema, RectangleObjectSchema } from './shapes';
import { TextObjectSchema } from './text';

export * from './barcode';
export * from './base';
export * from './image';
export * from './qr-code';
export * from './shapes';
export * from './text';

/**
 * Discriminated union of all artwork object types.
 *
 * Adding a type (svg, polygon, path, dataMatrix, pdf417, table, careSymbol, …):
 *   1. create its schema in this folder, spreading `baseObjectShape`
 *   2. add it to this union and to ARTWORK_OBJECT_TYPES
 *   3. declare its bindable properties in OBJECT_BINDABLE_PROPERTIES (compile-time enforced)
 *   4. teach rendering-core to build a scene node for it (compile-time enforced by exhaustive switch)
 */
export const ArtworkObjectSchema = z.discriminatedUnion('type', [
  TextObjectSchema,
  ImageObjectSchema,
  RectangleObjectSchema,
  EllipseObjectSchema,
  LineObjectSchema,
  BarcodeObjectSchema,
  QrCodeObjectSchema,
]);

export type ArtworkObject = z.infer<typeof ArtworkObjectSchema>;
export type ArtworkObjectType = ArtworkObject['type'];
export type ArtworkObjectOfType<T extends ArtworkObjectType> = Extract<ArtworkObject, { type: T }>;

export const ARTWORK_OBJECT_TYPES = [
  'text',
  'image',
  'rectangle',
  'ellipse',
  'line',
  'barcode',
  'qrCode',
] as const satisfies readonly ArtworkObjectType[];

type BindablePropertyRegistry = {
  readonly [T in ArtworkObjectType]: Readonly<
    Record<keyof ArtworkObjectOfType<T>['bindings'], BindablePropertyKind>
  >;
};

/**
 * For each object type: which properties can be bound, and what kind of value they accept.
 * The mapped type guarantees this registry stays in sync with each schema's `bindings` object.
 */
export const OBJECT_BINDABLE_PROPERTIES = {
  text: { content: 'TEXT', visible: 'VISIBILITY' },
  image: { assetId: 'IMAGE_ASSET', visible: 'VISIBILITY' },
  rectangle: { visible: 'VISIBILITY' },
  ellipse: { visible: 'VISIBILITY' },
  line: { visible: 'VISIBILITY' },
  barcode: { value: 'SYMBOL_DATA', visible: 'VISIBILITY' },
  qrCode: { value: 'SYMBOL_DATA', visible: 'VISIBILITY' },
} as const satisfies BindablePropertyRegistry;

export function isArtworkObjectType(value: unknown): value is ArtworkObjectType {
  return typeof value === 'string' && (ARTWORK_OBJECT_TYPES as readonly string[]).includes(value);
}
