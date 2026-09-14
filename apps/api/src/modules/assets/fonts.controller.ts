import { Controller, Get } from '@nestjs/common';
import type { FontFaceDto } from '@smarttag/shared-types';
import type { ActorContext } from '../../common/http/request-context';
import { CurrentActor, RequirePermissions } from '../authorization/authorization.decorators';
import { AssetsService } from './assets.service';

/** Font registry of the active organization (FONT assets and the metadata read from each file). */
@Controller('fonts')
export class FontsController {
  constructor(private readonly assets: AssetsService) {}

  @RequirePermissions('asset:read')
  @Get()
  list(@CurrentActor() actor: ActorContext): Promise<FontFaceDto[]> {
    return this.assets.listFonts(actor);
  }
}
