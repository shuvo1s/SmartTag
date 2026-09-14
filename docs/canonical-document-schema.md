# Canonical document schema (`DesignDocument`, schema version 2)

The canonical document is the **authoritative representation of a design**. It lives in
`packages/document-schema` and is independent of any editor, canvas library, renderer or
database. Browser canvases, previews, VDP and future PDF renderers are all _adapters_ around it.

```text
DesignDocument
├── schemaVersion      2
├── documentId         UUID of the logical design (= template id; stable across versions)
├── metadata           name, description, documentType, language, tags
├── dimensions         width, height, orientation, displayUnit, bleed, safeArea, margins, dieline
├── printSettings      colorSpace, backSideFlip, cropMarks
├── pages[]            id, name, side, background, groups[], objects[]
├── dataSchema         fields[]
└── settings           missingDataPolicy
```

A complete example is produced by `createSampleHangTagDocument()` in
`@smarttag/document-utils/fixtures`, and the web app's **Document playground** shows its JSON.

## Conventions

| Rule                                                                                                                                                                    | Why                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Every key is required.** "Not set" is `null`, never an omitted key.                                                                                                   | Equal designs serialize identically, so they hash identically.                    |
| **Objects are strict.** Unknown properties are validation errors.                                                                                                       | Corruption and editor-specific leftovers (e.g. raw Fabric JSON) are caught.       |
| **All lengths are PDF points.**                                                                                                                                         | See [coordinate-system.md](coordinate-system.md).                                 |
| **Colors are a discriminated union** (`RGB` with uppercase hex, `CMYK`, `SPOT` with alternate).                                                                         | CMYK/spot output can be added without changing stored designs.                    |
| **Images reference assets by id.** Binary data never enters the document.                                                                                               | Documents stay small; assets are deduplicated, checksummed and access-controlled. |
| **No timestamps, authors or workflow status** inside the document.                                                                                                      | They live on `TemplateVersion` rows and must not influence the design hash.       |
| **Enumerations use UPPER_SNAKE** (`FRONT`, `SHRINK_TO_FIT`), except object `type` values (`text`, `qrCode`), measurement units (`mm`) and data field types (`decimal`). | Follows the platform specification.                                               |

Identifiers:

- `documentId`, `assetId` — UUIDs.
- Element ids (pages, groups, objects, dieline features) — `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`, unique
  **across the whole document**, stable across versions (for diffs, comments and approvals).
- Data field keys — `^[a-z][a-z0-9_]{0,63}$`, stable integration identifiers; display names may change.

## `metadata`

`name`, `description`, `documentType` (`HANG_TAG`, `CARE_LABEL`, …, `POLYBAG_LABEL`), `language`
(BCP 47 or `null`) and `tags`. The document type classifies the design. It never changes the
document's shape; the registry `DOCUMENT_TYPE_DEFINITIONS` controls which types are enabled.

## `dimensions`

| Property             | Meaning                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `width`, `height`    | Trim (finished) size in points, `0 < n ≤ 14 400` (200 in).                                   |
| `orientation`        | `PORTRAIT`/`LANDSCAPE`; must agree with width/height (either for squares).                   |
| `displayUnit`        | `mm`, `cm`, `in` or `pt`. Presentation only.                                                 |
| `bleed`              | Insets **outside** the trim edge that artwork extends into.                                  |
| `safeArea`           | Insets **inside** the trim edge within which critical content must stay.                     |
| `margins`            | Insets inside the trim edge used as layout guides.                                           |
| `dieline.trimShape`  | `{ type: 'RECTANGLE', cornerRadius }`. A `PATH` variant is reserved for custom cut outlines. |
| `dieline.features[]` | `PUNCH_HOLE`, `SLOT_HOLE`, `FOLD_LINE`, `PERFORATION`, in front-side trim coordinates.       |

Phase 1 defines dieline features and renders them as guides. The dieline editor comes later.

## `printSettings`

`colorSpace` (`RGB` | `CMYK`, the intended output), `backSideFlip` (`HORIZONTAL` | `VERTICAL`,
how the piece turns over; used to mirror dieline features on BACK pages) and `cropMarks`.

## `pages[]`

At least one page. `side` is `FRONT`, `BACK` or `OTHER`. `background` fills the bleed box or is
`null` for unprinted substrate. `groups[]` define named groups with `visible`/`locked`; objects
reference them with `groupId`.

## Artwork objects

All objects share a base shape:

```text
id, type, name, x, y, width, height, rotation, opacity, visible, locked, zIndex, groupId, metadata, bindings
```

- `x`, `y`: top-left of the **un-rotated** frame, in trim space.
- `rotation`: clockwise degrees about the frame centre, normalised to `[0, 360)`.
- `zIndex`: authoritative stacking order, unique per page (array order is irrelevant).
- `metadata`: namespaced extension data (`"erp.itemCode": "A-100"`). It must never hold properties that affect rendering.

| `type`      | Specific properties                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Bindable properties  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `text`      | `content` (Unicode, `\n` line breaks), `fontAssetId` (exact controlled font file, or `null`), `fontFamily`, `fontSize` (pt), `fontWeight` (100–900), `fontStyle`, `textAlign` (`START`/`CENTER`/`END`/`JUSTIFY`, logical so RTL works), `verticalAlign`, `lineHeight` (× font size), `letterSpacing` (pt), `textColor`, `direction` (`AUTO`/`LTR`/`RTL`), `language`, `wrap` (`NONE` = explicit line breaks only, `WORD` = also wrap at word boundaries), `overflow` (`VISIBLE` / `CLIP` / `SHRINK_TO_FIT` + `minFontSize`) | `content`, `visible` |
| `image`     | `assetId` (nullable), `fitMode` (`CONTAIN`/`COVER`/`STRETCH`), `crop` (fractions 0–1 of the source, or `null`), `preserveAspectRatio`                                                                                                                                                                                                                                                                                                                                                                                       | `assetId`, `visible` |
| `rectangle` | `fill`, `stroke`, `cornerRadius`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `visible`            |
| `ellipse`   | `fill`, `stroke`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `visible`            |
| `line`      | `stroke`; drawn along the frame's horizontal centre line (height may be 0; angle via `rotation`)                                                                                                                                                                                                                                                                                                                                                                                                                            | `visible`            |
| `barcode`   | `symbology` (`CODE128`, `EAN13`, `EAN8`, `UPCA`, `UPCE`, `CODE39`, `ITF14`, `GS1_128`), `value`, `showHumanReadableText`, `quietZone` (modules), `barHeight` (pt), `foregroundColor`, `backgroundColor`                                                                                                                                                                                                                                                                                                                     | `value`, `visible`   |
| `qrCode`    | `value`, `errorCorrection` (`L`/`M`/`Q`/`H`), `foregroundColor`, `backgroundColor`, `quietZone` (modules)                                                                                                                                                                                                                                                                                                                                                                                                                   | `value`, `visible`   |

### Adding an object type (svg, polygon, path, DataMatrix, PDF417, table, care symbol, …)

1. Create its schema in `document-schema/src/objects/`, spreading `baseObjectShape`.
2. Add it to `ArtworkObjectSchema` and `ARTWORK_OBJECT_TYPES`.
3. Declare its bindable properties in `OBJECT_BINDABLE_PROPERTIES`. A mapped type makes this a
   compile error until it is done.
4. Handle it in `rendering-core`'s `toSceneNode`. The exhaustive switch makes this a compile error too.
5. Adding it to an existing schema version is backward compatible (older documents never contain
   it). Changing existing shapes requires a new schema version.

## `dataSchema`

`fields[]`, each with `key`, `displayName`, `type`, `required`, `defaultValue` (typed per field
type) and `description`.

| Field type | Value form                                                                      |
| ---------- | ------------------------------------------------------------------------------- |
| `string`   | string                                                                          |
| `number`   | finite number                                                                   |
| `decimal`  | **string** matching `-?\d+(\.\d+)?` (money never passes through floating point) |
| `boolean`  | boolean                                                                         |
| `date`     | ISO calendar date `YYYY-MM-DD`                                                  |
| `url`      | `http(s)://…`                                                                   |
| `image`    | asset id                                                                        |

Validation rules, transformations, enums/lookups and conditional logic will extend this structure later.

## `settings`

`missingDataPolicy`: `FAIL` or `EMPTY`. It applies when a bound optional field has neither a value
nor a default. See [vdp-strategy.md](vdp-strategy.md).

## Validation — `validateDesignDocument(input)`

Nothing may reach a renderer, a VDP job or persistence without passing validation. Input is treated
as untrusted JSON.

1. **Envelope** — must be an object with an integer `schemaVersion`. Newer versions give
   `UNSUPPORTED_SCHEMA_VERSION`; older versions give `SCHEMA_MIGRATION_REQUIRED`.
2. **Object types** — unknown artwork `type`s give `UNSUPPORTED_OBJECT_TYPE` with a precise path.
3. **Structure** — strict Zod schemas: types, ranges, formats, no unknown keys (`INVALID_STRUCTURE`).
4. **Semantics**:
   - unique element ids (`DUPLICATE_ID`), field keys (`DUPLICATE_FIELD_KEY`) and per-page z-indexes (`DUPLICATE_Z_INDEX`)
   - group references (`UNKNOWN_GROUP_REFERENCE`)
   - bindings: the field exists (`UNKNOWN_BINDING_FIELD`) and its type suits the property (`INCOMPATIBLE_BINDING`)
   - geometry: orientation, safe area and margins leave usable space, dieline features inside
     trim, corner radii, crop within source, bar height within frame (`INVALID_GEOMETRY`)
   - property semantics, e.g. `minFontSize ≤ fontSize` (`INVALID_PROPERTY`)
   - warnings: object entirely outside bleed (`OBJECT_OUTSIDE_BLEED`), image without source
     (`IMAGE_SOURCE_MISSING`), non-square QR frame (`NON_SQUARE_QR_CODE`)

Each issue has `code`, `severity`, a JSON `path` (e.g. `["pages",0,"objects",3,"bindings","content","field"]`) and a message.

The API adds **contextual** checks that require knowledge outside the document:
`DOCUMENT_ID_MISMATCH` (the document must describe its template), `DOCUMENT_TYPE_MISMATCH`, and
`UNKNOWN_ASSET_REFERENCE` (every referenced asset must exist in the same organization),
`INVALID_ASSET_REFERENCE` (images must reference PNG, JPEG or sanitized SVG assets),
`UNKNOWN_FONT_ASSET` (a `fontAssetId` must be a registered font of the organization) and
`FONT_FACE_MISMATCH` (`fontFamily`, `fontWeight` and `fontStyle` must equal the registry entry of
the font file). Text without a controlled font validates with the warning
`TEXT_FONT_NOT_CONTROLLED`.

## Schema migrations

`schemaVersion` exists from day one. Stored JSON is **never rewritten in place**. Readers upgrade
documents in memory:

```text
stored JSON (vN) ──migrate──▶ v(N+1) ──migrate──▶ … ──▶ CURRENT ──validate──▶ DesignDocument
```

- `DocumentMigration { fromVersion, toVersion = fromVersion + 1, description, migrate(json) }`, pure
  functions on plain JSON.
- `createDocumentMigrator` checks the registry at start-up: a complete chain with no gaps or duplicates.
- `parseDesignDocument(input)` = migrate + validate; it reports `originalSchemaVersion` and the
  applied migrations.
- Immutable (approved) versions keep their original JSON and hash. Editing an old version creates
  a new version holding the migrated document, with a new hash.

Introducing a schema version N+1:

1. Bump `CURRENT_SCHEMA_VERSION` (`DesignDocumentSchema` uses it as a literal).
2. Add `migrations/vN-to-vN+1.ts` and register it in `DOCUMENT_MIGRATIONS`.
3. Add fixture tests: a real vN document migrates, validates as vN+1 and keeps its meaning.
4. The database `CHECK` ties `schema_version` to `document_json->>'schemaVersion'`, so both always agree.

### Version history

| Version | Phase | Change                                                       | Migration                                                                                  |
| ------- | ----- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 1       | 1     | Initial canonical model                                      | —                                                                                          |
| 2       | 2     | Text objects gain `fontAssetId` (exact font file) and `wrap` | `v1-to-v2`: `fontAssetId: null`, `wrap: "NONE"` on every text object; nothing else changes |

### v1 → v2 backwards compatibility

- `fontAssetId: null` — v1 only named a family; a migration cannot choose an organization's font
  file, so the document validates with `TEXT_FONT_NOT_CONTROLLED` warnings until a font is assigned.
- `wrap: "NONE"` — the v1 layout used explicit line breaks only, so the meaning is unchanged.
- Proven with real content: `SAMPLE_HANG_TAG_V1_JSON` (the frozen Phase 1 sample) still hashes to
  `c7065757…d6f277`, migrates to a valid v2 document, and equals the v2 sample except for the two
  new keys (`packages/document-utils/test/schema-compatibility.test.ts`).
- The development seed stores the approved version 1 as genuine v1 JSON. The API and every UI
  read it through `parseDesignDocument`; its JSON and hash are never rewritten. Saving a v1 draft
  stores the migrated v2 document (with a new hash).
