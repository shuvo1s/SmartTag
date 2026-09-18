import { Injectable } from '@nestjs/common';
import { PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, ROLES, type AuditEventDto, type CreateMemberRequest, type MemberAdminDto, type OrganizationAdminDto, type ResetMemberPasswordRequest, type RoleDefinitionDto, type UpdateMemberRequest, type UpdateOrganizationRequest } from '@smarttag/shared-types';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordHasher } from '../auth/password-hasher';

@Injectable()
export class AdministrationService {
  constructor(private readonly prisma: PrismaService, private readonly auditService: AuditService, private readonly passwords: PasswordHasher) {}

  async organization(actor: ActorContext): Promise<OrganizationAdminDto> {
    const row = await this.prisma.organization.findUnique({ where:{id:actor.organizationId}, select:{id:true,name:true,slug:true,status:true,createdAt:true,updatedAt:true} });
    if (!row) throw AppError.notFound('Organization');
    return {...row, createdAt:row.createdAt.toISOString(), updatedAt:row.updatedAt.toISOString()};
  }

  async updateOrganization(actor: ActorContext, input: UpdateOrganizationRequest): Promise<OrganizationAdminDto> {
    const slugOwner = await this.prisma.organization.findFirst({where:{slug:input.slug,NOT:{id:actor.organizationId}},select:{id:true}});
    if (slugOwner) throw AppError.conflict('That organization slug is already in use');
    const row = await this.prisma.$transaction(async tx => {
      const updated = await tx.organization.update({where:{id:actor.organizationId},data:{name:input.name,slug:input.slug},select:{id:true,name:true,slug:true,status:true,createdAt:true,updatedAt:true}});
      await this.auditService.recordForActor(tx,actor,{action:'ORGANIZATION_UPDATED',resourceType:'ORGANIZATION',resourceId:updated.id,metadata:{name:updated.name,slug:updated.slug}});
      return updated;
    });
    return {...row,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
  }

  async members(actor: ActorContext): Promise<MemberAdminDto[]> {
    const rows = await this.prisma.membership.findMany({where:{organizationId:actor.organizationId},orderBy:{user:{displayName:'asc'}},select:{id:true,status:true,createdAt:true,user:{select:{id:true,displayName:true,email:true,status:true,lastLoginAt:true}},roles:{select:{role:true},orderBy:{role:'asc'}}}});
    return rows.map(r=>({membershipId:r.id,userId:r.user.id,displayName:r.user.displayName,email:r.user.email,userStatus:r.user.status,membershipStatus:r.status,role:r.roles[0]?.role??null,lastLoginAt:r.user.lastLoginAt?.toISOString()??null,createdAt:r.createdAt.toISOString()}));
  }

  async createMember(actor: ActorContext, input: CreateMemberRequest): Promise<MemberAdminDto> {
    const exists = await this.prisma.user.findUnique({where:{email:input.email},select:{id:true}});
    if (exists) throw AppError.conflict('A user with this email address already exists');
    const hash = await this.passwords.hash(input.password);
    const membership = await this.prisma.$transaction(async tx => {
      const user = await tx.user.create({data:{email:input.email,displayName:input.displayName,passwordCredential:{create:{passwordHash:hash}}},select:{id:true}});
      const m = await tx.membership.create({data:{organizationId:actor.organizationId,userId:user.id,roles:{create:{role:input.role}}},select:{id:true}});
      await this.auditService.recordForActor(tx,actor,{action:'MEMBER_CREATED',resourceType:'MEMBERSHIP',resourceId:m.id,metadata:{userId:user.id,email:input.email,role:input.role}});
      return m;
    });
    return (await this.members(actor)).find(m=>m.membershipId===membership.id)!;
  }

  private async ensureAdminRemains(actor: ActorContext, membershipId: string, nextRole?: string, disabling=false) {
    const target = await this.prisma.membership.findFirst({where:{id:membershipId,organizationId:actor.organizationId},select:{id:true,userId:true,roles:{select:{role:true}}}});
    if (!target) throw AppError.notFound('Membership');
    if (disabling && target.userId===actor.userId) throw AppError.conflict('You cannot disable your own account');
    const isAdmin = target.roles.some(r=>r.role==='ORG_ADMIN'||r.role==='SUPER_ADMIN');
    const remainsAdmin = !disabling && (nextRole==='ORG_ADMIN'||nextRole==='SUPER_ADMIN');
    if (isAdmin && !remainsAdmin) {
      const count = await this.prisma.membership.count({where:{organizationId:actor.organizationId,status:'ACTIVE',user:{status:'ACTIVE'},roles:{some:{role:{in:['ORG_ADMIN','SUPER_ADMIN']}}}}});
      if (count<=1) throw AppError.conflict('At least one active organization administrator is required');
    }
    return target;
  }

  async updateMember(actor: ActorContext, membershipId: string, input: UpdateMemberRequest): Promise<MemberAdminDto> {
    const target = await this.ensureAdminRemains(actor,membershipId,input.role,input.status==='DISABLED');
    await this.prisma.$transaction(async tx => {
      if (input.displayName || input.status) await tx.user.update({where:{id:target.userId},data:{...(input.displayName?{displayName:input.displayName}:{}),...(input.status?{status:input.status}: {})}});
      if (input.role) { await tx.membershipRole.deleteMany({where:{membershipId}}); await tx.membershipRole.create({data:{membershipId,role:input.role}}); }
      if (input.status==='DISABLED' || input.role) await tx.session.updateMany({where:{userId:target.userId,revokedAt:null},data:{revokedAt:new Date()}});
      await this.auditService.recordForActor(tx,actor,{action:'MEMBER_UPDATED',resourceType:'MEMBERSHIP',resourceId:membershipId,metadata:{userId:target.userId,changed:Object.keys(input)}});
    });
    return (await this.members(actor)).find(m=>m.membershipId===membershipId)!;
  }

  async resetPassword(actor: ActorContext, membershipId: string, input: ResetMemberPasswordRequest): Promise<{ok:true}> {
    const target = await this.prisma.membership.findFirst({where:{id:membershipId,organizationId:actor.organizationId},select:{userId:true}});
    if (!target) throw AppError.notFound('Membership');
    const hash = await this.passwords.hash(input.password);
    await this.prisma.$transaction(async tx => {
      await tx.passwordCredential.upsert({where:{userId:target.userId},create:{userId:target.userId,passwordHash:hash},update:{passwordHash:hash,passwordChangedAt:new Date()}});
      await tx.session.updateMany({where:{userId:target.userId,revokedAt:null},data:{revokedAt:new Date()}});
      await this.auditService.recordForActor(tx,actor,{action:'MEMBER_PASSWORD_RESET',resourceType:'USER',resourceId:target.userId,metadata:{membershipId}});
    });
    return {ok:true};
  }

  roles(): RoleDefinitionDto[] { return ROLES.map(role=>({role,label:ROLE_LABELS[role],system:true,permissions:PERMISSIONS.filter(p=>ROLE_PERMISSIONS[role].includes(p))})); }

  async audit(actor: ActorContext, rawLimit?: string): Promise<AuditEventDto[]> {
    const limit=Math.min(200,Math.max(10,Number(rawLimit)||100));
    const rows=await this.prisma.auditEvent.findMany({where:{organizationId:actor.organizationId},orderBy:{createdAt:'desc'},take:limit,select:{id:true,action:true,resourceType:true,resourceId:true,metadata:true,createdAt:true,actorUser:{select:{id:true,displayName:true,email:true}}}});
    return rows.map(r=>({id:r.id,action:r.action,resourceType:r.resourceType,resourceId:r.resourceId,actor:r.actorUser,metadata:r.metadata,createdAt:r.createdAt.toISOString()}));
  }
}
