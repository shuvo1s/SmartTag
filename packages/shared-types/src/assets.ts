import { z } from 'zod';
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

export const CreateAssetFieldsSchema = z.object({
  assetType: z.enum(ASSET_TYPES),
});
export type CreateAssetFields = z.infer<typeof CreateAssetFieldsSchema>;

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
