import { z } from 'zod';
import type { DataFieldType } from './data-schema';
import { FieldKeySchema } from './primitives';

/**
 * Formal property-binding model (see docs/vdp-strategy.md).
 *
 * Each bindable artwork property has exactly one binding entry. The static value always lives
 * in the property itself (it doubles as the design-time preview value); the binding decides
 * whether production output uses that static value or a value from a data record.
 *
 * The union is intentionally open for extension — future modes such as EXPRESSION, COMPOSITE
 * (literal + field segments) or LOOKUP are added as new members, never by embedding
 * `{{placeholders}}` in strings.
 */
export const StaticBindingSchema = z.strictObject({
  mode: z.literal('STATIC'),
});

export const FieldBindingSchema = z.strictObject({
  mode: z.literal('FIELD'),
  field: FieldKeySchema,
});

export const PropertyBindingSchema = z.discriminatedUnion('mode', [
  StaticBindingSchema,
  FieldBindingSchema,
]);

export type StaticBinding = z.infer<typeof StaticBindingSchema>;
export type FieldBinding = z.infer<typeof FieldBindingSchema>;
export type PropertyBinding = z.infer<typeof PropertyBindingSchema>;
export type BindingMode = PropertyBinding['mode'];

/** The kind of value a bindable property accepts — used to check field-type compatibility. */
export type BindablePropertyKind = 'TEXT' | 'SYMBOL_DATA' | 'IMAGE_ASSET' | 'VISIBILITY';

/**
 * Which data field types may feed each property kind. Formatting/conversion of e.g. numbers to
 * text happens in the binding resolver, never in the renderer.
 */
export const BINDING_COMPATIBILITY: Readonly<Record<BindablePropertyKind, readonly DataFieldType[]>> =
  {
    TEXT: ['string', 'number', 'decimal', 'date', 'url'],
    SYMBOL_DATA: ['string', 'number', 'decimal', 'url'],
    IMAGE_ASSET: ['image'],
    VISIBILITY: ['boolean'],
  };

export function isFieldTypeCompatible(kind: BindablePropertyKind, fieldType: DataFieldType): boolean {
  return BINDING_COMPATIBILITY[kind].includes(fieldType);
}
