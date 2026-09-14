import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  SAMPLE_BRAND_LOGO_ASSET_ID,
  SAMPLE_FONT_ASSET_IDS,
} from '@smarttag/document-utils/fixtures';
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
  'font_faces',
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
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((table) => `"${table}"`).join(', ')} CASCADE`,
  );
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
    throw new Error(
      `login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return agent;
}

/** Two tenants with users covering the main roles. */
export async function seedTenants(prisma: PrismaService) {
  const orgA = await createOrganization(prisma, 'org-a');
  const orgB = await createOrganization(prisma, 'org-b');
  const users = {
    adminA: await createUser(prisma, 'admin.a@test.local', [
      { organizationId: orgA.id, roles: ['ORG_ADMIN'] },
    ]),
    designerA: await createUser(prisma, 'designer.a@test.local', [
      { organizationId: orgA.id, roles: ['DESIGNER'] },
    ]),
    approverA: await createUser(prisma, 'approver.a@test.local', [
      { organizationId: orgA.id, roles: ['APPROVER', 'QA'] },
    ]),
    viewerA: await createUser(prisma, 'viewer.a@test.local', [
      { organizationId: orgA.id, roles: ['VIEWER'] },
    ]),
    adminB: await createUser(prisma, 'admin.b@test.local', [
      { organizationId: orgB.id, roles: ['ORG_ADMIN'] },
    ]),
    multi: await createUser(prisma, 'multi@test.local', [
      { organizationId: orgA.id, roles: ['VIEWER'] },
      { organizationId: orgB.id, roles: ['DESIGNER'] },
    ]),
  };
  return { orgA, orgB, users };
}

const SAMPLE_FONT_FACES = [
  [SAMPLE_FONT_ASSET_IDS.notoSansRegular, 'Noto Sans', 400],
  [SAMPLE_FONT_ASSET_IDS.notoSansMedium, 'Noto Sans', 500],
  [SAMPLE_FONT_ASSET_IDS.notoSansSemiBold, 'Noto Sans', 600],
  [SAMPLE_FONT_ASSET_IDS.notoSansBold, 'Noto Sans', 700],
  [SAMPLE_FONT_ASSET_IDS.notoSansBengaliRegular, 'Noto Sans Bengali', 400],
] as const;

/**
 * Registers the assets referenced by the sample hang tag (logo + controlled fonts) as database rows
 * in one organization. Content bytes are not needed for document validation.
 */
export async function seedSampleAssets(
  prisma: PrismaService,
  organizationId: string,
  createdById: string,
): Promise<void> {
  await prisma.asset.create({
    data: {
      id: SAMPLE_BRAND_LOGO_ASSET_ID,
      organizationId,
      assetType: 'LOGO',
      filename: 'logo.svg',
      mimeType: 'image/svg+xml',
      sizeBytes: 10,
      storageKey: 'organizations/a/assets/sha256/aa/logo',
      checksumSha256: 'a'.repeat(64),
      createdById,
    },
  });
  for (const [assetId, familyName, weight] of SAMPLE_FONT_FACES) {
    await prisma.asset.create({
      data: {
        id: assetId,
        organizationId,
        assetType: 'FONT',
        filename: `${familyName}-${weight}.ttf`,
        mimeType: 'font/ttf',
        sizeBytes: 10,
        storageKey: `organizations/a/assets/sha256/bb/${assetId}`,
        checksumSha256: 'b'.repeat(64),
        createdById,
      },
    });
    await prisma.fontFace.create({
      data: {
        organizationId,
        assetId,
        familyName,
        subfamilyName: String(weight),
        fullName: `${familyName} ${weight}`,
        postscriptName: `${familyName.replace(/ /g, '')}-${weight}`,
        fontVersion: 'Version 1.000',
        weight,
        style: 'NORMAL',
        format: 'TTF',
        embeddingPermission: 'INSTALLABLE',
        unitsPerEm: 1000,
        ascender: 1069,
        descender: -293,
        lineGap: 0,
        glyphCount: 100,
        unicodeRanges: [[32, 126]],
      },
    });
  }
}

export const hangTagRequest = (overrides: Record<string, unknown> = {}) => ({
  name: 'Basic hang tag',
  code: 'HT-BASIC',
  documentType: 'HANG_TAG',
  dimensions: { unit: 'mm', width: 50, height: 90, bleed: 3, safeMargin: 3 },
  pageLayout: 'FRONT_AND_BACK',
  ...overrides,
});
