# SmartTag Platform

Enterprise web platform for label and hang-tag artwork, variable data printing and print
production, built around a **canonical, versioned document model**.

> **Status: Phase 4 — CSV/Excel import, field mapping and datasets.** On top of Phase 1
> (canonical DesignDocument, validation, hashing, multi-tenant API with RBAC, immutable versions,
> assets), Phase 2 (canvas designer, controlled fonts, real barcodes/QR codes) and Phase 3 (typed
> data schemas, field and expression bindings, Test Data preview, the shared record pipeline
> `data-core`): secure CSV/XLSX upload and inspection in the worker, sheet/header selection, field
> mapping with deterministic suggestions, explicit parsing rules, reusable mapping profiles, row
> validation through the Phase 3 pipeline, row review with visual preview, and immutable, hashed
> dataset versions. Batch VDP production, approval workflow, print-ready PDF/CMYK and preflight are
> later phases.

## Stack

| Layer    | Technology                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------- |
| Web      | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, TanStack Query, React Hook Form |
| Designer | Fabric.js 7 (isolated in `canvas-adapter`), framework-free `editor-core`, bwip-js 4 encoders   |
| Data     | `data-core` (records, bindings, validation layers), `expression-core` (safe expressions)       |
| API      | NestJS 11, Zod contracts, pino logging, fontkit (font registry), xmldom (SVG sanitizer)        |
| Database | PostgreSQL (16+; developed on 18), Prisma 7 migrations                                         |
| Jobs     | BullMQ + Redis (foundation)                                                                    |
| Storage  | Local filesystem or any S3-compatible store (AWS S3, Cloudflare R2, MinIO)                     |
| Tooling  | Node.js 24 LTS, npm workspaces, Turborepo, Vitest, Playwright, ESLint, Prettier                |

## Repository

```text
apps/api          NestJS API · prisma/ (schema, migrations, seed) · test/integration
apps/web          Next.js application
apps/worker       BullMQ worker foundation
packages/expression-core   safe expression language, exact decimals, linear-time patterns
packages/document-schema   canonical DesignDocument schema + validator + migrations
packages/document-utils    units, canonical JSON/hashing, builders, binding introspection, fixtures
packages/data-core         data records: validation, normalization, resolution, checks, hashing
packages/rendering-core    text layout engine, symbols, image placement, document → scene → SVG
packages/barcode-core      symbology rules, validation, encoder contract, symbol geometry
packages/barcode-bwip      BarcodeEncoder adapter backed by bwip-js
packages/editor-core       framework-free editor: commands, history, store, snapping, saving
packages/canvas-adapter    Fabric.js canvas (the only Fabric dependency), browser fonts/images
packages/shared-types      API contracts, roles & permissions, error codes
packages/ui                React UI primitives
packages/config            shared tsconfig/ESLint presets, env validation
e2e/                       Playwright browser tests (isolated API/web/database stack)
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

Useful pages: **Templates** (**New template** creates a blank draft and opens it in the designer),
a template's detail page (versions with **Edit in designer** for editable drafts, lifecycle actions,
preview), a version page (designer, view-only for other statuses and roles) and
**Developer → Document playground** (validate and preview canonical JSON, apply a data record).
In the designer, the **Data** panel defines fields and test data, properties bind to fields or
expressions, and **Data preview** shows the artwork with the test record.
The seed registers Noto Sans (Regular, Medium, SemiBold, Bold) and Noto Sans Bengali Regular as
controlled fonts (SIL Open Font License), a sample hang tag `HT-DEMO-50X90` with an approved schema v1
version and a schema v2 draft (both stored as genuine older-schema JSON), and `HT-VDP-50X90`, a
variable data hang tag (schema v3) with rules, expressions and conditional visibility.

The designer is desktop-first (≥ 1024 px wide). The complete browser suite runs in Chromium; a
smoke suite (login, designer, Data panel, test data, live preview, save) runs in Firefox and WebKit.

## Scripts

| Command                    | Purpose                                                                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`             | ESLint (type-aware) across all workspaces                                                                                                                                                                                               |
| `npm run typecheck`        | TypeScript across all workspaces                                                                                                                                                                                                        |
| `npm run test`             | Unit and component tests                                                                                                                                                                                                                |
| `npm run test:integration` | API integration tests against `TEST_DATABASE_URL` (a database whose name ends in `_test`; the schema is dropped and rebuilt from migrations on every run)                                                                               |
| `npm run test:e2e`         | Playwright browser tests against production builds on isolated ports (API :4310, web :3310) and the disposable `smarttag_e2e` database (Chromium; Firefox/WebKit smoke — install with `npx playwright install chromium firefox webkit`) |
| `npm run build`            | Production builds                                                                                                                                                                                                                       |
| `npm run verify`           | Format check, lint, typecheck, unit, integration and build, in order (run `test:e2e` separately)                                                                                                                                        |
| `npm run db:migrate`       | Create a new migration in development (`prisma migrate dev`)                                                                                                                                                                            |
| `npm run format`           | Prettier                                                                                                                                                                                                                                |

## Data imports

CSV and Excel imports run in the worker and need Redis:

```bash
npm run redis:local -- start        # or: docker compose up -d redis
# apps/api/.env and apps/worker/.env: REDIS_URL=redis://127.0.0.1:56379
npm run db:migrate:deploy           # applies the dataset migrations (non-destructive)
npm run dev                         # api + web
npm run dev -w @smarttag/worker     # worker (inspection, validation, cleanup)
```

Seeded users with data access: `admin@smarttag.local` (all permissions) and, on newly seeded
databases, `data@smarttag.local` (data operator). See [docs/data-imports.md](docs/data-imports.md).

## Documentation

- [Architecture](docs/architecture.md)
- [Canonical document schema](docs/canonical-document-schema.md)
- [Coordinate system](docs/coordinate-system.md)
- [Browser canvas strategy](docs/browser-canvas-strategy.md)
- [Professional canvas designer](docs/editor.md)
- [Typography and fonts](docs/typography.md)
- [Data schema and data records](docs/data-schema.md)
- [Data bindings, test data and validation layers](docs/data-bindings.md)
- [Expressions](docs/expressions.md)
- [Rendering strategy](docs/rendering-strategy.md)
- [Versioning strategy](docs/versioning-strategy.md)
- [VDP strategy](docs/vdp-strategy.md)
- [Security, RBAC and tenant isolation](docs/security.md)
- [API reference](docs/api.md)
