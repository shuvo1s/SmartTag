# One-time production bootstrap

SmartTag's development seed is deliberately blocked in production. A brand-new production or testing database therefore needs the one-time bootstrap command below after committed migrations have been applied.

The command creates exactly:

- one `Organization`;
- one `User` with an Argon2id `PasswordCredential`;
- one active `Membership` in that organization; and
- one `ORG_ADMIN` membership role.

It is intentionally conservative: if the database already contains **any organization or any user**, it refuses to run. The operation is transactional, so a failure does not leave a partial tenant or administrator behind. A PostgreSQL advisory transaction lock also serializes concurrent bootstrap attempts.

## Required environment variables

```env
DATABASE_URL=postgresql://user:password@host:5432/smarttagdb
BOOTSTRAP_ORGANIZATION_NAME=Yunusco T&A (BD) Limited
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=<strong password, minimum 12 characters>
```

Do not commit these values to Git and do not paste the password into deployment logs. The password is never logged by the bootstrap command.

## Repository command

From the repository root:

```bash
npm run db:bootstrap-admin
```

This command is **not** `npm run db:seed`. The development seed keeps its existing production guard and must not be used against a production database.

## Dokploy / Docker procedure

Run migrations first. Then build the one-off bootstrap target from the same release commit:

```bash
docker build -f docker/api.Dockerfile --target bootstrap -t smarttag-bootstrap:<tag> .
```

Run it once on the same private network as PostgreSQL:

```bash
docker run --rm \
  -e DATABASE_URL="postgresql://user:password@host:5432/smarttagdb" \
  -e BOOTSTRAP_ORGANIZATION_NAME="Yunusco T&A (BD) Limited" \
  -e BOOTSTRAP_ADMIN_EMAIL="admin@example.com" \
  -e BOOTSTRAP_ADMIN_PASSWORD="<strong password>" \
  --network <dokploy-network> \
  smarttag-bootstrap:<tag>
```

For Dokploy, the equivalent is a temporary application/service configured with:

- branch: `deploy/phase-5-dokploy`;
- Dockerfile: `docker/api.Dockerfile`;
- build context: `.`;
- target/stage: `bootstrap`;
- only the four environment variables above;
- no public domain; and
- autodeploy disabled.

After it exits successfully, remove or disable the temporary bootstrap service and remove `BOOTSTRAP_ADMIN_PASSWORD` from its environment.

## Expected result

Success prints the organization name/slug, administrator email and `ORG_ADMIN` role. It does **not** print the password or password hash.

A second run must fail with a message that the database already contains organization or user records. This refusal is expected and is the protection against accidentally creating another initial tenant.

## Safety notes

- Apply committed migrations before bootstrapping.
- Never use `prisma migrate reset`, `prisma db push`, or `prisma migrate dev` on production.
- Never use the development seed for production bootstrap.
- Do not manually insert a password hash with SQL.
- Back up any non-empty database before schema or data operations.
