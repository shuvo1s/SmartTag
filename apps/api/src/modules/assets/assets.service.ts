import { Inject, Injectable } from '@nestjs/common';
import {
  ALLOWED_ASSET_MIME_TYPES,
  type AssetDto,
  type AssetType,
  type PaginatedResponse,
} from '@smarttag/shared-types';
import { createHash } from 'node:crypto';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { inspectContent, isMimeAllowedForAssetType, sanitizeFilename } from './asset-content-inspector';
import { OBJECT_STORAGE, ObjectNotFoundError, assetStorageKey, type ObjectStorage, type StoredObject } from './storage/object-storage';

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

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async create(actor: ActorContext, assetType: AssetType, file: UploadedFile | undefined): Promise<AssetDto> {
    if (!file || file.size === 0) {
      throw AppError.validation('A non-empty file is required', [{ path: 'file', message: 'Choose a file to upload' }]);
    }
    const inspected = inspectContent(file.buffer);
    if (!inspected) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', `Unsupported file type. Allowed: ${ALLOWED_ASSET_MIME_TYPES.join(', ')}`);
    }
    if (!isMimeAllowedForAssetType(assetType, inspected.mimeType)) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', `A ${inspected.mimeType} file cannot be stored as asset type ${assetType}`);
    }

    const checksumSha256 = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = assetStorageKey(actor.organizationId, checksumSha256);
    // Content-addressed: identical bytes are stored once per organization.
    if (!(await this.storage.objectExists(storageKey))) {
      await this.storage.putObject(storageKey, file.buffer, { contentType: inspected.mimeType, checksumSha256 });
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          organizationId: actor.organizationId,
          assetType,
          filename: sanitizeFilename(file.originalname),
          mimeType: inspected.mimeType,
          sizeBytes: file.size,
          storageKey,
          checksumSha256,
          widthPx: inspected.widthPx,
          heightPx: inspected.heightPx,
          createdById: actor.userId,
        },
        select: assetSelect,
      });
      await this.audit.recordForActor(tx, actor, {
        action: 'ASSET_CREATED',
        resourceType: 'ASSET',
        resourceId: asset.id,
        metadata: { assetType, mimeType: inspected.mimeType, sizeBytes: file.size, checksumSha256 },
      });
      return asset;
    });
    return toAssetDto(row);
  }

  async list(actor: ActorContext, page: number, pageSize: number, assetType?: AssetType): Promise<PaginatedResponse<AssetDto>> {
    const where: Prisma.AssetWhereInput = { organizationId: actor.organizationId, assetType };
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
    return { items: rows.map(toAssetDto), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async get(actor: ActorContext, assetId: string): Promise<AssetDto> {
    return toAssetDto(await this.findRow(actor, assetId));
  }

  async openContent(actor: ActorContext, assetId: string): Promise<{ asset: AssetDto; object: StoredObject }> {
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
