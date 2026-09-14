import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CreateTemplateRequestSchema,
  CreateTemplateVersionRequestSchema,
  ListTemplatesQuerySchema,
  UpdateTemplateRequestSchema,
  type CreateTemplateCommand,
  type ListTemplatesQuery,
  type PaginatedResponse,
  type TemplateDto,
  type TemplateVersionDetailDto,
  type TemplateVersionSummaryDto,
  type UpdateTemplateRequest,
} from '@smarttag/shared-types';
import type { z } from 'zod';
import type { ActorContext } from '../../common/http/request-context';
import { UuidParamPipe, ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor, RequirePermissions } from '../authorization/authorization.decorators';
import { TemplateVersionsService } from './template-versions.service';
import { TemplatesService } from './templates.service';

@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly versions: TemplateVersionsService,
  ) {}

  @RequirePermissions('template:read')
  @Get()
  list(
    @CurrentActor() actor: ActorContext,
    @Query(new ZodValidationPipe(ListTemplatesQuerySchema)) query: ListTemplatesQuery,
  ): Promise<PaginatedResponse<TemplateDto>> {
    return this.templates.list(actor, query);
  }

  @RequirePermissions('template:create')
  @Post()
  create(
    @CurrentActor() actor: ActorContext,
    @Body(new ZodValidationPipe(CreateTemplateRequestSchema)) body: CreateTemplateCommand,
  ): Promise<TemplateDto> {
    return this.templates.create(actor, body);
  }

  @RequirePermissions('template:read')
  @Get(':templateId')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('templateId', new UuidParamPipe('Template')) templateId: string,
  ): Promise<TemplateDto> {
    return this.templates.get(actor, templateId);
  }

  @RequirePermissions('template:update')
  @Patch(':templateId')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('templateId', new UuidParamPipe('Template')) templateId: string,
    @Body(new ZodValidationPipe(UpdateTemplateRequestSchema)) body: UpdateTemplateRequest,
  ): Promise<TemplateDto> {
    return this.templates.update(actor, templateId, body);
  }

  @RequirePermissions('template:read')
  @Get(':templateId/versions')
  listVersions(
    @CurrentActor() actor: ActorContext,
    @Param('templateId', new UuidParamPipe('Template')) templateId: string,
  ): Promise<TemplateVersionSummaryDto[]> {
    return this.versions.listForTemplate(actor, templateId);
  }

  @RequirePermissions('template-version:create')
  @Post(':templateId/versions')
  createVersion(
    @CurrentActor() actor: ActorContext,
    @Param('templateId', new UuidParamPipe('Template')) templateId: string,
    @Body(new ZodValidationPipe(CreateTemplateVersionRequestSchema))
    body: z.output<typeof CreateTemplateVersionRequestSchema>,
  ): Promise<TemplateVersionDetailDto> {
    return this.versions.create(actor, templateId, body);
  }
}
