# API reference (Phase 3)

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

| Method | Path                                          | Authorization                                         | Description                                                                                  |
| ------ | --------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/health`                                     | public                                                | Liveness + database check                                                                    |
| POST   | `/auth/login`                                 | public, rate-limited                                  | Email/password login; sets session cookie; returns session                                   |
| POST   | `/auth/logout`                                | authenticated                                         | Revokes session (204)                                                                        |
| GET    | `/auth/session`                               | authenticated                                         | Current user, active organization, roles, permissions, memberships                           |
| PUT    | `/auth/session/organization`                  | authenticated (member)                                | Switch active organization                                                                   |
| GET    | `/customers`                                  | `customer:read`                                       | Customers with brands                                                                        |
| POST   | `/customers`                                  | `customer:manage`                                     | Create customer                                                                              |
| GET    | `/customers/:customerId`                      | `customer:read`                                       | Customer detail                                                                              |
| POST   | `/customers/:customerId/brands`               | `customer:manage`                                     | Create brand                                                                                 |
| GET    | `/templates`                                  | `template:read`                                       | Paginated list; `page`, `pageSize` (≤ 100), `search`, `status`, `documentType`, `customerId` |
| POST   | `/templates`                                  | `template:create`                                     | Create template + version 1 (blank canonical document from dimensions)                       |
| GET    | `/templates/:templateId`                      | `template:read`                                       | Template with current version summary                                                        |
| PATCH  | `/templates/:templateId`                      | `template:update` (+ `template:archive` for `status`) | Update name, description, customer, brand, status                                            |
| GET    | `/templates/:templateId/versions`             | `template:read`                                       | Version summaries, newest first                                                              |
| POST   | `/templates/:templateId/versions`             | `template-version:create`                             | New version from `document` and/or `basedOnVersionId`                                        |
| GET    | `/template-versions/:versionId`               | `template:read`                                       | Version detail including stored `document`                                                   |
| PATCH  | `/template-versions/:versionId`               | `template-version:edit-draft`                         | Replace draft content (`document`, `expectedRevision`)                                       |
| POST   | `/template-versions/:versionId/transitions`   | per transition (see versioning)                       | `{ "targetStatus": "IN_REVIEW" }`                                                            |
| POST   | `/template-versions/:versionId/data/validate` | `template:read`                                       | Validate one data record against the version (read-only); see below                          |
| POST   | `/assets`                                     | `asset:create`                                        | Multipart `file` + `assetType`; SVG sanitized, fonts inspected and registered                |
| GET    | `/assets`                                     | `asset:read`                                          | Paginated list; `assetType`, `search` (filename), `usage` (`PLACEABLE_IMAGE`, `FONT`)        |
| GET    | `/assets/:assetId`                            | `asset:read`                                          | Asset metadata                                                                               |
| GET    | `/assets/:assetId/content`                    | `asset:read`                                          | Asset bytes (sandboxed headers)                                                              |
| GET    | `/fonts`                                      | `asset:read`                                          | Font registry of the active organization (`FontFaceDto[]`)                                   |

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

{ "document": { "schemaVersion": 3, "...": "…" }, "expectedRevision": 7 }
```

The server migrates and validates the document, checks every referenced asset in the actor's
organization (placeable images must be PNG, JPEG or sanitized SVG; `fontAssetId` must be a
registered font whose family, weight and style match the text: `UNKNOWN_FONT_ASSET`,
`FONT_FACE_MISMATCH`, `INVALID_ASSET_REFERENCE` in `details.documentIssues`), recomputes the
canonical hash, and updates only if the version is still `DRAFT` at `expectedRevision`. The audit
event `TEMPLATE_VERSION_UPDATED` records `revision`, `previousDocumentHash`, `documentHash`,
`schemaVersion`, `pageCount`, `objectCount`, `fieldCount`, `bindingCount` and `expressionCount` — never
the artwork, field values, expressions or test data. Documents with invalid data fields, bindings or
expressions are refused with `INVALID_DOCUMENT` and precise `documentIssues` (e.g. `UNKNOWN_FIELD` at
`pages[0].objects[4].bindings.content.expression`).

### Validating a data record

```http
POST /api/v1/template-versions/:versionId/data/validate
Content-Type: application/json

{ "record": { "product_name": "Premium Shirt", "size": "XL", "price": 39.95 } }
```

```json
{
  "templateVersionId": "…",
  "documentHash": "…",
  "schemaVersion": 3,
  "valid": false,
  "productionValid": false,
  "issues": [
    {
      "layer": "DATA",
      "code": "REQUIRED_VALUE_MISSING",
      "severity": "ERROR",
      "field": "gtin",
      "target": null,
      "message": "GTIN is required but not present in the record"
    }
  ],
  "summary": {
    "fieldsChecked": 11,
    "valid": 10,
    "warnings": 0,
    "errors": 1,
    "layers": {
      "DATA": { "errors": 1, "warnings": 0 },
      "BINDING": { "errors": 1, "warnings": 0 },
      "OBJECT": { "errors": 0, "warnings": 0 },
      "LAYOUT": { "errors": 0, "warnings": 0 }
    }
  },
  "fields": [{ "key": "currency", "state": "VALID", "source": "DEFAULT" }],
  "normalizedRecord": { "currency": "USD", "gtin": null, "price": "39.95", "...": "…" },
  "resolvedInputHash": null
}
```

- Authenticated, `template:read`, tenant-scoped (another organization's version is `404`); works for
  every status, including approved versions. Nothing is modified, logged or audited.
- Uses the shared data-core pipeline: record validation (`DATA`), binding resolution (`BINDING`) and
  resolved barcode/QR/image checks (`OBJECT`). Layout checks need production font shaping and run in
  the designer only.
- Image values must be placeable images of the organization (`UNKNOWN_ASSET_REFERENCE`); ids of other
  tenants are indistinguishable from unknown ids.
- `valid`: no DATA errors. `productionValid`: no errors in any layer. `resolvedInputHash` is returned
  when the record is valid: SHA-256 of the document hash and the normalized record.
- The serialized record may be at most 256 KB (`413 PAYLOAD_TOO_LARGE`); record limits are listed in
  [data-schema.md](data-schema.md#limits). Keys such as `__proto__` are reported, never merged.

### Font registry entry

`GET /api/v1/fonts` returns, per registered face: `assetId`, `filename`, `checksumSha256`,
`sizeBytes`, `familyName`, `subfamilyName`, `fullName`, `postscriptName`, `fontVersion`, `weight`,
`style`, `format`, `embeddingPermission`, `unitsPerEm`, `ascender`, `descender`, `lineGap`,
`capHeight`, `xHeight`, `glyphCount`, `unicodeRanges` and `createdAt`. Font values are read from the file
at upload ([typography.md](typography.md#font-registry)).
