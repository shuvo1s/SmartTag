import { z } from 'zod';
import { PropertyBindingSchema } from '../bindings';
import { ColorSchema, LanguageTagSchema, PositiveLengthPtSchema, UuidSchema } from '../primitives';
import { baseObjectShape } from './base';

export const TEXT_ALIGNMENTS = ['START', 'CENTER', 'END', 'JUSTIFY'] as const;
export const VERTICAL_ALIGNMENTS = ['TOP', 'MIDDLE', 'BOTTOM'] as const;
export const FONT_STYLES = ['NORMAL', 'ITALIC'] as const;

/**
 * Line breaking inside the frame.
 * - NONE: only explicit line breaks (schema v1 behaviour; migrated documents keep it)
 * - WORD: additionally wrap at word boundaries when a line exceeds the frame width
 */
export const TEXT_WRAP_MODES = ['NONE', 'WORD'] as const;

/**
 * How text behaves when it does not fit its frame. Overflow is never silent: VISIBLE and CLIP
 * report it, SHRINK_TO_FIT reduces the size down to `minFontSize` and reports it if still too big.
 */
export const TextOverflowSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('VISIBLE') }),
  z.strictObject({ mode: z.literal('CLIP') }),
  z.strictObject({ mode: z.literal('SHRINK_TO_FIT'), minFontSize: PositiveLengthPtSchema }),
]);
export type TextOverflow = z.infer<typeof TextOverflowSchema>;

export const TextObjectSchema = z.strictObject({
  ...baseObjectShape,
  type: z.literal('text'),
  /** Unicode text. Line breaks are "\n". No markup, no placeholders. */
  content: z.string().max(10_000),
  /**
   * The exact font file used for production: an organization FONT asset. Assets are
   * content-addressed and immutable, so this pins the glyphs, metrics and version that browser
   * editors and server renderers must both use. null = no controlled font assigned yet (reported
   * as a warning; production output will require one).
   */
  fontAssetId: UuidSchema.nullable(),
  /** Family name of the font face; must match the registry entry of `fontAssetId` when set. */
  fontFamily: z.string().trim().min(1).max(200),
  fontSize: PositiveLengthPtSchema.max(2_000),
  fontWeight: z.number().int().min(100).max(900).multipleOf(100),
  fontStyle: z.enum(FONT_STYLES),
  /** Logical alignment: START/END follow the resolved text direction (important for RTL scripts). */
  textAlign: z.enum(TEXT_ALIGNMENTS),
  verticalAlign: z.enum(VERTICAL_ALIGNMENTS),
  /** Multiple of fontSize. */
  lineHeight: z.number().positive().max(10),
  /** Additional spacing between glyphs, in points (may be negative). */
  letterSpacing: z.number().min(-100).max(100),
  textColor: ColorSchema,
  /** AUTO resolves direction from content (Unicode bidi algorithm) at render time. */
  direction: z.enum(['AUTO', 'LTR', 'RTL']),
  /** Content language, used for shaping, hyphenation and font fallback (e.g. "bn", "ar"). */
  language: LanguageTagSchema.nullable(),
  wrap: z.enum(TEXT_WRAP_MODES),
  overflow: TextOverflowSchema,
  bindings: z.strictObject({
    content: PropertyBindingSchema,
    visible: PropertyBindingSchema,
  }),
});
export type TextObject = z.infer<typeof TextObjectSchema>;
