# SmartTag web (@smarttag/web, Next.js) — production image.
#
#   docker build -f docker/web.Dockerfile -t smarttag-web .
#
# Build context: the repository root.
#
# The browser talks only to this origin. `/api/v1/*` is forwarded to the NestJS API by the
# streaming route handler in apps/web/src/app/api/v1/[...path]/route.ts, which reads
# API_INTERNAL_URL **at runtime** (apps/web/src/lib/api-proxy.ts) — the same image therefore runs
# against any environment, and session cookies stay first-party. API_INTERNAL_URL is deliberately
# not baked into the image: it is set per environment. No secret is needed to build or run this
# image; the web app holds none.

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
# build — install every dependency and build the Next.js application
# ------------------------------------------------------------------------------------------------
FROM manifests AS build
RUN npm ci --no-audit --no-fund
COPY . .
# `build` depends on `^build`, so this compiles the workspace packages the web app imports and then
# runs `next build` (apps/web/package.json). No NEXT_PUBLIC_* variable is used by this application,
# so nothing environment-specific is compiled in.
RUN npx turbo run build --filter=@smarttag/web

# ------------------------------------------------------------------------------------------------
# prune — the same tree with development dependencies removed
# ------------------------------------------------------------------------------------------------
FROM build AS prune
# Development dependencies (TypeScript, Tailwind, test tooling) do not ship.
RUN npm prune --omit=dev --no-audit --no-fund
# npm keeps a few dependencies next to the workspace that needs them rather than hoisting them
# (apps/web/node_modules/@hookform/resolvers, for one). The directory is created unconditionally so
# the runner's COPY works whether or not anything was nested.
RUN mkdir -p apps/web/node_modules

# ------------------------------------------------------------------------------------------------
# runner — the built application, production dependencies, non-root
# ------------------------------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000
COPY --from=prune --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=prune --chown=node:node /app/node_modules ./node_modules
# Workspace packages: node_modules/@smarttag/* are symlinks into these directories, and
# @smarttag/ui is consumed as source (next.config.ts transpilePackages).
COPY --from=prune --chown=node:node /app/packages ./packages
COPY --from=prune --chown=node:node /app/apps/web/package.json /app/apps/web/next.config.ts ./apps/web/
COPY --from=prune --chown=node:node /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=prune --chown=node:node /app/apps/web/.next ./apps/web/.next

USER node
WORKDIR /app/apps/web
EXPOSE 3000

# /login is server-rendered and needs no session and no API call.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Equivalent to `npm run start -w @smarttag/web`, with the bind address stated explicitly and
# without the npm process in between.
CMD ["node", "/app/node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
