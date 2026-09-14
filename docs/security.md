# Security: authentication, authorization and tenant isolation

## Identity model

```text
User (global person, lower-case unique email, ACTIVE | DISABLED)
 ├── PasswordCredential   Argon2id hash (local login)
 ├── ExternalIdentity[]   (providerType OIDC, issuer, subject) — Microsoft Entra ID / OIDC ready
 ├── Session[]            server-side sessions
 └── Membership[]         one per Organization, ACTIVE | SUSPENDED
       └── MembershipRole[]   SUPER_ADMIN | ORG_ADMIN | TEMPLATE_ADMIN | DESIGNER | DATA_OPERATOR
                              | QA | APPROVER | PRODUCTION_OPERATOR | VIEWER
```

Users are global. Access to a tenant exists only through an **active membership** in an
**active organization**. A user may belong to several organizations (customers, brands,
factories); a session always has exactly one **active organization**.

### Adding Microsoft Entra ID (OIDC) later

- Use a vetted OIDC client library (authorization code flow with PKCE) at `/auth/oidc/*`.
- Map `(iss, sub/oid)` to `ExternalIdentity` (`@@unique([issuer, subject])`), link it to a `User`,
  then create the **same** server-side session. Guards, RBAC and tenancy are unchanged.
- Organization-level IdP configuration and just-in-time membership provisioning are future tables.
- No custom cryptographic protocol is involved.

## Authentication (Phase 1)

| Aspect            | Implementation                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passwords         | Argon2id via `@node-rs/argon2` (m = 19 MiB, t = 2, p = 1; OWASP minimum). The encoded hash includes salt and parameters.                                                     |
| Unknown accounts  | A dummy Argon2 verification equalises timing; the response is always the generic "Invalid email or password".                                                                |
| Sessions          | 256-bit random opaque token. **Only its SHA-256 is stored.** Revocable, with absolute TTL (`AUTH_SESSION_TTL_HOURS`) and idle timeout (`AUTH_SESSION_IDLE_TIMEOUT_MINUTES`). |
| Cookie            | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` + `__Host-` prefix in production (enforced by env validation).                                                                |
| Logout            | Revokes the session server-side and clears the cookie.                                                                                                                       |
| Continuous checks | Each request re-checks session validity, user status and membership, so suspending a membership takes effect immediately.                                                    |
| Brute force       | Login rate limit per client IP (`AUTH_LOGIN_RATE_LIMIT_PER_MINUTE`, `@nestjs/throttler`).                                                                                    |
| CSRF              | `OriginGuard`: state-changing requests with a foreign `Origin`, or `Sec-Fetch-Site: cross-site/same-site`, are rejected. SameSite cookies are a second layer.                |
| Audit             | `USER_LOGIN`, `USER_LOGIN_FAILED` (reason code only), `USER_LOGOUT`, `SESSION_ORGANIZATION_SWITCHED`.                                                                        |

The web app never sees the token. It calls same-origin `/api/v1/*`, which Next.js proxies to the
API. `proxy.ts` redirects visitors without a session cookie to `/login`; that is a UX convenience,
not a security boundary.

## Authorization (RBAC)

- `ROLE_PERMISSIONS` in `shared-types` maps roles to permissions (`template:create`,
  `template-version:approve`, …). Effective permissions are the union for the roles of the
  **active** membership.
- Guards run on every request: `OriginGuard` → `AuthenticationGuard` → `PermissionsGuard`.
- **Secure by default**: a route must declare `@Public()`, `@AllowAuthenticated()` or
  `@RequirePermissions(...)`, or `PermissionsGuard` rejects it. An architecture test checks every
  route and pins the public allow-list (`login`, `health`).
- Fine-grained rules live in domain policy: e.g. each lifecycle transition requires its own
  permission (`planStatusTransition`), and changing template status requires `template:archive`.
- The UI hides actions the user cannot perform (`useCan`) purely for usability; the API decides.
- **Designer:** anyone with `template:read` can open a version in the designer, but only
  `template-version:edit-draft` on a `DRAFT` gets an editable session. Viewers, approvers and QA get
  a read-only session (tools, fields and shortcuts disabled) — and the API independently refuses
  their `PATCH` with `403`, and any edit of a non-draft with `409 VERSION_IMMUTABLE` backed by a
  database trigger. Browser tests exercise both the UI and the direct API calls.

Separation of duties by default: designers create and submit, approvers approve, and viewers only read.

| Role                                       | Highlights                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| SUPER_ADMIN, ORG_ADMIN                     | All permissions **within their organization** (cross-tenant platform administration is intentionally not implemented) |
| TEMPLATE_ADMIN                             | Templates, versions (except approve), customers, assets                                                               |
| DESIGNER                                   | Create/edit templates and drafts, submit for review, upload assets                                                    |
| QA                                         | Read + return versions to draft                                                                                       |
| APPROVER                                   | Read + review + approve                                                                                               |
| DATA_OPERATOR, PRODUCTION_OPERATOR, VIEWER | Read (their data/production permissions arrive with those modules)                                                    |

## Tenant isolation — layered

1. **Session → active organization**: `organizationId` comes from the server-side session, never
   from request parameters.
2. **Service scoping**: every tenant-owned query includes `organizationId`. Lookups by id use
   `findFirst({ where: { id, organizationId } })`. Resources of other tenants return **404**, so
   their existence is not revealed.
3. **Referential checks**: customer/brand links and asset references in documents are verified
   within the same organization (`UNKNOWN_ASSET_REFERENCE`, `UNKNOWN_FONT_ASSET`,
   `INVALID_ASSET_REFERENCE`); font registry rows reference assets through a composite
   `(asset_id, organization_id)` foreign key.
4. **Database composite foreign keys**: `brands(customer_id, organization_id) → customers(id, organization_id)`,
   `templates(customer_id, organization_id)`, `templates(brand_id, customer_id, organization_id)`,
   `template_versions(template_id, organization_id)` and more make cross-tenant links impossible even with raw SQL.
5. **Tenant immutability triggers**: `organization_id` cannot be changed on tenant-owned rows.
6. **Tests**: integration tests attempt every read, update, create, transition and reference
   across tenants over HTTP, through the service layer and with raw SQL.

Planned hardening: PostgreSQL Row-Level Security with a per-transaction `app.organization_id`
setting as an additional guard against application bugs.

## Assets

- File type is detected from content signatures; client MIME type and extension are ignored.
- Asset type ↔ content type rules apply (`FONT` requires a font, `SVG` requires SVG, …).
- Upload size is limited while streaming (`ASSET_MAX_UPLOAD_BYTES`).
- SHA-256 checksums are verified by S3-compatible stores on upload.
- Content is served with `Content-Security-Policy: default-src 'none'; sandbox`,
  `X-Content-Type-Options: nosniff` and an ETag = checksum, so uploaded SVG/PDF cannot execute
  in the application origin.
- Storage keys are content-addressed and tenant-prefixed: `organizations/{org}/assets/sha256/{aa}/{sha256}`.
  Bytes behind an asset id can therefore never change, which protects approved artwork.

### SVG uploads

SVG is active content, so every SVG upload passes `sanitizeSvg` (`apps/api/src/modules/assets/svg-sanitizer.ts`)
before anything is stored:

1. The bytes must be UTF-8 and well-formed XML with an SVG root. Entity declarations and DOCTYPEs
   with an internal subset are refused (XXE, expansion bombs).
2. A **new** document is built from allow-listed SVG elements and attributes and serialized by the
   sanitizer itself; nothing from the input is copied verbatim.
3. The upload is **rejected** (`422 UNSAFE_CONTENT`, with a list of violations) when it contains:
   `script`/`handler`/`listener`, any `on*` event handler, animation elements (`animate`, `set`, …
   can rewrite `href` to `javascript:`), embedded frames/objects, `javascript:`/`vbscript:`/`data:text`
   URLs (including whitespace-obfuscated forms), external `href`/`url()` references, nested SVG data
   URLs, or CSS with `@import`, `@font-face`, `expression()`, escapes or external `url()`.
4. Non-rendering editor noise is **stripped** so normal design-tool exports keep working: comments,
   processing instructions, `metadata`, `foreignObject` fallbacks, Inkscape/Sodipodi/Illustrator
   namespaces, unknown elements and attributes. `<a>` is unwrapped (children kept).
5. Local references (`#id`) and embedded raster images (`data:image/png|jpeg|gif|webp;base64`) are kept.
6. The output must be a fixed point of the sanitizer (re-sanitizing yields identical bytes).

Only the sanitized bytes are checksummed, stored and served; the audit event records the sanitizer
version, the uploaded size and what was removed. The sandboxing CSP on the content endpoint and the
editor's image-only loading remain as additional layers.

`image-size` (dimension probing) has open advisories for its ICNS/JXL/HEIF parsers with no fixed
release. It is only called after content-signature detection has classified the file as PNG, JPEG,
GIF, WebP, TIFF or (sanitized) SVG, so those parsers are never reached.

## Logging, secrets and errors

- Logs never include passwords, session tokens, cookies, authorization headers or request bodies
  (pino redaction plus serializers that log method, path and status only).
- Environment validation errors list variable names, never values.
- `INTERNAL_ERROR` responses never include exception messages; details go to logs with the request id.
- `.env` files are git-ignored; only `.env.example` files with development placeholders are committed.
- The development seed refuses to run in production or against non-local database hosts.
