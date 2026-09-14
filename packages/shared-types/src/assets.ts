import { z } from 'zod';
import { PaginationQuerySchema } from './pagination';
import type { UserRefDto } from './templates';

export const ASSET_TYPES = [
  'LOGO',
  'IMAGE',
  'SVG',
  'FONT',
  'ICON',
  'CARE_SYMBOL',
  'CERTIFICATION_SYMBOL',
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

/** MIME types accepted by the asset store, detected from file content (never trusted from the client). */
export const ALLOWED_ASSET_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/tiff',
  'application/pdf',
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
] as const;
export type AssetMimeType = (typeof ALLOWED_ASSET_MIME_TYPES)[number];

/**
 * Image content that the designer, the canonical renderer and future production renderers can place
 * in artwork (Phase 2). Other image types can be stored as assets but not placed in documents yet.
 */
export const PLACEABLE_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const;

export function isPlaceableImageMimeType(mimeType: string): boolean {
  return (PLACEABLE_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export const ASSET_USAGES = ['PLACEABLE_IMAGE', 'FONT'] as const;
export type AssetUsage = (typeof ASSET_USAGES)[number];

export const CreateAssetFieldsSchema = z.object({
  assetType: z.enum(ASSET_TYPES),
});
export type CreateAssetFields = z.infer<typeof CreateAssetFieldsSchema>;

export const ListAssetsQuerySchema = PaginationQuerySchema.extend({
  assetType: z.enum(ASSET_TYPES).optional(),
  /** Case-insensitive filename search. */
  search: z.string().trim().max(100).optional(),
  /** Restricts results to assets usable for a purpose (enforced server-side). */
  usage: z.enum(ASSET_USAGES).optional(),
});
export type ListAssetsQuery = z.infer<typeof ListAssetsQuerySchema>;

export interface AssetDto {
  readonly id: string;
  readonly assetType: AssetType;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly widthPx: number | null;
  readonly heightPx: number | null;
  readonly createdBy: UserRefDto;
  readonly createdAt: string;
}
