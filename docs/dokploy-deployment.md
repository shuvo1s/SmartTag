# Deploying SmartTag on Dokploy

How to run Phases 1–5 (templates, designer, data schemas, CSV/XLSX imports, production jobs with
quantities, serial numbers and manifests) as three containers on a Dokploy host.

Nothing in this document deploys anything by itself, and no command here resets, seeds or
overwrites a database. Migrations are a separate, deliberate step — see
[Database migrations](#database-migrations).

```text
Internet (HTTPS, Dokploy's reverse proxy)
  │
  ▼
SmartTag Web  :3000   Next.js — serves the UI and proxies /api/v1/* to the API
  │
  ▼
SmartTag API  :4000   NestJS — all business logic, authentication, authorization
  ├── PostgreSQL 18
  ├── Redis                (queues; the API only enqueues)
  └── S3-compatible storage
SmartTag Worker (no port) BullMQ — smarttag-system, smarttag-imports, smarttag-production
  ├── PostgreSQL 18
  ├── Redis
  └── S3-compatible storage
```

Only the web service needs a public domain. The API is reached by the web container over the
internal network, so browser requests stay same-origin and session cookies stay first-party. The
worker needs no port, no domain and no inbound access.

## Images

| Service | Dockerfile                 | Build context   | Exposed port |
| ------- | -------------------------- | --------------- | ------------ |
| Web     | `docker/web.Dockerfile`    | `.` (repo root) | 3000         |
| API     | `docker/api.Dockerfile`    | `.` (repo root) | 4000         |
| Worker  | `docker/worker.Dockerfile` | `.` (repo root) | none         |

The repository is an npm workspaces monorepo: each application is built against the other
workspaces, so the build context is always the repository root, never `apps/<app>`.

```bash
docker build -f docker/web.Dockerfile    -t smarttag-web:<tag>    .
docker build -f docker/api.Dockerfile    -t smarttag-api:<tag>    .
docker build -f docker/worker.Dockerfile -t smarttag-worker:<tag> .
```

All three images use `node:24-bookworm-slim` (the repository requires Node `^24.11.0`, and
`@node-rs/argon2` needs glibc, so Debian rather than Alpine). Pin it further per environment with
`--build-arg NODE_IMAGE=node:24-bookworm-slim@sha256:<digest>`.

Each image builds in stages — `manifests` (lockfile + every workspace manifest, so `npm ci` is
cached), `build` (`npm ci`, then `turbo run build --filter=<workspace>`), `prune`
(`npm prune --omit=dev`) and `runner` (compiled output only, running as the unprivileged `node`
user). The commands each image runs:

| Service | Build (inside the image)                        | Start (container command)                                                        |
| ------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Web     | `npx turbo run build --filter=@smarttag/web`    | `node /app/node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port 3000` |
| API     | `npx turbo run build --filter=@smarttag/api`    | `node dist/main.js` (working directory `/app/apps/api`)                          |
| Worker  | `npx turbo run build --filter=@smarttag/worker` | `node dist/main.js` (working directory `/app/apps/worker`)                       |

These are the repository's own `build` and `start` scripts, invoked without an npm process in
between so the Node process is PID 1 and receives `SIGTERM` directly. No development watcher
(`next dev`, `nest --watch`, `tsx watch`, `nodemon`) is used anywhere.

The API and worker images both run `prisma generate` during the build (it is part of
`@smarttag/database`'s build script) and require no database connection to do so.

## Environment variables

Every variable below is read from the **process environment at startup** and validated with Zod
(`apps/api/src/config/env.schema.ts`, `apps/worker/src/config.ts`,
`packages/object-storage/src/environment.ts`, `packages/import-processing/src/config.ts`,
`packages/production-processing/src/config.ts`). An invalid value stops the process with a message
naming the variable — never its value.

**There are no build-time variables.** The web application uses no `NEXT_PUBLIC_*` variable, so one
image runs in any environment. Nothing environment-specific is compiled into any image.

Set them in Dokploy's _Environment_ tab per application. Do not add `.env` files to the images.

### Web

| Variable           | Required | Default                         | Notes                                                                                                                                                                                            |
| ------------------ | -------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `API_INTERNAL_URL` | **yes**  | `http://127.0.0.1:4000`         | Where `/api/v1/*` is forwarded, read per request. Must be the API's internal address, e.g. `http://smarttag-api:4000`. The built-in default points at the web container itself and yields `502`. |
| `NODE_ENV`         | no       | `production` (set in the image) | Leave as is.                                                                                                                                                                                     |
| `PORT`             | no       | `3000` (set in the image)       | The start command passes `--port 3000` explicitly; map the port outside the container instead of changing this.                                                                                  |

The web app holds no credentials, no database connection and no session secret. It is transport
and presentation only.

### API

Required:

| Variable              | Notes                                                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | `postgresql://user:password@host:5432/database`. Same database as the worker.                                                                                                                                                                 |
| `API_ALLOWED_ORIGINS` | Comma-separated browser origins allowed to send state-changing requests (CSRF defence, `OriginGuard`). In production this is the public web origin, e.g. `https://smarttag.example.com`. Default `http://localhost:3000` is development only. |

Strongly recommended in this architecture:

| Variable          | Default                                                     | Notes                                                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REDIS_URL`       | unset                                                       | `redis://host:6379` or `rediss://…`. **Optional by schema**, but without it data imports and production jobs cannot be queued and those endpoints answer `503 SERVICE_UNAVAILABLE`. Phases 4 and 5 need it. |
| `API_TRUST_PROXY` | `false`                                                     | `true` behind Dokploy's proxy and the web container, so client addresses are read from `X-Forwarded-For` (trusted only from loopback/private ranges).                                                       |
| `NODE_ENV`        | `production` (set in the image)                             | Also makes `AUTH_COOKIE_SECURE` default to `true` and makes the development seed refuse to run.                                                                                                             |
| `API_HOST`        | `0.0.0.0` (set in the image; schema default is `127.0.0.1`) | Must stay `0.0.0.0` inside a container.                                                                                                                                                                     |
| `API_PORT`        | `4000` (set in the image)                                   | Change only together with the service port.                                                                                                                                                                 |
| `LOG_LEVEL`       | `info`                                                      | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`.                                                                                                                                               |

Authentication and sessions:

| Variable                            | Default                           | Notes                                                                                                                         |
| ----------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_COOKIE_SECURE`                | `true` when `NODE_ENV=production` | Must not be disabled in production (the schema rejects it). `true` enables the `__Host-` cookie prefix, which requires HTTPS. |
| `AUTH_SESSION_TTL_HOURS`            | `12`                              | 1 – 720.                                                                                                                      |
| `AUTH_SESSION_IDLE_TIMEOUT_MINUTES` | `120`                             | 5 – 1440.                                                                                                                     |
| `AUTH_LOGIN_RATE_LIMIT_PER_MINUTE`  | `10`                              | 1 – 10000.                                                                                                                    |

> **There is no session secret, JWT secret or signing key in this platform.** Sessions are
> 256-bit random tokens (`node:crypto`) stored only as SHA-256 hashes in PostgreSQL
> (`apps/api/src/modules/auth/session-token.ts`); passwords are Argon2id hashes. The secrets to
> protect are therefore the database credentials, the Redis URL and the object-storage keys —
> nothing else. Do not invent a `SESSION_SECRET`/`JWT_SECRET`: no code reads one.

Object storage (shared with the worker):

| Variable                           | Default             | Notes                                                                                                                                                   |
| ---------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OBJECT_STORAGE_DRIVER`            | `local`             | `s3` for production (any S3-compatible store: AWS S3, Cloudflare R2, MinIO).                                                                            |
| `OBJECT_STORAGE_BUCKET`            | —                   | **Required when the driver is `s3`.**                                                                                                                   |
| `OBJECT_STORAGE_REGION`            | `us-east-1`         |                                                                                                                                                         |
| `OBJECT_STORAGE_ENDPOINT`          | unset               | Needed for R2/MinIO; an `http(s)` URL.                                                                                                                  |
| `OBJECT_STORAGE_FORCE_PATH_STYLE`  | `false`             | `true` for MinIO and most self-hosted stores.                                                                                                           |
| `OBJECT_STORAGE_ACCESS_KEY_ID`     | unset               | Secret. Omit both keys to use the AWS default credential chain (IAM role).                                                                              |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | unset               | Secret.                                                                                                                                                 |
| `OBJECT_STORAGE_LOCAL_ROOT`        | `../../storage`     | `local` driver only. In a container use an **absolute** path on a volume shared with the worker (relative paths resolve against the working directory). |
| `ASSET_MAX_UPLOAD_BYTES`           | `26214400` (25 MiB) | 1 KiB – 512 MiB.                                                                                                                                        |

Import limits (Phase 4) — optional, defaults shown; **must match the worker's values**:

| Variable                               | Default     | Allowed range |
| -------------------------------------- | ----------- | ------------- |
| `IMPORT_MAX_FILE_BYTES`                | `52428800`  | 1 KiB – 1 GiB |
| `IMPORT_MAX_ROWS`                      | `100000`    | 1 – 1 000 000 |
| `IMPORT_MAX_COLUMNS`                   | `250`       | 1 – 16 384    |
| `IMPORT_MAX_SHEETS`                    | `50`        | 1 – 1 000     |
| `IMPORT_MAX_CELL_CHARS`                | `10000`     | 16 – 10 000   |
| `IMPORT_MAX_HEADER_CHARS`              | `256`       | 16 – 1 000    |
| `IMPORT_PREVIEW_ROWS`                  | `25`        | 2 – 100       |
| `IMPORT_XLSX_MAX_ENTRIES`              | `1000`      | 16 – 100 000  |
| `IMPORT_XLSX_MAX_UNCOMPRESSED_BYTES`   | `536870912` | 1 MiB – 8 GiB |
| `IMPORT_XLSX_MAX_COMPRESSION_RATIO`    | `200`       | 10 – 10 000   |
| `IMPORT_XLSX_MAX_SHARED_STRINGS_BYTES` | `134217728` | 1 KiB – 2 GiB |
| `IMPORT_VALIDATION_BATCH_SIZE`         | `500`       | 10 – 5 000    |
| `IMPORT_ABANDONED_AFTER_HOURS`         | `336`       | 1 – 8 760     |
| `IMPORT_PENDING_UPLOAD_AFTER_MINUTES`  | `60`        | 5 – 1 440     |
| `IMPORT_STALLED_AFTER_MINUTES`         | `30`        | 5 – 1 440     |

Production limits (Phase 5) — optional, defaults shown; **must match the worker's values**:

| Variable                             | Default   | Allowed range  | Meaning                                         |
| ------------------------------------ | --------- | -------------- | ----------------------------------------------- |
| `PRODUCTION_MAX_QUANTITY_PER_RECORD` | `100000`  | 1 – 10 000 000 | Largest quantity one dataset record may ask for |
| `PRODUCTION_MAX_INSTANCES_PER_JOB`   | `1000000` | 1 – 50 000 000 | Largest number of tags in one job               |
| `PRODUCTION_MAX_SELECTED_RECORDS`    | `100000`  | 1 – 1 000 000  | Largest explicit record selection               |
| `PRODUCTION_EXPANSION_BATCH_SIZE`    | `1000`    | 50 – 10 000    | Instances written per statement                 |
| `PRODUCTION_RECORD_BATCH_SIZE`       | `1000`    | 50 – 10 000    | Dataset records read per batch                  |
| `PRODUCTION_SERIAL_PREVIEW_COUNT`    | `5`       | 1 – 50         | Serial numbers shown in a preview               |

`SEED_USER_PASSWORD` belongs to the development seed only. **Do not set it in production.**

### Worker

| Variable                          | Required | Default                         | Notes                                                                       |
| --------------------------------- | -------- | ------------------------------- | --------------------------------------------------------------------------- |
| `REDIS_URL`                       | **yes**  | —                               | Same Redis as the API. The worker exits if it is missing.                   |
| `DATABASE_URL`                    | **yes**  | —                               | Same database as the API.                                                   |
| `NODE_ENV`                        | no       | `production` (set in the image) |                                                                             |
| `LOG_LEVEL`                       | no       | `info`                          |                                                                             |
| `WORKER_CONCURRENCY`              | no       | `4`                             | 1 – 64. System queue (`smarttag-system`).                                   |
| `IMPORT_WORKER_CONCURRENCY`       | no       | `2`                             | 1 – 16. `smarttag-imports`; CPU and database heavy, keep low.               |
| `PRODUCTION_WORKER_CONCURRENCY`   | no       | `2`                             | 1 – 16. `smarttag-production`; CPU and database heavy, keep low.            |
| `IMPORT_CLEANUP_INTERVAL_MINUTES` | no       | `60`                            | 1 – 1 440. How often `data.cleanup` is scheduled.                           |
| `OBJECT_STORAGE_*`                | as API   | as API                          | Identical values to the API — the worker reads and writes the same objects. |
| `IMPORT_*`, `PRODUCTION_*`        | as API   | as API                          | Identical values to the API.                                                |

Queues and jobs (fixed in `packages/shared-types/src/jobs.ts`, not configurable):

| Queue                 | Jobs                                                | Phase |
| --------------------- | --------------------------------------------------- | ----- |
| `smarttag-system`     | `system.ping`                                       | 1     |
| `smarttag-imports`    | `import.inspect`, `import.validate`, `data.cleanup` | 4     |
| `smarttag-production` | `production.expand`, `production.release`           | 5     |

### Which values must match between API and worker

Both processes read the same records, objects and limits, so these must be identical:

- `DATABASE_URL` — the same database.
- `REDIS_URL` — the same Redis instance and database number; queue names are fixed.
- every `OBJECT_STORAGE_*` variable — the same bucket/root, so an uploaded file is found by the
  worker and a written manifest is found by the API.
- every `IMPORT_*` limit — the API validates an upload against them and the worker enforces them
  again while parsing; different values make an upload fail mid-import.
- every `PRODUCTION_*` limit — the API checks a job against them before queueing and the worker
  enforces them while expanding.

`NODE_ENV` and `LOG_LEVEL` should also match. Everything else (`API_*`, `AUTH_*`,
`*_CONCURRENCY`) belongs to one service only.

## Database migrations

Migrations are **a separate, controlled step**, run once per release by an operator. No image runs
them at container start: a starting API or worker container never touches the schema.

The repository command is:

```bash
npm run db:migrate:deploy     # → prisma migrate deploy, in packages/database
```

The runtime images deliberately do not contain the Prisma CLI (it is a development dependency), so
the API Dockerfile provides a one-off `migrate` target with the CLI, the schema and the migrations:

```bash
# 1. Build the migration image from the same commit as the release.
docker build -f docker/api.Dockerfile --target migrate -t smarttag-migrate:<tag> .

# 2. Apply the migrations. Nothing else runs in this container; it exits when they are applied.
docker run --rm \
  -e DATABASE_URL="postgresql://user:password@host:5432/smarttag" \
  --network <dokploy-network> \
  smarttag-migrate:<tag>
```

`DATABASE_URL` is read from the process environment (`packages/database/prisma.config.ts`); the
image contains no `.env` file.

Order for a release: **migrate first, then deploy the API and worker.** Prisma migrations in this
repository are additive, so the previous version keeps running while they apply.

To see what would be applied before applying it:

```bash
docker run --rm -e DATABASE_URL="…" -w /app/packages/database smarttag-migrate:<tag> \
  npx prisma migrate status
```

The working directory matters: the Prisma CLI finds `prisma.config.ts` — and with it the schema,
the migrations directory and the `DATABASE_URL` — in `packages/database`. `npm run
db:migrate:deploy` takes care of that itself (`-w @smarttag/database`).

### PostgreSQL requirements and `btree_gist`

PostgreSQL 16 or newer (developed and benchmarked on 18).

Phase 5 guarantees that two production jobs can never receive overlapping serial number ranges with
an exclusion constraint that compares a uuid with `=` and an `int8range` with `&&` in one GiST
index. That needs the standard contrib extension **`btree_gist`**.

The migration creates it itself —
`packages/database/prisma/migrations/20260916085600_production_integrity/migration.sql` contains:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

so no manual step is needed **when the migration role may create extensions** (a superuser, an
`rds_superuser` on RDS, or the owner role on most managed Postgres offerings). It is the only
`CREATE EXTENSION` in the repository.

If the role may not create extensions, the migration fails with
`permission denied to create extension "btree_gist"`. Then, before running the migration, have a
superuser install it once into the target database:

```sql
-- as a superuser, connected to the SmartTag database
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

`IF NOT EXISTS` makes the migration a no-op afterwards, so nothing needs to be edited. The contrib
package must be present on the server (`postgresql-contrib` on Debian/Ubuntu; already included in
the `postgres` Docker images and on AWS RDS, Azure Database and Google Cloud SQL, where it may also
need to be allow-listed in the server parameters).

Check whether it is already installed:

```sql
SELECT extname FROM pg_extension WHERE extname = 'btree_gist';
```

If a migration fails halfway, resolve it deliberately (`prisma migrate resolve --rolled-back
<migration>`) after fixing the cause, and run `migrate deploy` again. Never "fix" it with
`db push`.

## Production database safety

Never run any of these against a production database:

| Command                | Why not                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `prisma migrate reset` | Drops and recreates the schema — total data loss.                                                    |
| `prisma db push`       | Changes the schema without a migration; drifts from the history.                                     |
| `prisma migrate dev`   | Development command; may create and apply new migrations.                                            |
| `npm run db:seed`      | Development data. It refuses `NODE_ENV=production` and non-local hosts, but must never be attempted. |

Safe procedure for every release:

1. Back up the database (Dokploy's backup feature or `pg_dump`), and verify the backup exists.
2. Build the images from the release commit.
3. Run `prisma migrate status` to see what is pending.
4. Apply with the `migrate` target above (`prisma migrate deploy` only applies committed
   migrations; it never resets, pushes or seeds).
5. Deploy the API and worker, then the web.
6. Check `GET /api/v1/health` and the worker's `worker ready` log line.

The database user the applications run as needs only `SELECT`/`INSERT`/`UPDATE`/`DELETE`; it does
not need to own the schema. Migrations may be run by a different, more privileged role.

## Health checks

| Service | Endpoint             | Expected                                                                                                                                                                                         |
| ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API     | `GET /api/v1/health` | `200 {"status":"ok","database":"up"}`; `503 {"status":"degraded","database":"down"}` when the database is unreachable. Public (no authentication), and it verifies the database with `SELECT 1`. |
| Web     | `GET /login`         | `200`. See the note below.                                                                                                                                                                       |
| Worker  | none                 | No HTTP server. See the note below.                                                                                                                                                              |

The API endpoint is the real one to watch: it is the only endpoint that reports a dependency.
Through the web app it is also reachable at `https://<public-domain>/api/v1/health`, which checks
the proxy and the API in one request — a good external uptime check.

**Web:** the application has **no dedicated health endpoint**. `/login` is used as a liveness probe
because it is server-rendered, needs no session and makes no API call, but it is a page, not a
health contract. A small `GET /api/health` route in the web app (returning `200` without touching
the API) would be the better long-term answer; it is not implemented here, as this task changed no
application code.

**Worker:** it serves no HTTP traffic, so there is nothing to probe and none was invented. It exits
non-zero on an unrecoverable startup error (invalid environment, unreachable Redis) and the
container runtime restarts it; `SIGTERM` closes the queues and disconnects Prisma first. Watch it
through its logs (`worker ready`, `job failed`) and through job state in the application.

The web and API images also declare a Docker `HEALTHCHECK` (30 s interval, 30 s start period, 3
retries) so `docker ps` and Dokploy show container health without extra configuration.

## Security

What the images guarantee:

- **No secrets in any layer.** `.dockerignore` excludes every `.env` file, and no `ENV` line
  contains a credential. `DATABASE_URL`, `REDIS_URL` and the storage keys exist only in the
  container's runtime environment.
- **No Git history**: `.git` is excluded from the build context.
- **No development credentials and no seed**: the seed script is never invoked, and
  `SEED_USER_PASSWORD` is not set. The local `storage/`, `.local/` and `infra/` directories and
  `docker-compose.yml` (the developer's Postgres/Redis/MinIO stack, with development passwords) are
  excluded from the context.
- **Non-root**: all three runners run as the image's unprivileged `node` user.
- **No build-time secrets**: nothing is compiled into the images, so an image can be rebuilt and
  promoted between environments unchanged.
- **Development dependencies removed** (`npm prune --omit=dev`): no TypeScript compiler, no test
  tooling and — in the runtime images — no Prisma CLI.

What the deployment must guarantee:

- **Only the web service gets a public domain.** The API is internal; PostgreSQL and Redis are
  never published to the internet (no host port mapping, private network only).
- **HTTPS with a valid certificate**, because `AUTH_COOKIE_SECURE=true` (the production default)
  sets `Secure` and the `__Host-` cookie prefix. Over plain HTTP no one can sign in.
- `API_ALLOWED_ORIGINS` lists exactly the public web origin(s) — it is the CSRF defence.
- Object storage credentials are scoped to the SmartTag bucket, and the bucket is private.
- Keep the object store and the database in the same failure domain for backups: a manifest in the
  bucket and its row in the database belong together.

## Dokploy setup

Three applications in one Dokploy project, all from the same Git repository and commit, all with
**Build type: Dockerfile** and **Build context: `.`**:

| Application       | Dockerfile path            | Port | Domain             |
| ----------------- | -------------------------- | ---- | ------------------ |
| `smarttag-api`    | `docker/api.Dockerfile`    | 4000 | none (internal)    |
| `smarttag-worker` | `docker/worker.Dockerfile` | —    | none               |
| `smarttag-web`    | `docker/web.Dockerfile`    | 3000 | your public domain |

1. Create the PostgreSQL 18 and Redis services in the same project (Dokploy's database services, or
   point at managed instances). Do not publish their ports.
2. Create the three applications, set the environment variables above, and attach them to the same
   internal network, so `API_INTERNAL_URL=http://smarttag-api:4000` resolves.
3. Apply the migrations (see above) **before** the first API start.
4. Deploy API → worker → web, then check `https://<domain>/api/v1/health`.
5. Create the first organization and user. The development seed must not be used in production; a
   production bootstrap path is not part of Phases 1–5.

Notes specific to this repository:

- Build the images for the host's architecture (`linux/amd64` on a typical Dokploy VPS).
  `@node-rs/argon2`, `@next/swc` and `lightningcss` are native and platform-specific.
- The builds run `npm ci` for the whole workspace and then build only the target application, so
  expect a few minutes per image on a small VPS, and give the builder at least 4 GB of memory for
  `next build`.
- Both images ship the full production dependency set of the workspace (one hoisted
  `node_modules`), which is larger than a per-application install. `turbo prune` could trim this
  later; it is not used here because it relies on Git metadata, which is deliberately excluded from
  the build context.
- If the object storage driver is `local`, the API and the worker must share one writable volume
  mounted at the same absolute `OBJECT_STORAGE_LOCAL_ROOT` path. S3-compatible storage is the
  supported production choice.

## What this deployment does not include

Phases 1–5 stop at a released production job with a verified manifest. Rendering, print-ready
PDF/X, CMYK, imposition, RIP or printer integration are later phases: nothing in these images
produces a print file.
