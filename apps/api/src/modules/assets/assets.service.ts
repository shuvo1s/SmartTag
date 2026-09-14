import { Inject, Injectable } from '@nestjs/common';
import {
  ALLOWED_ASSET_MIME_TYPES,
  PLACEABLE_IMAGE_MIME_TYPES,
  type AssetDto,
  type AssetType,
  type FontFaceDto,
  type ListAssetsQuery,
  type PaginatedResponse,
  type UnicodeRange,
} from '@smarttag/shared-types';
import { createHash } from 'node:crypto';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  inspectContent,
  isMimeAllowedForAssetType,
  sanitizeFilename,
} from './asset-content-inspector';
import { inspectFont, type InspectedFont } from './font-inspector';
import { SVG_SANITIZER_VERSION, sanitizeSvg, type SvgSanitizationReport } from './svg-sanitizer';
import {
  OBJECT_STORAGE,
  ObjectNotFoundError,
  assetStorageKey,
  type ObjectStorage,
  type StoredObject,
} from './storage/object-storage';

export interface UploadedFile {
  readonly originalname: string;
  readonly buffer: Buffer;
  readonly size: number;
}

const assetSelect = {
  id: true,
  assetType: true,
  filename: true,
  mimeType: true,
  sizeBytes: true,
  checksumSha256: true,
  widthPx: true,
  heightPx: true,
  createdAt: true,
  createdBy: { select: { id: true, displayName: true } },
} as const satisfies Prisma.AssetSelect;

type AssetRow = Prisma.AssetGetPayload<{ select: typeof assetSelect }>;

const fontFaceSelect = {
  assetId: true,
  familyName: true,
  subfamilyName: true,
  fullName: true,
  postscriptName: true,
  fontVersion: true,
  weight: true,
  style: true,
  format: true,
  embeddingPermission: true,
  unitsPerEm: true,
  ascender: true,
  descender: true,
  lineGap: true,
  capHeight: true,
  xHeight: true,
  glyphCount: true,
  unicodeRanges: true,
  createdAt: true,
  asset: { select: { filename: true, checksumSha256: true, sizeBytes: true } },
} as const satisfies Prisma.FontFaceSelect;

type FontFaceRow = Prisma.FontFaceGetPayload<{ select: typeof fontFaceSelect }>;

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async create(
    actor: ActorContext,
    assetType: AssetType,
    file: UploadedFile | undefined,
  ): Promise<AssetDto> {
    if (!file || file.size === 0) {
      throw AppError.validation('A non-empty file is required', [
        { path: 'file', message: 'Choose a file to upload' },
      ]);
    }
    const prepared = prepareUploadContent(file.buffer);
    const inspected = prepared.inspected;
    if (!inspected) {
      throw new AppError(
        'UNSUPPORTED_MEDIA_TYPE',
        `Unsupported file type. Allowed: ${ALLOWED_ASSET_MIME_TYPES.join(', ')}`,
      );
    }
    if (!isMimeAllowedForAssetType(assetType, inspected.mimeType)) {
      throw new AppError(
        'UNSUPPORTED_MEDIA_TYPE',
        `A ${inspected.mimeType} file cannot be stored as asset type ${assetType}`,
      );
    }

    // Fonts are registered from metadata read out of the file itself; unreadable, variable and
    // collection fonts are refused so that every font asset pins exactly one static face.
    let font: InspectedFont | null = null;
    if (assetType === 'FONT') {
      const inspection = inspectFont(prepared.content, inspected.mimeType);
      if (!inspection.ok) {
        throw new AppError('UNSUPPORTED_MEDIA_TYPE', inspection.reason);
      }
      font = inspection.font;
    }

    const content = prepared.content;
    const checksumSha256 = createHash('sha256').update(content).digest('hex');
    const storageKey = assetStorageKey(actor.organizationId, checksumSha256);
    // Content-addressed: identical bytes are stored once per organization.
    if (!(await this.storage.objectExists(storageKey))) {
      await this.storage.putObject(storageKey, content, {
        contentType: inspected.mimeType,
        checksumSha256,
      });
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          organizationId: actor.organizationId,
          assetType,
          filename: sanitizeFilename(file.originalname),
          mimeType: inspected.mimeType,
          sizeBytes: content.length,
          storageKey,
          checksumSha256,
          widthPx: inspected.widthPx,
          heightPx: inspected.heightPx,
          createdById: actor.userId,
        },
        select: assetSelect,
      });
      if (font) {
        await tx.fontFace.create({
          data: {
            organizationId: actor.organizationId,
            assetId: asset.id,
            ...font,
            unicodeRanges: font.unicodeRanges.map(([first, last]) => [first, last]),
          },
        });
      }
      await this.audit.recordForActor(tx, actor, {
        action: 'ASSET_CREATED',
        resourceType: 'ASSET',
        resourceId: asset.id,
        metadata: {
          assetType,
          mimeType: inspected.mimeType,
          sizeBytes: content.length,
          checksumSha256,
          ...(prepared.svgReport && {
            svgSanitizerVersion: SVG_SANITIZER_VERSION,
            uploadedSizeBytes: file.size,
            removedSvgElements: prepared.svgReport.removedElements.slice(0, 50),
            removedSvgAttributes: prepared.svgReport.removedAttributes.slice(0, 50),
          }),
          ...(font && {
            font: {
              familyName: font.familyName,
              weight: font.weight,
              style: font.style,
              fontVersion: font.fontVersion,
              embeddingPermission: font.embeddingPermission,
            },
          }),
        },
      });
      return asset;
    });
    return toAssetDto(row);
  }

  async list(actor: ActorContext, query: ListAssetsQuery): Promise<PaginatedResponse<AssetDto>> {
    const { page, pageSize } = query;
    const conditions: Prisma.AssetWhereInput[] = [];
    if (query.assetType) {
      conditions.push({ assetType: query.assetType });
    }
    if (query.search) {
      conditions.push({ filename: { contains: query.search, mode: 'insensitive' } });
    }
    if (query.usage === 'PLACEABLE_IMAGE') {
      conditions.push({
        assetType: { not: 'FONT' },
        mimeType: { in: [...PLACEABLE_IMAGE_MIME_TYPES] },
      });
    } else if (query.usage === 'FONT') {
      conditions.push({ assetType: 'FONT', fontFace: { isNot: null } });
    }
    const where: Prisma.AssetWhereInput = {
      organizationId: actor.organizationId,
      AND: conditions,
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.asset.count({ where }),
      this.prisma.asset.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: assetSelect,
      }),
    ]);
    return {
      items: rows.map(toAssetDto),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** The organization's font registry, ordered for font pickers. */
  async listFonts(actor: ActorContext): Promise<FontFaceDto[]> {
    const rows = await this.prisma.fontFace.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: [{ familyName: 'asc' }, { style: 'asc' }, { weight: 'asc' }, { createdAt: 'asc' }],
      select: fontFaceSelect,
    });
    return rows.map(toFontFaceDto);
  }

  async get(actor: ActorContext, assetId: string): Promise<AssetDto> {
    return toAssetDto(await this.findRow(actor, assetId));
  }

  async openContent(
    actor: ActorContext,
    assetId: string,
  ): Promise<{ asset: AssetDto; object: StoredObject }> {
    const row = await this.prisma.asset.findFirst({
      where: { id: assetId, organizationId: actor.organizationId },
      select: { ...assetSelect, storageKey: true },
    });
    if (!row) {
      throw AppError.notFound('Asset');
    }
    try {
      return { asset: toAssetDto(row), object: await this.storage.getObject(row.storageKey) };
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        throw AppError.notFound('Asset content');
      }
      throw error;
    }
  }

  private async findRow(actor: ActorContext, assetId: string): Promise<AssetRow> {
    const row = await this.prisma.asset.findFirst({
      where: { id: assetId, organizationId: actor.organizationId },
      select: assetSelect,
    });
    if (!row) {
      throw AppError.notFound('Asset');
    }
    return row;
  }
}

interface PreparedUpload {
  readonly content: Buffer;
  readonly inspected: ReturnType<typeof inspectContent>;
  readonly svgReport: SvgSanitizationReport | null;
}

/**
 * Detects the real content type and, for SVG, replaces the upload with its sanitized form. Unsafe
 * SVG is rejected outright; only sanitized bytes are ever checksummed, stored and served.
 */
function prepareUploadContent(buffer: Buffer): PreparedUpload {
  const detected = inspectContent(buffer);
  if (detected?.mimeType !== 'image/svg+xml') {
    return { content: buffer, inspected: detected, svgReport: null };
  }
  const sanitized = sanitizeSvg(buffer);
  if (!sanitized.ok) {
    throw new AppError(
      'UNSAFE_CONTENT',
      `The SVG file contains content that is not allowed: ${sanitized.violations
        .slice(0, 3)
        .map((violation) => violation.message)
        .join('; ')}`,
      { violations: sanitized.violations },
    );
  }
  return {
    content: sanitized.content,
    inspected: inspectContent(sanitized.content),
    svgReport: sanitized.report,
  };
}

function toUnicodeRangesValue(value: Prisma.JsonValue): UnicodeRange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    Array.isArray(entry) &&
    entry.length === 2 &&
    typeof entry[0] === 'number' &&
    typeof entry[1] === 'number'
      ? [[entry[0], entry[1]] as const]
      : [],
  );
}

function toFontFaceDto(row: FontFaceRow): FontFaceDto {
  const { asset, unicodeRanges, createdAt, ...face } = row;
  return {
    ...face,
    filename: asset.filename,
    checksumSha256: asset.checksumSha256,
    sizeBytes: asset.sizeBytes,
    unicodeRanges: toUnicodeRangesValue(unicodeRanges),
    createdAt: createdAt.toISOString(),
  };
}

function toAssetDto(row: AssetRow): AssetDto {
  return {
    id: row.id,
    assetType: row.assetType,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}
