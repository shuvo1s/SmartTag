/**
 * Development seed — SAFE DEMO DATA ONLY.
 *
 * Refuses to run when NODE_ENV=production or when DATABASE_URL does not point at a local host
 * (override for disposable remote dev databases with SEED_ALLOW_NON_LOCAL_DATABASE=true).
 * Idempotent: existing rows are left untouched.
 *
 *   npm run db:seed
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertValidDesignDocument, parseDesignDocument } from '@smarttag/document-schema';
import {
  createBlankDesignDocument,
  createTextObject,
  hashCanonicalJson,
  rgb,
  summarizeDesignDocument,
} from '@smarttag/document-utils';
import {
  SAMPLE_BRAND_LOGO_ASSET_ID,
  SAMPLE_FONT_ASSET_IDS,
  SAMPLE_HANG_TAG_V1_JSON,
  createSampleHangTagDocument,
} from '@smarttag/document-utils/fixtures';
import type { Role } from '@smarttag/shared-types';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAppConfig } from '../src/config/env.schema';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client';
import { PasswordHasher } from '../src/modules/auth/password-hasher';
import { prepareDocumentForStorage } from '../src/modules/templates/document-storage';
import { inspectContent } from '../src/modules/assets/asset-content-inspector';
import { inspectFont } from '../src/modules/assets/font-inspector';
import { assetStorageKey } from '../src/modules/assets/storage/object-storage';
import { createObjectStorage } from '../src/modules/assets/storage/storage.module';
import { sanitizeSvg } from '../src/modules/assets/svg-sanitizer';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres']);

function assertSafeEnvironment(databaseUrl: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: NODE_ENV=production');
  }
  const host = new URL(databaseUrl).hostname;
  if (!LOCAL_HOSTS.has(host) && process.env.SEED_ALLOW_NON_LOCAL_DATABASE !== 'true') {
    throw new Error(`Refusing to seed non-local database host "${host}"`);
  }
}

const config = loadAppConfig(process.env);
assertSafeEnvironment(config.database.url);

const password = process.env.SEED_USER_PASSWORD ?? '';
if (password.length < 12) {
  throw new Error('SEED_USER_PASSWORD must be set (at least 12 characters)');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: config.database.url }),
});
const hasher = new PasswordHasher();
const storage = createObjectStorage(config.objectStorage);

async function upsertOrganization(slug: string, name: string) {
  return prisma.organization.upsert({ where: { slug }, update: {}, create: { slug, name } });
}

async function upsertUser(
  email: string,
  displayName: string,
  memberships: { organizationId: string; roles: Role[] }[],
) {
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      displayName,
      passwordCredential: { create: { passwordHash: await hasher.hash(password) } },
    },
  });
  for (const { organizationId, roles } of memberships) {
    const membership = await prisma.membership.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      update: {},
      create: { organizationId, userId: user.id },
    });
    await prisma.membershipRole.createMany({
      data: roles.map((role) => ({ membershipId: membership.id, role })),
      skipDuplicates: true,
    });
  }
  return user;
}

async function upsertCustomer(
  organizationId: string,
  createdById: string,
  code: string,
  name: string,
  brands: [string, string][],
) {
  const customer = await prisma.customer.upsert({
    where: { organizationId_code: { organizationId, code } },
    update: {},
    create: { organizationId, code, name, createdById },
  });
  const brandIds: Record<string, string> = {};
  for (const [brandCode, brandName] of brands) {
    const brand = await prisma.brand.upsert({
      where: { customerId_code: { customerId: customer.id, code: brandCode } },
      update: {},
      create: {
        organizationId,
        customerId: customer.id,
        code: brandCode,
        name: brandName,
        createdById,
      },
    });
    brandIds[brandCode] = brand.id;
  }
  return { customer, brandIds };
}

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240" viewBox="0 0 600 240">
  <rect width="600" height="240" rx="24" fill="#FFFFFF"/>
  <circle cx="120" cy="120" r="72" fill="#0B6E4F"/>
  <path d="M84 132l28 28 52-64" stroke="#FFFFFF" stroke-width="18" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="220" y="138" font-family="Arial, sans-serif" font-size="46" font-weight="700" fill="#1F2933" textLength="350" lengthAdjust="spacingAndGlyphs">DEMO ACTIVE</text>
</svg>
`;

async function seedLogoAsset(organizationId: string, createdById: string) {
  const existing = await prisma.asset.findUnique({ where: { id: SAMPLE_BRAND_LOGO_ASSET_ID } });
  if (existing) return existing;
  // Seeded content goes through the same sanitizer as uploads.
  const sanitized = sanitizeSvg(Buffer.from(LOGO_SVG, 'utf8'));
  if (!sanitized.ok) {
    throw new Error('Seed logo SVG failed sanitization');
  }
  const body = sanitized.content;
  const checksumSha256 = createHash('sha256').update(body).digest('hex');
  const storageKey = assetStorageKey(organizationId, checksumSha256);
  if (!(await storage.objectExists(storageKey))) {
    await storage.putObject(storageKey, body, { contentType: 'image/svg+xml', checksumSha256 });
  }
  return prisma.asset.create({
    data: {
      id: SAMPLE_BRAND_LOGO_ASSET_ID,
      organizationId,
      assetType: 'LOGO',
      filename: 'demo-active-logo.svg',
      mimeType: 'image/svg+xml',
      sizeBytes: body.length,
      storageKey,
      checksumSha256,
      widthPx: 600,
      heightPx: 240,
      createdById,
    },
  });
}

/**
 * OFL-licensed Noto fonts (seed-assets/fonts/OFL.txt). Checksums are pinned so a corrupted or
 * substituted file can never enter the registry silently.
 */
const SEED_FONTS = [
  {
    id: SAMPLE_FONT_ASSET_IDS.notoSansRegular,
    file: 'NotoSans-Regular.ttf',
    sha256: 'f3961a9cde016d41a4879aecda1474d3a36d6bf54fa0e4643de029cc2248b0e8',
  },
  {
    id: SAMPLE_FONT_ASSET_IDS.notoSansMedium,
    file: 'NotoSans-Medium.ttf',
    sha256: '220e74546aee1b9a17cd50025dd917a064d0224e653f562287446c2328e4160b',
  },
  {
    id: SAMPLE_FONT_ASSET_IDS.notoSansSemiBold,
    file: 'NotoSans-SemiBold.ttf',
    sha256: 'a7af8d4a11e8e49fea9a19786a6469210b512cd4061413e8036bdd2425722795',
  },
  {
    id: SAMPLE_FONT_ASSET_IDS.notoSansBold,
    file: 'NotoSans-Bold.ttf',
    sha256: '87cb2d84472a7d66da659ee47b6cdb9552326e8c128245231f191b6ac72529d9',
  },
  {
    id: SAMPLE_FONT_ASSET_IDS.notoSansBengaliRegular,
    file: 'NotoSansBengali-Regular.ttf',
    sha256: '5dceda02816fece18ea6796f474f5d3170f1d862f21b1e809cdc94b1caa4b6ec',
  },
] as const;

/** Registers the seed fonts through the same inspection used for uploads. */
async function seedFontAssets(organizationId: string, createdById: string) {
  for (const entry of SEED_FONTS) {
    if (await prisma.asset.findUnique({ where: { id: entry.id } })) continue;
    const body = readFileSync(resolve(__dirname, 'seed-assets', 'fonts', entry.file));
    const checksumSha256 = createHash('sha256').update(body).digest('hex');
    if (checksumSha256 !== entry.sha256) {
      throw new Error(`Seed font ${entry.file} does not match its pinned checksum`);
    }
    const mimeType = inspectContent(body)?.mimeType;
    const inspection = mimeType ? inspectFont(body, mimeType) : null;
    if (!mimeType || !inspection?.ok) {
      throw new Error(`Seed font ${entry.file} could not be inspected`);
    }
    const storageKey = assetStorageKey(organizationId, checksumSha256);
    if (!(await storage.objectExists(storageKey))) {
      await storage.putObject(storageKey, body, { contentType: mimeType, checksumSha256 });
    }
    await prisma.$transaction(async (tx) => {
      await tx.asset.create({
        data: {
          id: entry.id,
          organizationId,
          assetType: 'FONT',
          filename: entry.file,
          mimeType,
          sizeBytes: body.length,
          storageKey,
          checksumSha256,
          createdById,
        },
      });
      await tx.fontFace.create({
        data: {
          organizationId,
          assetId: entry.id,
          ...inspection.font,
          unicodeRanges: inspection.font.unicodeRanges.map(([first, last]) => [first, last]),
        },
      });
    });
  }
}

async function main() {
  const yunusco = await upsertOrganization('yunusco-dev', 'Yunusco (Development)');
  const acme = await upsertOrganization('acme-demo', 'Acme Labels (Isolation Demo)');

  const admin = await upsertUser('admin@smarttag.local', 'Demo Org Admin', [
    { organizationId: yunusco.id, roles: ['ORG_ADMIN'] },
    { organizationId: acme.id, roles: ['VIEWER'] },
  ]);
  const designer = await upsertUser('designer@smarttag.local', 'Demo Designer', [
    { organizationId: yunusco.id, roles: ['DESIGNER'] },
  ]);
  const approver = await upsertUser('approver@smarttag.local', 'Demo Approver', [
    { organizationId: yunusco.id, roles: ['APPROVER', 'QA'] },
  ]);
  await upsertUser('viewer@smarttag.local', 'Demo Viewer', [
    { organizationId: yunusco.id, roles: ['VIEWER'] },
  ]);
  const acmeAdmin = await upsertUser('acme.admin@smarttag.local', 'Acme Org Admin', [
    { organizationId: acme.id, roles: ['ORG_ADMIN'] },
  ]);

  const demoApparel = await upsertCustomer(
    yunusco.id,
    admin.id,
    'DEMO-APPAREL',
    'Demo Apparel Co.',
    [
      ['DEMO-ACTIVE', 'Demo Active'],
      ['DEMO-KIDS', 'Demo Kids'],
    ],
  );
  const acmeRetail = await upsertCustomer(acme.id, acmeAdmin.id, 'ACME-RETAIL', 'Acme Retail', [
    ['ACME-BASICS', 'Acme Basics'],
  ]);

  await seedLogoAsset(yunusco.id, admin.id);
  await seedFontAssets(yunusco.id, admin.id);

  // --- Yunusco: sample hang tag with an approved v1 and a draft v2 --------------------------
  const code = 'HT-DEMO-50X90';
  if (
    !(await prisma.template.findUnique({
      where: { organizationId_code: { organizationId: yunusco.id, code } },
    }))
  ) {
    const template = await prisma.template.create({
      data: {
        organizationId: yunusco.id,
        customerId: demoApparel.customer.id,
        brandId: demoApparel.brandIds['DEMO-ACTIVE'],
        code,
        name: 'Demo Active hang tag 50 × 90 mm',
        description: 'Front/back hang tag demonstrating static and data-bound artwork.',
        documentType: 'HANG_TAG',
        latestVersionNumber: 2,
        createdById: designer.id,
        updatedById: designer.id,
      },
    });

    // Version 1 was approved with schema version 1 (Phase 1). It is stored exactly as Phase 1
    // stored it, so the database always contains a real older-schema document: readers migrate
    // it in memory, its JSON and hash are never rewritten.
    const v1Json = { ...SAMPLE_HANG_TAG_V1_JSON, documentId: template.id };
    const v1Parsed = parseDesignDocument(v1Json);
    if (!v1Parsed.valid || v1Parsed.originalSchemaVersion !== 1) {
      throw new Error('Seed v1 document is not a valid schema v1 document');
    }
    const v1 = await prisma.templateVersion.create({
      data: {
        organizationId: yunusco.id,
        templateId: template.id,
        versionNumber: 1,
        schemaVersion: 1,
        documentJson: v1Json,
        documentHash: await hashCanonicalJson(v1Json),
        summaryJson: JSON.parse(
          JSON.stringify(summarizeDesignDocument(v1Parsed.document)),
        ) as Prisma.InputJsonObject,
        changeSummary: 'Initial artwork',
        createdById: designer.id,
      },
    });
    // Walk the lifecycle so the database guard trigger validates every step.
    const submittedAt = new Date(Date.now() - 2 * 86_400_000);
    await prisma.templateVersion.update({
      where: { id: v1.id },
      data: { status: 'IN_REVIEW', submittedAt, submittedById: designer.id },
    });
    await prisma.templateVersion.update({
      where: { id: v1.id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(submittedAt.getTime() + 3_600_000),
        approvedById: approver.id,
      },
    });

    // Version 2 (DRAFT) is the current schema: same artwork with controlled fonts assigned.
    const v2Document = createSampleHangTagDocument({ documentId: template.id });
    const front = v2Document.pages[0]!;
    front.objects = front.objects.map((object) =>
      object.id === 'front-product-name' && object.type === 'text'
        ? { ...object, fontSize: 12, textColor: rgb('#0B6E4F') }
        : object,
    );
    front.objects.push(
      createTextObject({
        id: 'front-care-hint',
        name: 'Care hint',
        zIndex: 20,
        // Inside the 3 mm safe area, below the barcode (safe bottom edge = 246.6 pt).
        x: 11.34,
        y: 238,
        width: 119.06,
        // 6 pt text × 1.2 line height needs 7.2 pt; the frame leaves room for it.
        height: 8,
        content: 'Machine wash 30 °C',
        fontSize: 6,
        fontFamily: 'Noto Sans',
        fontWeight: 400,
        fontAssetId: SAMPLE_FONT_ASSET_IDS.notoSansRegular,
        textAlign: 'CENTER',
        textColor: rgb('#52606D'),
      }),
    );
    const v2 = await prisma.templateVersion.create({
      data: {
        organizationId: yunusco.id,
        templateId: template.id,
        versionNumber: 2,
        ...(await prepareDocumentForStorage(assertValidDesignDocument(v2Document))),
        changeSummary: 'Controlled fonts; larger brand-colored product name; care hint',
        basedOnVersionId: v1.id,
        createdById: designer.id,
      },
    });
    await prisma.template.update({ where: { id: template.id }, data: { currentVersionId: v2.id } });
  }

  // --- Acme (second tenant): a template that Yunusco users must never see -------------------
  const acmeCode = 'ACME-HT-BASIC';
  if (
    !(await prisma.template.findUnique({
      where: { organizationId_code: { organizationId: acme.id, code: acmeCode } },
    }))
  ) {
    const template = await prisma.template.create({
      data: {
        organizationId: acme.id,
        customerId: acmeRetail.customer.id,
        brandId: acmeRetail.brandIds['ACME-BASICS'],
        code: acmeCode,
        name: 'Acme basic hang tag 2 × 3.5 in',
        documentType: 'HANG_TAG',
        latestVersionNumber: 1,
        createdById: acmeAdmin.id,
        updatedById: acmeAdmin.id,
      },
    });
    const document = assertValidDesignDocument(
      createBlankDesignDocument({
        documentId: template.id,
        name: template.name,
        documentType: 'HANG_TAG',
        unit: 'in',
        width: 2,
        height: 3.5,
        bleed: 0.125,
        safeMargin: 0.125,
        pageLayout: 'FRONT_ONLY',
      }),
    );
    const version = await prisma.templateVersion.create({
      data: {
        organizationId: acme.id,
        templateId: template.id,
        versionNumber: 1,
        ...(await prepareDocumentForStorage(document)),
        changeSummary: 'Initial version',
        createdById: acmeAdmin.id,
      },
    });
    await prisma.template.update({
      where: { id: template.id },
      data: { currentVersionId: version.id },
    });
  }

  console.log('Seed complete. Development users (password from SEED_USER_PASSWORD):');
  for (const email of [
    'admin@smarttag.local',
    'designer@smarttag.local',
    'approver@smarttag.local',
    'viewer@smarttag.local',
    'acme.admin@smarttag.local',
  ]) {
    console.log(`  - ${email}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
