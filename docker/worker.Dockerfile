# SmartTag worker (@smarttag/worker, BullMQ) — production image.
#
#   docker build -f docker/worker.Dockerfile -t smarttag-worker .
#
# Build context: the repository root.
#
# The worker consumes three queues (packages/shared-types/src/jobs.ts):
#   smarttag-system      system.ping
#   smarttag-imports     import.inspect, import.validate, data.cleanup   (Phase 4)
#   smarttag-production  production.expand, production.release           (Phase 5)
#
# It serves no HTTP traffic: no port is exposed and it needs no public domain. DATABASE_URL,
# REDIS_URL, the object storage settings and the IMPORT_*/PRODUCTION_* limits are read from the
# process environment at startup (apps/worker/src/config.ts) and must match the API's values.
# This image never runs database migrations.

ARG NODE_IMAGE=node:24-bookworm-slim

# ------------------------------------------------------------------------------------------------
# base — the runtime Node.js, shared by every stage
# ------------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1
WORKDIR /app

# ------------------------------------------------------------------------------------------------
# manifests — every workspace manifest plus the lockfile, so `npm ci` caches independently of source
# ------------------------------------------------------------------------------------------------
FROM base AS manifests
COPY package.json package-lock.json .npmrc turbo.json tsconfig.base.json ./
COPY packages/barcode-bwip/package.json packages/barcode-bwip/
COPY packages/barcode-core/package.json packages/barcode-core/
COPY packages/canvas-adapter/package.json packages/canvas-adapter/
COPY packages/config/package.json packages/config/
COPY packages/data-core/package.json packages/data-core/
COPY packages/database/package.json packages/database/
COPY packages/document-schema/package.json packages/document-schema/
COPY packages/document-utils/package.json packages/document-utils/
COPY packages/editor-core/package.json packages/editor-core/
COPY packages/expression-core/package.json packages/expression-core/
COPY packages/import-core/package.json packages/import-core/
COPY packages/import-processing/package.json packages/import-processing/
COPY packages/object-storage/package.json packages/object-storage/
COPY packages/production-core/package.json packages/production-core/
COPY packages/production-processing/package.json packages/production-processing/
COPY packages/rendering-core/package.json packages/rendering-core/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/tabular-sources/package.json packages/tabular-sources/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY e2e/package.json e2e/

# ------------------------------------------------------------------------------------------------
# build — install every dependency and compile the worker with its workspace dependencies
# ------------------------------------------------------------------------------------------------
FROM manifests AS build
# Prisma's CLI detects the platform's OpenSSL when it generates the client.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN npm ci --no-audit --no-fund
COPY . .
# `build` depends on `^build`, so this compiles every workspace the worker needs: @smarttag/config,
# @smarttag/database (runs `prisma generate`), @smarttag/object-storage, @smarttag/shared-types and
# the Phase 4 + Phase 5 processing packages (@smarttag/import-processing,
# @smarttag/production-processing) with their own dependencies.
RUN npx turbo run build --filter=@smarttag/worker

# ------------------------------------------------------------------------------------------------
# prune — the same tree with development dependencies removed
# ------------------------------------------------------------------------------------------------
FROM build AS prune
# Development dependencies (TypeScript, the Prisma CLI, test tooling) do not ship.
RUN npm prune --omit=dev --no-audit --no-fund
# npm keeps some dependencies next to the workspace that needs them rather than hoisting them. The
# directory is created unconditionally so the runner's COPY works whether or not anything was nested.
RUN mkdir -p apps/worker/node_modules

# ------------------------------------------------------------------------------------------------
# runner — compiled JavaScript, production dependencies, non-root, no port
# ------------------------------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
COPY --from=prune --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=prune --chown=node:node /app/node_modules ./node_modules
# Workspace packages: node_modules/@smarttag/* are symlinks into these directories.
COPY --from=prune --chown=node:node /app/packages ./packages
COPY --from=prune --chown=node:node /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=prune --chown=node:node /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=prune --chown=node:node /app/apps/worker/dist ./apps/worker/dist

USER node
WORKDIR /app/apps/worker

# No HTTP server, so no HEALTHCHECK: the process exits on an unrecoverable startup error (invalid
# environment, unreachable Redis) and the container runtime restarts it. Queue health is observed
# through the API and the logs.

# Equivalent to `npm run start -w @smarttag/worker`, without the npm process in between.
# SIGTERM is handled in apps/worker/src/main.ts: workers close, then Prisma disconnects.
CMD ["node", "dist/main.js"]
