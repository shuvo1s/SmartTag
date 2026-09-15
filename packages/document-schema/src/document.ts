import { z } from 'zod';
import { DataSchemaSchema } from './data-schema';
import { DocumentDimensionsSchema } from './dimensions';
import { DocumentTypeSchema } from './document-type';
import { ArtworkObjectSchema } from './objects';
import { ColorSchema, ElementIdSchema, LanguageTagSchema, UuidSchema } from './primitives';
import { CURRENT_SCHEMA_VERSION } from './version';

export const PAGE_SIDES = ['FRONT', 'BACK', 'OTHER'] as const;

export const GroupSchema = z.strictObject({
  id: ElementIdSchema,
  name: z.string().max(100),
  visible: z.boolean(),
  locked: z.boolean(),
});
export type Group = z.infer<typeof GroupSchema>;

export const PageSchema = z.strictObject({
  id: ElementIdSchema,
  name: z.string().trim().min(1).max(100),
  side: z.enum(PAGE_SIDES),
  /** Fills the bleed box. null = unprinted substrate. */
  background: ColorSchema.nullable(),
  groups: z.array(GroupSchema).max(1_000),
  objects: z.array(ArtworkObjectSchema).max(5_000),
});
export type Page = z.infer<typeof PageSchema>;
export type PageSide = Page['side'];

export const DocumentMetadataSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2_000),
  documentType: DocumentTypeSchema,
  /** Primary content language. Individual text objects may override. */
  language: LanguageTagSchema.nullable(),
  tags: z.array(z.string().trim().min(1).max(50)).max(50),
});
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

export const PrintSettingsSchema = z.strictObject({
  /** Intended output color space. CMYK output is implemented in the production-PDF phase. */
  colorSpace: z.enum(['RGB', 'CMYK']),
  /** How the piece is turned over to reveal BACK pages; used to mirror dieline features. */
  backSideFlip: z.enum(['HORIZONTAL', 'VERTICAL']),
  cropMarks: z.boolean(),
});
export type PrintSettings = z.infer<typeof PrintSettingsSchema>;

/**
 * What happens when a property depends on an optional field that has neither a value in the data
 * record nor a default (see docs/data-schema.md#missing-data-policy):
 * - FAIL:  blocking error — the record is not production-valid
 * - WARN:  the property renders empty (text/value "", no image, hidden) and a warning is reported
 * - EMPTY: the property renders empty silently
 * Required fields without a value are always errors, whatever the policy.
 */
export const MISSING_DATA_POLICIES = ['FAIL', 'WARN', 'EMPTY'] as const;
export type MissingDataPolicy = (typeof MISSING_DATA_POLICIES)[number];

export const DocumentSettingsSchema = z.strictObject({
  missingDataPolicy: z.enum(MISSING_DATA_POLICIES),
});
export type DocumentSettings = z.infer<typeof DocumentSettingsSchema>;

/**
 * SmartTag canonical design document (current schema version, see `version.ts`).
 *
 * Every key is required: "not set" is expressed with `null`, never by omitting a key. This keeps
 * the persisted form canonical, so equal designs serialize — and hash — identically.
 *
 * Timestamps, authorship and workflow status deliberately live on database records
 * (TemplateVersion), not inside the document, so that they never influence the design hash.
 */
export const DesignDocumentSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  /** Stable id of the logical design; unchanged across versions of the same template. */
  documentId: UuidSchema,
  metadata: DocumentMetadataSchema,
  dimensions: DocumentDimensionsSchema,
  printSettings: PrintSettingsSchema,
  pages: z.array(PageSchema).min(1).max(100),
  dataSchema: DataSchemaSchema,
  settings: DocumentSettingsSchema,
});

export type DesignDocument = z.infer<typeof DesignDocumentSchema>;
