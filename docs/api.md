# API reference (Phase 2)

Base path: `/api/v1`. JSON in, JSON out. Authentication is the session cookie set by
`POST /auth/login`. Browsers reach the API through the web app's same-origin proxy (a streaming
route handler that reads `API_INTERNAL_URL` at runtime).

## Error envelope

Every non-2xx response has the same shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": { "fieldErrors": [{ "path": "dimensions.width", "message": "Width is required" }] },
    "requestId": "8c09514d-c228-47e7-aa16-035500a5be63"
  }
}
```

| Code                         | HTTP | Typical cause                                                  |
| ---------------------------- | ---- | -------------------------------------------------------------- |
| `VALIDATION_ERROR`           | 400  | Invalid body/query; `details.fieldErrors`                      |
| `UNAUTHENTICATED`            | 401  | Missing, expired or revoked session; bad credentials           |
| `FORBIDDEN`                  | 403  | Missing permission; cross-origin state-changing request        |
| `NOT_FOUND`                  | 404  | Unknown id **or a resource of another organization**           |
| `CONFLICT`                   | 409  | Duplicate code; archived template                              |
| `VERSION_CONFLICT`           | 409  | Stale `expectedRevision`; concurrent status change             |
| `VERSION_IMMUTABLE`          | 409  | Editing a non-draft version                                    |
| `INVALID_STATUS_TRANSITION`  | 409  | Transition not allowed by the lifecycle                        |
| `PAYLOAD_TOO_LARGE`          | 413  | Upload/body limit                                              |
| `UNSUPPORTED_MEDIA_TYPE`     | 415  | Disallowed or disguised file; unsupported font (reason given)  |
| `UNSAFE_CONTENT`             | 422  | SVG with scripts, handlers, external references or unsafe CSS  |
| `INVALID_DOCUMENT`           | 422  | Canonical document failed validation; `details.documentIssues` |
| `UNSUPPORTED_SCHEMA_VERSION` | 422  | Document from an unknown schema version                        |
| `RATE_LIMITED`               | 429  | Login throttling                                               |
| `INTERNAL_ERROR`             | 500  | Unexpected failure (details only in logs)                      |

Every response carries `X-Request-Id`. A well-formed incoming `X-Request-Id` is propagated.

## Endpoints

| Method | Path                                        | Authorization                                         | Description                                                                                  |
| ------ | ------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/health`                                   | public                                                | Liveness + database check                                                                    |
| POST   | `/auth/login`                               | public, rate-limited                                  | Email/password login; sets session cookie; returns session                                   |
| POST   | `/auth/logout`                              | authenticated                                         | Revokes session (204)                                                                        |
| GET    | `/auth/session`                             | authenticated                                         | Current user, active organization, roles, permissions, memberships                           |
| PUT    | `/auth/session/organization`                | authenticated (member)                                | Switch active organization                                                                   |
| GET    | `/customers`                                | `customer:read`                                       | Customers with brands                                                                        |
| POST   | `/customers`                                | `customer:manage`                                     | Create customer                                                                              |
| GET    | `/customers/:customerId`                    | `customer:read`                                       | Customer detail                                                                              |
| POST   | `/customers/:customerId/brands`             | `customer:manage`                                     | Create brand                                                                                 |
| GET    | `/templates`                                | `template:read`                                       | Paginated list; `page`, `pageSize` (≤ 100), `search`, `status`, `documentType`, `customerId` |
| POST   | `/templates`                                | `template:create`                                     | Create template + version 1 (blank canonical document from dimensions)                       |
| GET    | `/templates/:templateId`                    | `template:read`                                       | Template with current version summary                                                        |
| PATCH  | `/templates/:templateId`                    | `template:update` (+ `template:archive` for `status`) | Update name, description, customer, brand, status                                            |
| GET    | `/templates/:templateId/versions`           | `template:read`                                       | Version summaries, newest first                                                              |
| POST   | `/templates/:templateId/versions`           | `template-version:create`                             | New version from `document` and/or `basedOnVersionId`                                        |
| GET    | `/template-versions/:versionId`             | `template:read`                                       | Version detail including stored `document`                                                   |
| PATCH  | `/template-versions/:versionId`             | `template-version:edit-draft`                         | Replace draft content (`document`, `expectedRevision`)                                       |
| POST   | `/template-versions/:versionId/transitions` | per transition (see versioning)                       | `{ "targetStatus": "IN_REVIEW" }`                                                            |
| POST   | `/assets`                                   | `asset:create`                                        | Multipart `file` + `assetType`; SVG sanitized, fonts inspected and registered                |
| GET    | `/assets`                                   | `asset:read`                                          | Paginated list; `assetType`, `search` (filename), `usage` (`PLACEABLE_IMAGE`, `FONT`)        |
| GET    | `/assets/:assetId`                          | `asset:read`                                          | Asset metadata                                                                               |
| GET    | `/assets/:assetId/content`                  | `asset:read`                                          | Asset bytes (sandboxed headers)                                                              |
| GET    | `/fonts`                                    | `asset:read`                                          | Font registry of the active organization (`FontFaceDto[]`)                                   |

Request and response types are defined in `packages/shared-types` (`CreateTemplateRequestSchema`,
`TemplateDto`, `TemplateVersionDetailDto`, …).

### Example: create a template

```http
POST /api/v1/templates
Content-Type: application/json

{
  "name": "Demo Active hang tag",
  "code": "HT-DEMO-50X90",
  "customerId": "…",
  "brandId": "…",
  "documentType": "HANG_TAG",
  "dimensions": { "unit": "mm", "width": 50, "height": 90, "bleed": 3, "safeMargin": 3 },
  "pageLayout": "FRONT_AND_BACK"
}
```

The server converts the dimensions to points, builds and validates the blank canonical document,
hashes it and creates version 1 (`DRAFT`), all in one transaction together with audit events.

### Saving a draft (designer)

```http
PATCH /api/v1/template-versions/:versionId
Content-Type: application/json

{ "document": { "schemaVersion": 2, "...": "…" }, "expectedRevision": 7 }
```

The server migrates and validates the document, checks every referenced asset in the actor's
organization (placeable images must be PNG, JPEG or sanitized SVG; `fontAssetId` must be a
registered font whose family, weight and style match the text: `UNKNOWN_FONT_ASSET`,
`FONT_FACE_MISMATCH`, `INVALID_ASSET_REFERENCE` in `details.documentIssues`), recomputes the
canonical hash, and updates only if the version is still `DRAFT` at `expectedRevision`. The audit
event `TEMPLATE_VERSION_UPDATED` records `revision`, `previousDocumentHash`, `documentHash`,
`schemaVersion`, `pageCount` and `objectCount` — never the artwork itself.

### Font registry entry

`GET /api/v1/fonts` returns, per registered face: `assetId`, `filename`, `checksumSha256`,
`sizeBytes`, `familyName`, `subfamilyName`, `fullName`, `postscriptName`, `fontVersion`, `weight`,
`style`, `format`, `embeddingPermission`, `unitsPerEm`, `ascender`, `descender`, `lineGap`,
`capHeight`, `xHeight`, `glyphCount`, `unicodeRanges` and `createdAt`. Font values are read from the file
at upload ([typography.md](typography.md#font-registry)).
