import type { AssetMimeType, AssetType } from '@smarttag/shared-types';
import type { IImage } from 'image-size/types/interface';
import { GIF } from 'image-size/types/gif';
import { JPG } from 'image-size/types/jpg';
import { PNG } from 'image-size/types/png';
import { SVG } from 'image-size/types/svg';
import { TIFF } from 'image-size/types/tiff';
import { WEBP } from 'image-size/types/webp';

export interface InspectedContent {
  readonly mimeType: AssetMimeType;
  readonly widthPx: number | null;
  readonly heightPx: number | null;
}

const BYTE_ORDER_MARK = 0xfeff;

const startsWith = (buffer: Buffer, bytes: readonly number[], offset = 0) =>
  buffer.length >= offset + bytes.length &&
  bytes.every((byte, index) => buffer[offset + index] === byte);
const ascii = (buffer: Buffer, text: string, offset = 0) =>
  buffer.length >= offset + text.length &&
  buffer.toString('latin1', offset, offset + text.length) === text;

/**
 * Detects the real content type from file signatures. The client-supplied MIME type and file
 * extension are never trusted.
 */
export function detectMimeType(buffer: Buffer): AssetMimeType | null {
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(buffer, 'GIF87a') || ascii(buffer, 'GIF89a')) return 'image/gif';
  if (ascii(buffer, 'RIFF') && ascii(buffer, 'WEBP', 8)) return 'image/webp';
  if (startsWith(buffer, [0x49, 0x49, 0x2a, 0x00]) || startsWith(buffer, [0x4d, 0x4d, 0x00, 0x2a]))
    return 'image/tiff';
  if (ascii(buffer, '%PDF-')) return 'application/pdf';
  if (ascii(buffer, 'wOF2')) return 'font/woff2';
  if (ascii(buffer, 'wOFF')) return 'font/woff';
  if (ascii(buffer, 'OTTO')) return 'font/otf';
  if (startsWith(buffer, [0x00, 0x01, 0x00, 0x00]) || ascii(buffer, 'true')) return 'font/ttf';
  if (looksLikeSvg(buffer)) return 'image/svg+xml';
  return null;
}

function looksLikeSvg(buffer: Buffer): boolean {
  let head = buffer.toString('utf8', 0, Math.min(buffer.length, 4096));
  if (head.charCodeAt(0) === BYTE_ORDER_MARK) {
    head = head.slice(1);
  }
  head = head.trimStart();
  if (!head.startsWith('<')) return false;
  const withoutPreamble = head
    .replace(/^<\?xml[^>]*\?>\s*/i, '')
    .replace(/^(<!--[\s\S]*?-->\s*)*/, '')
    .replace(/^<!DOCTYPE svg[^>]*>\s*/i, '');
  return /^<svg[\s>]/i.test(withoutPreamble);
}

const ASSET_TYPE_MIME_RULES: Readonly<Record<AssetType, (mime: AssetMimeType) => boolean>> = {
  LOGO: (mime) => mime.startsWith('image/') || mime === 'application/pdf',
  IMAGE: (mime) => mime.startsWith('image/'),
  SVG: (mime) => mime === 'image/svg+xml',
  FONT: (mime) => mime.startsWith('font/'),
  ICON: (mime) => mime.startsWith('image/'),
  CARE_SYMBOL: (mime) => mime.startsWith('image/') || mime === 'application/pdf',
  CERTIFICATION_SYMBOL: (mime) => mime.startsWith('image/') || mime === 'application/pdf',
};

export function isMimeAllowedForAssetType(assetType: AssetType, mimeType: AssetMimeType): boolean {
  return ASSET_TYPE_MIME_RULES[assetType](mimeType);
}

/**
 * Dimension parsers per signature-detected type (defence in depth). image-size's auto-detection
 * can fall through to every parser it bundles, including HEIF, JPEG XL and ICNS parsers with known
 * denial-of-service bugs in image-size <= 2.0.2 (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq). The
 * signatures accepted above do not select those parsers today, but binding the parser to OUR
 * detected type keeps it that way regardless of image-size's detection order.
 */
const DIMENSION_PARSERS: Partial<Record<AssetMimeType, IImage>> = {
  'image/png': PNG,
  'image/jpeg': JPG,
  'image/gif': GIF,
  'image/webp': WEBP,
  'image/tiff': TIFF,
  'image/svg+xml': SVG,
};

export function inspectContent(buffer: Buffer): InspectedContent | null {
  const mimeType = detectMimeType(buffer);
  if (!mimeType) {
    return null;
  }
  let widthPx: number | null = null;
  let heightPx: number | null = null;
  const parser = DIMENSION_PARSERS[mimeType];
  if (parser) {
    try {
      const size = parser.validate(buffer) ? parser.calculate(buffer) : null;
      if (size?.width && size.height) {
        widthPx = Math.round(size.width);
        heightPx = Math.round(size.height);
      }
    } catch {
      // Dimensions are optional metadata (e.g. SVG without width/height/viewBox).
    }
  }
  return { mimeType, widthPx, heightPx };
}

const FORBIDDEN_FILENAME_CHARACTERS = new Set(['"', '<', '>', '|', ':', '*', '?']);

/** Removes path components, control characters and header-unsafe characters; keeps Unicode names. */
export function sanitizeFilename(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? '';
  const cleaned = [...base]
    .filter((char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && codePoint !== 0x7f && !FORBIDDEN_FILENAME_CHARACTERS.has(char);
    })
    .join('')
    .trim()
    .slice(0, 255);
  return cleaned.length > 0 ? cleaned : 'asset';
}
