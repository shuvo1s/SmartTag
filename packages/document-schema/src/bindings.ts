import { EXPRESSION_LIMITS, type ExpressionType } from '@smarttag/expression-core';
import { z } from 'zod';
import type { DataFieldType } from './data-schema';
import { FieldKeySchema } from './primitives';
import { SYSTEM_FIELD_KEYS } from './system-fields';

/**
 * Formal property-binding model (see docs/data-bindings.md).
 *
 * Each bindable artwork property has exactly one binding entry. The static value always lives
 * in the property itself (it doubles as the design-time sample value); the binding decides
 * whether output uses that static value, the value of one data field, or a calculated expression.
 *
 * Bindings are never `{{placeholders}}` embedded in strings: every mode is an explicit object that
 * is validated against the data schema.
 */
export const StaticBindingSchema = z.strictObject({
  mode: z.literal('STATIC'),
});

/**
 * A binding may read a data field or one of the production system fields (`__serial`, …). Data
 * schemas can never define a key in the reserved "__" namespace, so the two sets never overlap and
 * an unknown "__" key stays invalid. Stored documents are unaffected: this rule only widens which
 * documents are accepted, so no document changes and no migration is needed.
 */
export const BindingFieldKeySchema = z.union([
  FieldKeySchema,
  z.enum(Object.values(SYSTEM_FIELD_KEYS) as [string, ...string[]]),
]);

export const FieldBindingSchema = z.strictObject({
  mode: z.literal('FIELD'),
  field: BindingFieldKeySchema,
});

/**
 * A calculated value, e.g. `concat("SIZE: ", size)`. Stored as source text (readable, diffable and
 * hash-stable); parsed and type-checked by `@smarttag/expression-core` during validation.
 */
export const ExpressionBindingSchema = z.strictObject({
  mode: z.literal('EXPRESSION'),
  expression: z.string().min(1).max(EXPRESSION_LIMITS.maxSourceLength),
});

export const BINDING_MODES = ['STATIC', 'FIELD', 'EXPRESSION'] as const;

export const PropertyBindingSchema = z.discriminatedUnion('mode', [
  StaticBindingSchema,
  FieldBindingSchema,
  ExpressionBindingSchema,
]);

export type StaticBinding = z.infer<typeof StaticBindingSchema>;
export type FieldBinding = z.infer<typeof FieldBindingSchema>;
export type ExpressionBinding = z.infer<typeof ExpressionBindingSchema>;
export type PropertyBinding = z.infer<typeof PropertyBindingSchema>;
export type BindingMode = PropertyBinding['mode'];

/** The kind of value a bindable property accepts — used to check type compatibility. */
export type BindablePropertyKind = 'TEXT' | 'SYMBOL_DATA' | 'IMAGE_ASSET' | 'VISIBILITY';

/**
 * Which data field types may feed each property kind. Formatting/conversion of e.g. numbers to
 * text happens in the binding resolver, never in the renderer.
 */
export const BINDING_COMPATIBILITY: Readonly<
  Record<BindablePropertyKind, readonly DataFieldType[]>
> = {
  TEXT: ['string', 'number', 'decimal', 'date', 'url'],
  SYMBOL_DATA: ['string', 'number', 'decimal', 'url'],
  IMAGE_ASSET: ['image'],
  VISIBILITY: ['boolean'],
};

export function isFieldTypeCompatible(
  kind: BindablePropertyKind,
  fieldType: DataFieldType,
): boolean {
  return BINDING_COMPATIBILITY[kind].includes(fieldType);
}

/**
 * Whether an expression whose static result type is `type` may feed a property. Expression and
 * field bindings accept exactly the same value types.
 */
export function isExpressionTypeCompatible(
  kind: BindablePropertyKind,
  type: ExpressionType,
): boolean {
  return type !== 'null' && isFieldTypeCompatible(kind, type);
}

/** Short description of what a property kind accepts, for messages. */
export const BINDABLE_PROPERTY_KIND_LABELS: Readonly<Record<BindablePropertyKind, string>> = {
  TEXT: 'text, numbers, dates or URLs',
  SYMBOL_DATA: 'text, numbers or URLs',
  IMAGE_ASSET: 'an image',
  VISIBILITY: 'true/false',
};
