import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Role } from '@smarttag/shared-types';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { createApp } from '../../src/bootstrap';
import { loadAppConfig } from '../../src/config/env.schema';
import { PrismaService } from '../../src/database/prisma.service';
import { PasswordHasher } from '../../src/modules/auth/password-hasher';

export const TEST_PASSWORD = 'Integration-Test-Password-1';
export const API = '/api/v1';

export interface TestApp {
  readonly app: NestExpressApplication;
  readonly prisma: PrismaService;
  readonly http: TestAgent;
  close(): Promise<void>;
}

export async function createTestApp(envOverrides: Record<string, string> = {}): Promise<TestApp> {
  const config = loadAppConfig({ ...process.env, ...envOverrides });
  const app = await createApp(config);
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    http: request.agent(app.getHttpServer()),
    close: () => app.close(),
  };
}

const TABLES = [
  'audit_events',
  'sessions',
  'template_versions',
  'templates',
  'assets',
  'brands',
  'customers',
  'membership_roles',
  'memberships',
  'external_identities',
  'password_credentials',
  'users',
  'organizations',
];

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((table) => `"${table}"`).join(', ')} CASCADE`);
}

let cachedPasswordHash: Promise<string> | null = null;

export async function createOrganization(prisma: PrismaService, slug: string) {
  return prisma.organization.create({ data: { slug, name: `Org ${slug}` } });
}

export async function createUser(
  prisma: PrismaService,
  email: string,
  memberships: { organizationId: string; roles: Role[] }[],
  options: { status?: 'ACTIVE' | 'DISABLED' } = {},
) {
  cachedPasswordHash ??= new PasswordHasher().hash(TEST_PASSWORD);
  return prisma.user.create({
    data: {
      email,
      displayName: email.split('@')[0] ?? email,
      status: options.status ?? 'ACTIVE',
      passwordCredential: { create: { passwordHash: await cachedPasswordHash } },
      memberships: {
        create: memberships.map(({ organizationId, roles }) => ({
          organizationId,
          roles: { create: roles.map((role) => ({ role })) },
        })),
      },
    },
  });
}

/** A cookie-carrying HTTP client logged in as `email`. */
export async function loginAs(testApp: TestApp, email: string): Promise<TestAgent> {
  const agent = request.agent(testApp.app.getHttpServer());
  const response = await agent.post(`${API}/auth/login`).send({ email, password: TEST_PASSWORD });
  if (response.status !== 200) {
    throw new Error(`login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return agent;
}

/** Two tenants with users covering the main roles. */
export async function seedTenants(prisma: PrismaService) {
  const orgA = await createOrganization(prisma, 'org-a');
  const orgB = await createOrganization(prisma, 'org-b');
  const users = {
    adminA: await createUser(prisma, 'admin.a@test.local', [{ organizationId: orgA.id, roles: ['ORG_ADMIN'] }]),
    designerA: await createUser(prisma, 'designer.a@test.local', [{ organizationId: orgA.id, roles: ['DESIGNER'] }]),
    approverA: await createUser(prisma, 'approver.a@test.local', [{ organizationId: orgA.id, roles: ['APPROVER', 'QA'] }]),
    viewerA: await createUser(prisma, 'viewer.a@test.local', [{ organizationId: orgA.id, roles: ['VIEWER'] }]),
    adminB: await createUser(prisma, 'admin.b@test.local', [{ organizationId: orgB.id, roles: ['ORG_ADMIN'] }]),
    multi: await createUser(prisma, 'multi@test.local', [
      { organizationId: orgA.id, roles: ['VIEWER'] },
      { organizationId: orgB.id, roles: ['DESIGNER'] },
    ]),
  };
  return { orgA, orgB, users };
}

export const hangTagRequest = (overrides: Record<string, unknown> = {}) => ({
  name: 'Basic hang tag',
  code: 'HT-BASIC',
  documentType: 'HANG_TAG',
  dimensions: { unit: 'mm', width: 50, height: 90, bleed: 3, safeMargin: 3 },
  pageLayout: 'FRONT_AND_BACK',
  ...overrides,
});
