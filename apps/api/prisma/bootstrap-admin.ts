import 'dotenv/config';
import { PrismaClient, prismaClientOptions } from '@smarttag/database';
import {
  BootstrapAdminError,
  bootstrapFirstAdmin,
  readBootstrapAdminEnvironment,
} from '../src/bootstrap-admin';

async function main(): Promise<void> {
  const config = readBootstrapAdminEnvironment(process.env);
  const prisma = new PrismaClient(
    prismaClientOptions({ connectionString: config.databaseUrl, maxConnections: 1 }),
  );

  try {
    const result = await bootstrapFirstAdmin(prisma, config.input);
    process.stdout.write(
      `Bootstrap complete: organization "${result.organizationName}" (${result.organizationSlug}); administrator ${result.adminEmail}; role ORG_ADMIN.\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof BootstrapAdminError
      ? error.message
      : 'Bootstrap failed; no partial bootstrap data was committed.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
