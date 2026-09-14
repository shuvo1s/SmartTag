import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ASSET_TYPES,
  CreateAssetFieldsSchema,
  PaginationQuerySchema,
  type AssetDto,
  type CreateAssetFields,
  type PaginatedResponse,
} from '@smarttag/shared-types';
import type { Response } from 'express';
import { z } from 'zod';
import type { ActorContext } from '../../common/http/request-context';
import { UuidParamPipe, ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor, RequirePermissions } from '../authorization/authorization.decorators';
import { AssetsService, type UploadedFile as UploadedAssetFile } from './assets.service';

const ListAssetsQuerySchema = PaginationQuerySchema.extend({
  assetType: z.enum(ASSET_TYPES).optional(),
});

@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @RequirePermissions('asset:create')
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  create(
    @CurrentActor() actor: ActorContext,
    @Body(new ZodValidationPipe(CreateAssetFieldsSchema)) body: CreateAssetFields,
    @UploadedFile() file: UploadedAssetFile | undefined,
  ): Promise<AssetDto> {
    return this.assets.create(actor, body.assetType, file);
  }

  @RequirePermissions('asset:read')
  @Get()
  list(
    @CurrentActor() actor: ActorContext,
    @Query(new ZodValidationPipe(ListAssetsQuerySchema))
    query: z.output<typeof ListAssetsQuerySchema>,
  ): Promise<PaginatedResponse<AssetDto>> {
    return this.assets.list(actor, query.page, query.pageSize, query.assetType);
  }

  @RequirePermissions('asset:read')
  @Get(':assetId')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('assetId', new UuidParamPipe('Asset')) assetId: string,
  ): Promise<AssetDto> {
    return this.assets.get(actor, assetId);
  }

  /**
   * Streams asset bytes. Served with a sandboxing CSP, nosniff and attachment-safe headers so
   * that uploaded SVG/PDF content can never execute in the application's origin.
   */
  @RequirePermissions('asset:read')
  @Get(':assetId/content')
  async content(
    @CurrentActor() actor: ActorContext,
    @Param('assetId', new UuidParamPipe('Asset')) assetId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { asset, object } = await this.assets.openContent(actor, assetId);
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.setHeader('ETag', `"${asset.checksumSha256}"`);
    return new StreamableFile(object.body, {
      type: asset.mimeType,
      length: object.contentLength ?? undefined,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
    });
  }
}
