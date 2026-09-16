import { z } from 'zod';

/**
 * Roles are assigned per organization membership. Authorization is always evaluated on the
 * server from the membership of the ACTIVE organization — a role in one tenant grants nothing in
 * another. SUPER_ADMIN is currently equivalent to ORG_ADMIN within its organization; cross-tenant
 * platform administration is deliberately not implemented in Phase 1.
 */
export const ROLES = [
  'SUPER_ADMIN',
  'ORG_ADMIN',
  'TEMPLATE_ADMIN',
  'DESIGNER',
  'DATA_OPERATOR',
  'QA',
  'APPROVER',
  'PRODUCTION_OPERATOR',
  'PRODUCTION_MANAGER',
  'VIEWER',
] as const;
export type Role = (typeof ROLES)[number];
export const RoleSchema = z.enum(ROLES);

export const PERMISSIONS = [
  'organization:read',
  'member:read',
  'member:manage',
  'customer:read',
  'customer:manage',
  'template:read',
  'template:create',
  'template:update',
  'template:archive',
  'template-version:create',
  'template-version:edit-draft',
  'template-version:submit',
  'template-version:review',
  'template-version:approve',
  'template-version:retire',
  'asset:read',
  'asset:create',
  'audit:read',
  'dataset:read',
  'dataset:create',
  'dataset:finalize',
  'dataset:read-source',
  'mapping-profile:read',
  'mapping-profile:manage',
  'production-job:read',
  'production-job:create',
  'production-job:configure',
  'production-job:validate',
  'production-job:release',
  'production-job:cancel',
  'sequence:read',
  'sequence:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: readonly Permission[] = [
  'organization:read',
  'customer:read',
  'template:read',
  'asset:read',
  'dataset:read',
  'mapping-profile:read',
  'production-job:read',
  'sequence:read',
];

/** Preparing a production job: everything except committing serial numbers by releasing it. */
const PRODUCTION_PREPARATION: readonly Permission[] = [
  'production-job:create',
  'production-job:configure',
  'production-job:validate',
  'production-job:cancel',
];

/** Single source of truth for role → permission mapping, enforced server-side. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  SUPER_ADMIN: PERMISSIONS,
  ORG_ADMIN: PERMISSIONS,
  TEMPLATE_ADMIN: [
    ...READ_ONLY,
    'member:read',
    'customer:manage',
    'template:create',
    'template:update',
    'template:archive',
    'template-version:create',
    'template-version:edit-draft',
    'template-version:submit',
    'template-version:review',
    'template-version:retire',
    'asset:create',
  ],
  DESIGNER: [
    ...READ_ONLY,
    'template:create',
    'template:update',
    'template-version:create',
    'template-version:edit-draft',
    'template-version:submit',
    'asset:create',
    // Designers may import and validate data against their templates; finalizing production
    // datasets is a data operator's decision.
    'dataset:create',
    'mapping-profile:manage',
  ],
  DATA_OPERATOR: [
    ...READ_ONLY,
    'dataset:create',
    'dataset:finalize',
    'dataset:read-source',
    'mapping-profile:manage',
    // Data operators prepare production jobs from the data they finalized; releasing them (which
    // commits serial numbers) is a production decision.
    ...PRODUCTION_PREPARATION,
  ],
  QA: [...READ_ONLY, 'template-version:review', 'dataset:read-source'],
  APPROVER: [...READ_ONLY, 'template-version:review', 'template-version:approve'],
  PRODUCTION_OPERATOR: [...READ_ONLY, 'dataset:read-source', ...PRODUCTION_PREPARATION],
  PRODUCTION_MANAGER: [
    ...READ_ONLY,
    'dataset:read-source',
    ...PRODUCTION_PREPARATION,
    'production-job:release',
    'sequence:manage',
  ],
  VIEWER: [...READ_ONLY],
};

export function permissionsForRoles(roles: readonly Role[]): Permission[] {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role]) {
      granted.add(permission);
    }
  }
  return PERMISSIONS.filter((permission) => granted.has(permission));
}

export const LoginRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Enter a valid email address' })),
  password: z.string().min(1, { error: 'Password is required' }).max(1024),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const SwitchOrganizationRequestSchema = z.object({
  organizationId: z.uuid(),
});
export type SwitchOrganizationRequest = z.infer<typeof SwitchOrganizationRequestSchema>;

export interface OrganizationRefDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface MembershipDto {
  readonly organization: OrganizationRefDto;
  readonly roles: readonly Role[];
}

export interface SessionDto {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
  };
  readonly activeOrganization: OrganizationRefDto;
  readonly roles: readonly Role[];
  readonly permissions: readonly Permission[];
  readonly memberships: readonly MembershipDto[];
  readonly expiresAt: string;
}
