# SmartTag Platform

Enterprise web platform for label and hang-tag artwork, variable data printing and print
production, built around a **canonical, versioned document model**.

> **Status: Phase 1 — platform foundation.** Canonical DesignDocument schema, validation, hashing,
> multi-tenant API with authentication and RBAC, immutable template versions, asset storage, and a
> basic templates UI with a document preview. The visual designer, batch VDP, barcode generation
> and print-ready PDF are later phases.

## Stack

| Layer    | Technology                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------- |
| Web      | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, TanStack Query, React Hook Form |
| API      | NestJS 11, Zod contracts, pino logging                                                         |
| Database | PostgreSQL (16+; developed on 18), Prisma 7 migrations                                         |
| Jobs     | BullMQ + Redis (foundation)                                                                    |
| Storage  | Local filesystem or any S3-compatible store (AWS S3, Cloudflare R2, MinIO)                     |
| Tooling  | npm workspaces, Turborepo, Vitest, ESLint, Prettier                                            |

## Repository

```text
apps/api          NestJS API · prisma/ (schema, migrations, seed) · test/integration
apps/web          Next.js application
apps/worker       BullMQ worker foundation
packages/document-schema   canonical DesignDocument schema + validator + migrations
packages/document-utils    units, canonical JSON/hashing, builders, bindings, fixtures
packages/rendering-core    document → scene → SVG (framework-free)
packages/barcode-core      symbology rules and encoder contract
packages/shared-types      API contracts, roles & permissions, error codes
packages/ui                React UI primitives
packages/config            shared tsconfig/ESLint presets, env validation
docs/                      architecture and design documentation
```

## Getting started

Prerequisites: Node.js 24 LTS (≥ 24.11; `.nvmrc` pins 24.21.0) and npm 11. For infrastructure you need
**either** Docker **or** a local PostgreSQL installation.

```bash
npm install

# 1. Infrastructure — choose one
npm run infra:up                 # Docker: PostgreSQL :55432, Redis :56379, MinIO :59000/:59001
npm run pg:local -- init         # No Docker: isolated project-local PostgreSQL cluster on :55432
                                 #   (uses installed PostgreSQL binaries; never touches existing servers)

# 2. Configuration
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/worker/.env.example apps/worker/.env      # only needed to run the worker (requires Redis)

# 3. Database
npm run db:migrate:deploy        # apply migrations
npm run db:seed                  # development data only (refuses production / non-local hosts)

# 4. Run
npm run dev                      # API http://127.0.0.1:4000 · web http://localhost:3000
```

Development users (password = `SEED_USER_PASSWORD` from `apps/api/.env.example`):

| Email                       | Organization / roles                                   |
| --------------------------- | ------------------------------------------------------ |
| `admin@smarttag.local`      | Yunusco (Development): ORG_ADMIN · Acme Labels: VIEWER |
| `designer@smarttag.local`   | Yunusco: DESIGNER                                      |
| `approver@smarttag.local`   | Yunusco: APPROVER, QA                                  |
| `viewer@smarttag.local`     | Yunusco: VIEWER                                        |
| `acme.admin@smarttag.local` | Acme Labels (isolation demo): ORG_ADMIN                |

Useful pages: **Templates**, a template's detail page (versions, lifecycle actions, preview) and
**Developer → Document playground** (validate and preview canonical JSON, apply a data record).

## Scripts

| Command                    | Purpose                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`             | ESLint (type-aware) across all workspaces                                                                                                                 |
| `npm run typecheck`        | TypeScript across all workspaces                                                                                                                          |
| `npm run test`             | Unit and component tests                                                                                                                                  |
| `npm run test:integration` | API integration tests against `TEST_DATABASE_URL` (a database whose name ends in `_test`; the schema is dropped and rebuilt from migrations on every run) |
| `npm run test:e2e`         | Playwright browser tests against production builds on isolated ports (API :4310, web :3310) and the disposable `smarttag_e2e` database                    |
| `npm run build`            | Production builds                                                                                                                                         |
| `npm run verify`           | All of the above, in order                                                                                                                                |
| `npm run db:migrate`       | Create a new migration in development (`prisma migrate dev`)                                                                                              |
| `npm run format`           | Prettier                                                                                                                                                  |

## Documentation

- [Architecture](docs/architecture.md)
- [Canonical document schema](docs/canonical-document-schema.md)
- [Coordinate system](docs/coordinate-system.md)
- [Browser canvas strategy](docs/browser-canvas-strategy.md)
- [Rendering strategy](docs/rendering-strategy.md)
- [Versioning strategy](docs/versioning-strategy.md)
- [VDP strategy](docs/vdp-strategy.md)
- [Security, RBAC and tenant isolation](docs/security.md)
- [API reference](docs/api.md)
