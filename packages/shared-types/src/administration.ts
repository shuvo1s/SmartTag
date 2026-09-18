import { z } from 'zod';
import { ROLES, RoleSchema, type Permission, type Role } from './auth';

export const UpdateOrganizationRequestSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(2).max(64),
});
export type UpdateOrganizationRequest = z.infer<typeof UpdateOrganizationRequestSchema>;

export const CreateMemberRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(12).max(1024),
  role: RoleSchema,
});
export type CreateMemberRequest = z.infer<typeof CreateMemberRequestSchema>;

export const UpdateMemberRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(200).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  role: RoleSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one change is required' });
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequestSchema>;

export const ResetMemberPasswordRequestSchema = z.object({ password: z.string().min(12).max(1024) });
export type ResetMemberPasswordRequest = z.infer<typeof ResetMemberPasswordRequestSchema>;

export interface OrganizationAdminDto {
  readonly id: string; readonly name: string; readonly slug: string;
  readonly status: 'ACTIVE' | 'SUSPENDED'; readonly createdAt: string; readonly updatedAt: string;
}
export interface MemberAdminDto {
  readonly membershipId: string; readonly userId: string; readonly displayName: string;
  readonly email: string; readonly userStatus: 'ACTIVE' | 'DISABLED';
  readonly membershipStatus: 'ACTIVE' | 'SUSPENDED'; readonly role: Role | null;
  readonly lastLoginAt: string | null; readonly createdAt: string;
}
export interface RoleDefinitionDto {
  readonly role: Role; readonly label: string; readonly system: true; readonly permissions: readonly Permission[];
}
export interface AuditEventDto {
  readonly id: string; readonly action: string; readonly resourceType: string; readonly resourceId: string | null;
  readonly actor: { readonly id: string; readonly displayName: string; readonly email: string } | null;
  readonly metadata: unknown; readonly createdAt: string;
}
export const ROLE_LABELS: Readonly<Record<Role,string>> = Object.fromEntries(
  ROLES.map((role) => [role, role.replaceAll('_',' ').toLowerCase().replace(/\b\w/g,(c)=>c.toUpperCase())])
) as Readonly<Record<Role,string>>;
