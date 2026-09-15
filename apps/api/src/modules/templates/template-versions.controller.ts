import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  TransitionTemplateVersionRequestSchema,
  UpdateTemplateVersionRequestSchema,
  ValidateTemplateDataRequestSchema,
  type TemplateDataValidationDto,
  type TemplateVersionDetailDto,
  type TransitionTemplateVersionRequest,
  type UpdateTemplateVersionRequest,
  type ValidateTemplateDataRequest,
} from '@smarttag/shared-types';
import type { ActorContext } from '../../common/http/request-context';
import { UuidParamPipe, ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor, RequirePermissions } from '../authorization/authorization.decorators';
import { TemplateDataService } from './template-data.service';
import { TemplateVersionsService } from './template-versions.service';

@Controller('template-versions')
export class TemplateVersionsController {
  constructor(
    private readonly versions: TemplateVersionsService,
    private readonly data: TemplateDataService,
  ) {}

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
    @Body(new ZodValidationPipe(UpdateTemplateVersionRequestSchema))
    body: UpdateTemplateVersionRequest,
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
    @Body(new ZodValidationPipe(TransitionTemplateVersionRequestSchema))
    body: TransitionTemplateVersionRequest,
  ): Promise<TemplateVersionDetailDto> {
    return this.versions.transition(actor, versionId, body);
  }

  /**
   * Validates one data record against this version (data schema, binding resolution, resolved
   * barcodes/QR codes/images) and returns structured issues, the normalized record and its
   * resolved-input hash. Read-only: the version is never modified.
   */
  @RequirePermissions('template:read')
  @Post(':versionId/data/validate')
  @HttpCode(200)
  validateData(
    @CurrentActor() actor: ActorContext,
    @Param('versionId', new UuidParamPipe('Template version')) versionId: string,
    @Body(new ZodValidationPipe(ValidateTemplateDataRequestSchema))
    body: ValidateTemplateDataRequest,
  ): Promise<TemplateDataValidationDto> {
    return this.data.validateRecord(actor, versionId, body);
  }
}
