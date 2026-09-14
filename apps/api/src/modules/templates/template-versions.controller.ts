import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  TransitionTemplateVersionRequestSchema,
  UpdateTemplateVersionRequestSchema,
  type TemplateVersionDetailDto,
  type TransitionTemplateVersionRequest,
  type UpdateTemplateVersionRequest,
} from '@smarttag/shared-types';
import type { ActorContext } from '../../common/http/request-context';
import { UuidParamPipe, ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor, RequirePermissions } from '../authorization/authorization.decorators';
import { TemplateVersionsService } from './template-versions.service';

@Controller('template-versions')
export class TemplateVersionsController {
  constructor(private readonly versions: TemplateVersionsService) {}

  @RequirePermissions('template:read')
  @Get(':versionId')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('versionId', new UuidParamPipe('Template version')) versionId: string,
  ): Promise<TemplateVersionDetailDto> {
    return this.versions.get(actor, versionId);
  }

  @RequirePermissions('template-version:edit-draft')
  @Patch(':versionId')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('versionId', new UuidParamPipe('Template version')) versionId: string,
    @Body(new ZodValidationPipe(UpdateTemplateVersionRequestSchema)) body: UpdateTemplateVersionRequest,
  ): Promise<TemplateVersionDetailDto> {
    return this.versions.updateDraft(actor, versionId, body);
  }

  /** The permission for each specific transition is enforced by the lifecycle policy. */
  @RequirePermissions('template:read')
  @Post(':versionId/transitions')
  @HttpCode(200)
  transition(
    @CurrentActor() actor: ActorContext,
    @Param('versionId', new UuidParamPipe('Template version')) versionId: string,
    @Body(new ZodValidationPipe(TransitionTemplateVersionRequestSchema)) body: TransitionTemplateVersionRequest,
  ): Promise<TemplateVersionDetailDto> {
    return this.versions.transition(actor, versionId, body);
  }
}
