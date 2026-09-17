import { createDatabaseClient } from '@smarttag/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BootstrapAdminError,
  bootstrapFirstAdmin,
  type BootstrapAdminInput,
} from '../../src/bootstrap-admin';
import { PasswordHasher } from '../../src/modules/auth/password-hasher';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is not set');
}

const prisma = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 2 });
const password = 'Integration-Bootstrap-Password-1';
const input: BootstrapAdminInput = {
  organizationName: 'Yunusco T&A (BD) Limited',
  adminEmail: 'FIRST.ADMIN@EXAMPLE.COM',
  adminPassword: password,
};

async function resetIdentityData(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "membership_roles", "memberships", "password_credentials", "users", "organizations" CASCADE',
  );
}

describe('production first-admin bootstrap', () => {
  beforeEach(async () => {
    await resetIdentityData();
  });

  afterAll(async () => {
    await resetIdentityData();
    await prisma.$disconnect();
  });

  it('creates one organization, Argon2id credential, membership and ORG_ADMIN role', async () => {
    const result = await bootstrapFirstAdmin(prisma, input);

    expect(result.organizationName).toBe('Yunusco T&A (BD) Limited');
    expect(result.organizationSlug).toBe('yunusco-t-and-a-bd-limited');
    expect(result.adminEmail).toBe('first.admin@example.com');

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: result.userId },
      include: {
        passwordCredential: true,
        memberships: { include: { roles: true } },
      },
    });

    expect(user.email).toBe('first.admin@example.com');
    expect(user.displayName).toBe('first.admin@example.com');
    expect(user.memberships).toHaveLength(1);
    expect(user.memberships[0]?.organizationId).toBe(result.organizationId);
    expect(user.memberships[0]?.roles.map(({ role }) => role)).toEqual(['ORG_ADMIN']);

    const passwordHash = user.passwordCredential?.passwordHash;
    expect(passwordHash).toBeDefined();
    expect(passwordHash).not.toBe(password);
    if (!passwordHash) throw new Error('bootstrap did not create a password hash');
    await expect(new PasswordHasher().verify(passwordHash, password)).resolves.toBe(true);
  });

  it('refuses a second run and leaves the first bootstrap unchanged', async () => {
    const first = await bootstrapFirstAdmin(prisma, input);

    await expect(bootstrapFirstAdmin(prisma, input)).rejects.toBeInstanceOf(BootstrapAdminError);
    await expect(bootstrapFirstAdmin(prisma, input)).rejects.toThrow(/already contains/);

    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.membership.count()).toBe(1);
    expect(await prisma.membershipRole.count()).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: first.userId } })).not.toBeNull();
  });

  it('refuses when an organization already exists even if no user exists', async () => {
    await prisma.organization.create({ data: { slug: 'existing', name: 'Existing Organization' } });

    await expect(bootstrapFirstAdmin(prisma, input)).rejects.toThrow(/already contains/);
    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.user.count()).toBe(0);
  });

  it('rolls the organization back when hashing fails after the organization insert', async () => {
    await expect(
      bootstrapFirstAdmin(prisma, input, {
        passwordHasher: {
          hash: async () => {
            throw new Error('synthetic hash failure');
          },
        },
      }),
    ).rejects.toThrow('synthetic hash failure');

    expect(await prisma.organization.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.membership.count()).toBe(0);
    expect(await prisma.membershipRole.count()).toBe(0);
  });
});
