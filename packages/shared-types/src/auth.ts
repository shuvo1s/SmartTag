import { z } from 'zod';
export const ROLES = ['SUPER_ADMIN','ORG_ADMIN','TEMPLATE_ADMIN','DESIGNER','DATA_OPERATOR','QA','APPROVER','PRODUCTION_OPERATOR','PRODUCTION_MANAGER','VIEWER'] as const;
export type Role=(typeof ROLES)[number]; export const RoleSchema=z.enum(ROLES);
export const PERMISSIONS=['organization:read','organization:manage','member:read','member:manage','role:read','customer:read','customer:manage','template:read','template:create','template:update','template:archive','template-version:create','template-version:edit-draft','template-version:submit','template-version:review','template-version:approve','template-version:retire','asset:read','asset:create','audit:read','dataset:read','dataset:create','dataset:finalize','dataset:read-source','mapping-profile:read','mapping-profile:manage','production-job:read','production-job:create','production-job:configure','production-job:validate','production-job:release','production-job:cancel','sequence:read','sequence:manage'] as const;
export type Permission=(typeof PERMISSIONS)[number];
const READ_ONLY:readonly Permission[]=['organization:read','customer:read','template:read','asset:read','dataset:read','mapping-profile:read','production-job:read','sequence:read'];
const PROD:readonly Permission[]=['production-job:create','production-job:configure','production-job:validate','production-job:cancel'];
export const ROLE_PERMISSIONS:Readonly<Record<Role,readonly Permission[]>>={
 SUPER_ADMIN:PERMISSIONS,ORG_ADMIN:PERMISSIONS,
 TEMPLATE_ADMIN:[...READ_ONLY,'member:read','role:read','customer:manage','template:create','template:update','template:archive','template-version:create','template-version:edit-draft','template-version:submit','template-version:review','template-version:retire','asset:create'],
 DESIGNER:[...READ_ONLY,'template:create','template:update','template-version:create','template-version:edit-draft','template-version:submit','asset:create','dataset:create','mapping-profile:manage'],
 DATA_OPERATOR:[...READ_ONLY,'dataset:create','dataset:finalize','dataset:read-source','mapping-profile:manage',...PROD],
 QA:[...READ_ONLY,'template-version:review','dataset:read-source'],APPROVER:[...READ_ONLY,'template-version:review','template-version:approve'],
 PRODUCTION_OPERATOR:[...READ_ONLY,'dataset:read-source',...PROD],PRODUCTION_MANAGER:[...READ_ONLY,'dataset:read-source',...PROD,'production-job:release','sequence:manage'],VIEWER:[...READ_ONLY]
};
export function permissionsForRoles(roles:readonly Role[]):Permission[]{const g=new Set<Permission>();for(const r of roles)for(const p of ROLE_PERMISSIONS[r])g.add(p);return PERMISSIONS.filter(p=>g.has(p))}
export const LoginRequestSchema=z.object({email:z.string().trim().toLowerCase().pipe(z.email({error:'Enter a valid email address'})),password:z.string().min(1,{error:'Password is required'}).max(1024)}); export type LoginRequest=z.infer<typeof LoginRequestSchema>;
export const SwitchOrganizationRequestSchema=z.object({organizationId:z.uuid()}); export type SwitchOrganizationRequest=z.infer<typeof SwitchOrganizationRequestSchema>;
export interface OrganizationRefDto{readonly id:string;readonly name:string;readonly slug:string} export interface MembershipDto{readonly organization:OrganizationRefDto;readonly roles:readonly Role[]}
export interface SessionDto{readonly user:{readonly id:string;readonly email:string;readonly displayName:string};readonly activeOrganization:OrganizationRefDto;readonly roles:readonly Role[];readonly permissions:readonly Permission[];readonly memberships:readonly MembershipDto[];readonly expiresAt:string}
