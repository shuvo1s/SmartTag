import type { PrismaClient } from '@smarttag/database';
import { PasswordHasher } from './modules/auth/password-hasher';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PASSWORD_LENGTH = 1024;

export class BootstrapAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapAdminError';
  }
}

export interface BootstrapAdminInput {
  readonly organizationName: string;
  readonly adminEmail: string;
  readonly adminPassword: string;
}

export interface NormalizedBootstrapAdminInput extends BootstrapAdminInput {
  readonly organizationSlug: string;
  readonly displayName: string;
}

export interface BootstrapAdminRuntimeConfig {
  readonly databaseUrl: string;
  readonly input: NormalizedBootstrapAdminInput;
}

export interface BootstrapAdminResult {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly userId: string;
  readonly adminEmail: string;
}

export interface PasswordHashing {
  hash(password: string): Promise<string>;
}

export interface BootstrapAdminDependencies {
  readonly passwordHasher?: PasswordHashing;
}

/**
 * Produces the first organization's stable URL-safe slug without consulting the database.
 * The bootstrap only runs against an empty database, so uniqueness does not need a suffix.
 */
export function deriveOrganizationSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');

  if (!slug) {
    throw new BootstrapAdminError(
      'BOOTSTRAP_ORGANIZATION_NAME must contain at least one ASCII letter or digit for the organization slug',
    );
  }
  return slug;
}

export function normalizeBootstrapAdminInput(
  input: BootstrapAdminInput,
): NormalizedBootstrapAdminInput {
  const organizationName = input.organizationName.trim();
  if (!organizationName) {
    throw new BootstrapAdminError('BOOTSTRAP_ORGANIZATION_NAME is required');
  }
  if (organizationName.length > 200) {
    throw new BootstrapAdminError('BOOTSTRAP_ORGANIZATION_NAME must be at most 200 characters');
  }

  const adminEmail = input.adminEmail.trim().toLowerCase();
  if (!adminEmail) {
    throw new BootstrapAdminError('BOOTSTRAP_ADMIN_EMAIL is required');
  }
  if (adminEmail.length > 320 || !EMAIL_PATTERN.test(adminEmail)) {
    throw new BootstrapAdminError('BOOTSTRAP_ADMIN_EMAIL must be a valid email address');
  }

  if (input.adminPassword.length < 12) {
    throw new BootstrapAdminError(
      'BOOTSTRAP_ADMIN_PASSWORD must be set and contain at least 12 characters',
    );
  }
  if (input.adminPassword.length > MAX_PASSWORD_LENGTH) {
    throw new BootstrapAdminError(
      `BOOTSTRAP_ADMIN_PASSWORD must be at most ${MAX_PASSWORD_LENGTH} characters`,
    );
  }

  return {
    organizationName,
    organizationSlug: deriveOrganizationSlug(organizationName),
    adminEmail,
    displayName: adminEmail.slice(0, 200),
    adminPassword: input.adminPassword,
  };
}

export function readBootstrapAdminEnvironment(env: NodeJS.ProcessEnv): BootstrapAdminRuntimeConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new BootstrapAdminError('DATABASE_URL is required');
  }

  let protocol: string;
  try {
    protocol = new URL(databaseUrl).protocol;
  } catch {
    throw new BootstrapAdminError('DATABASE_URL must be a valid PostgreSQL connection URL');
  }
  if (protocol !== 'postgresql:' && protocol !== 'postgres:') {
    throw new BootstrapAdminError('DATABASE_URL must use the postgresql:// or postgres:// scheme');
  }

  return {
    databaseUrl,
    input: normalizeBootstrapAdminInput({
      organizationName: env.BOOTSTRAP_ORGANIZATION_NAME ?? '',
      adminEmail: env.BOOTSTRAP_ADMIN_EMAIL ?? '',
      adminPassword: env.BOOTSTRAP_ADMIN_PASSWORD ?? '',
    }),
  };
}

/**
 * Creates the first tenant and local administrator exactly once.
 *
 * Safety properties:
 * - an advisory transaction lock serializes concurrent bootstrap attempts;
 * - any existing Organization OR User makes the command refuse to run;
 * - organization, Argon2id credential, membership and ORG_ADMIN role are one transaction;
 * - password plaintext and hashes are never returned or logged here.
 */
export async function bootstrapFirstAdmin(
  prisma: PrismaClient,
  input: BootstrapAdminInput,
  dependencies: BootstrapAdminDependencies = {},
): Promise<BootstrapAdminResult> {
  const normalized = normalizeBootstrapAdminInput(input);
  const passwordHasher = dependencies.passwordHasher ?? new PasswordHasher();

  return prisma.$transaction(async (tx) => {
    // PostgreSQL's advisory-lock function returns `void`, which Prisma cannot deserialize when it
    // is selected directly. Calling it in FROM still acquires the blocking transaction-scoped lock,
    // while returning only a supported boolean column to Prisma.
    await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT TRUE AS locked
      FROM pg_advisory_xact_lock(914725, 5)
    `;

    const organizationCount = await tx.organization.count();
    const userCount = await tx.user.count();
    if (organizationCount !== 0 || userCount !== 0) {
      throw new BootstrapAdminError(
        'Refusing to bootstrap: the database already contains organization or user records',
      );
    }

    const organization = await tx.organization.create({
      data: {
        slug: normalized.organizationSlug,
        name: normalized.organizationName,
      },
    });

    // Hashing intentionally happens inside the transaction. If it or any later write fails,
    // PostgreSQL rolls the organization creation back as part of the same transaction.
    const passwordHash = await passwordHasher.hash(normalized.adminPassword);
    const user = await tx.user.create({
      data: {
        email: normalized.adminEmail,
        displayName: normalized.displayName,
        passwordCredential: {
          create: { passwordHash },
        },
        memberships: {
          create: {
            organizationId: organization.id,
            roles: {
              create: [{ role: 'ORG_ADMIN' }],
            },
          },
        },
      },
    });

    return {
      organizationId: organization.id,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      userId: user.id,
      adminEmail: user.email,
    };
  });
}
