import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateMemberRequestSchema, ResetMemberPasswordRequestSchema, UpdateMemberRequestSchema, UpdateOrganizationRequestSchema, type CreateMemberRequest, type ResetMemberPasswordRequest, type UpdateMemberRequest, type UpdateOrganizationRequest } from '@smarttag/shared-types';
import type { ActorContext } from '../../common/http/request-context';
import { UuidParamPipe, ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor, RequirePermissions } from '../authorization/authorization.decorators';
import { AdministrationService } from './administration.service';

@Controller('administration')
export class AdministrationController {
  constructor(private readonly admin: AdministrationService) {}

  @RequirePermissions('organization:read') @Get('organization')
  organization(@CurrentActor() actor: ActorContext) { return this.admin.organization(actor); }

  @RequirePermissions('organization:manage') @Patch('organization')
  updateOrganization(@CurrentActor() actor: ActorContext, @Body(new ZodValidationPipe(UpdateOrganizationRequestSchema)) body: UpdateOrganizationRequest) {
    return this.admin.updateOrganization(actor, body);
  }

  @RequirePermissions('member:read') @Get('members')
  members(@CurrentActor() actor: ActorContext) { return this.admin.members(actor); }

  @RequirePermissions('member:manage') @Post('members')
  createMember(@CurrentActor() actor: ActorContext, @Body(new ZodValidationPipe(CreateMemberRequestSchema)) body: CreateMemberRequest) {
    return this.admin.createMember(actor, body);
  }

  @RequirePermissions('member:manage') @Patch('members/:membershipId')
  updateMember(@CurrentActor() actor: ActorContext, @Param('membershipId', new UuidParamPipe('Membership')) membershipId: string, @Body(new ZodValidationPipe(UpdateMemberRequestSchema)) body: UpdateMemberRequest) {
    return this.admin.updateMember(actor, membershipId, body);
  }

  @RequirePermissions('member:manage') @Post('members/:membershipId/reset-password')
  resetPassword(@CurrentActor() actor: ActorContext, @Param('membershipId', new UuidParamPipe('Membership')) membershipId: string, @Body(new ZodValidationPipe(ResetMemberPasswordRequestSchema)) body: ResetMemberPasswordRequest) {
    return this.admin.resetPassword(actor, membershipId, body);
  }

  @RequirePermissions('role:read') @Get('roles')
  roles() { return this.admin.roles(); }

  @RequirePermissions('audit:read') @Get('audit')
  audit(@CurrentActor() actor: ActorContext, @Query('limit') limit?: string) { return this.admin.audit(actor, limit); }
}
