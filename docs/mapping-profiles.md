# Field mapping and mapping profiles

A mapping says which source column feeds which data field and how text is read. A mapping profile
saves a successful mapping so the next file from the same system is mapped in one click — but only
when it demonstrably fits.

## Source columns

Headers are not unique in real exports, so a column's identity is its **position and its header
text**. People see both: `PRICE — Column D`, `PRICE — Column F`, `Column H (no header)`. Duplicate
headers are never collapsed, and unnamed columns are ignored unless mapped explicitly.

## Mapping

```json
{
  "version": 1,
  "entries": [
    {
      "field": "style",
      "column": { "index": 0, "header": "STYLE_NO" },
      "number": null,
      "dateFormat": null,
      "boolean": null
    },
    {
      "field": "price",
      "column": { "index": 4, "header": "RETAIL" },
      "number": { "decimalSeparator": ",", "thousandsSeparator": "." },
      "dateFormat": null,
      "boolean": null
    }
  ],
  "parsing": {
    "trimWhitespace": true,
    "emptyValues": [],
    "number": { "decimalSeparator": ".", "thousandsSeparator": "NONE" },
    "dateFormat": "YYYY-MM-DD",
    "boolean": { "trueValues": ["true"], "falseValues": ["false"] }
  }
}
```

Rules (`validateMapping`, checked in the browser while editing and again by the API):

| Rule                                                         | Issue                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| A field takes values from **one** column                     | `TARGET_FIELD_ALREADY_MAPPED` (refused)                       |
| The column still exists at that position with that header    | `SOURCE_COLUMN_NOT_FOUND` (refused)                           |
| The field exists in the template's data schema               | `UNKNOWN_TARGET_FIELD` (refused)                              |
| Overrides fit the field type (number/decimal, date, boolean) | `PARSING_OPTION_NOT_APPLICABLE` (refused)                     |
| Every required field without a default is mapped             | `REQUIRED_MAPPING_MISSING` (stored, not validatable)          |
| Unnamed or duplicate-header columns                          | `UNNAMED_COLUMN_MAPPED`, `DUPLICATE_HEADER_MAPPED` (warnings) |

One column may feed several fields. Unmapped columns are ignored; unmapped optional fields take
their default or the missing-data policy.

When the source settings change (another header row, a re-inspected file), entries whose column is
still at the same position with the same header are kept; the others are dropped.

## Automatic suggestions

Deterministic, no AI and no fuzzy scoring. A header matches a field, in this order:

1. `EXACT_KEY` — `product_name`
2. `CASE_INSENSITIVE_KEY` — `PRODUCT_NAME`
3. `NORMALIZED_KEY` — `Product Name`, `product-name` (lower case, runs of other characters → `_`)
4. `EXACT_LABEL` — the field's display name exactly
5. `NORMALIZED_LABEL` — the display name normalized

Only exact key and exact label matches are **exact**; they are pre-filled in the wizard but still
saved only when the user saves the mapping. Every other suggestion shows **Suggested: field
(confirm)** and needs **Accept**. Nothing is suggested when it would be ambiguous: duplicate headers,
two columns matching one field equally well, or one column matching two fields equally well.

## Data schema hash

`computeDataSchemaHash` (data-core) is SHA-256 of the RFC 8785 canonical JSON of

```json
{ "scheme": "smarttag-data-schema-v1",
  "fields": [ { "key", "type", "required", "defaultValue", "validation" }, … sorted by key ] }
```

Display names, descriptions and field order are excluded (presentation). Template versions with the
same data contract share the hash; imports, dataset versions and profiles record it.

## Mapping profiles

A profile is created from an import's saved, **complete** mapping (**Save as mapping profile** in
Review, or `POST /mapping-profiles { name, importId }`):

```json
{
  "version": 1,
  "sourceFormat": "CSV",
  "columns": [ { "index": 0, "header": "STYLE_NO" }, { "index": 1, "header": "PRODUCT NAME" }, … ],
  "fieldTypes": { "gtin": "string", "price": "decimal", … },
  "mapping": { "version": 1, "entries": [ … sorted by field … ], "parsing": { … } }
}
```

Stored with the profile: `dataSchemaHash`, `headerSignature` (SHA-256 of the ordered header texts),
source format, name, description, status (`ACTIVE`/`ARCHIVED`) and `currentRevision`.

### Compatibility

For every active profile of the organization the import page evaluates
`evaluateMappingProfile(profile, { dataSchemaHash, schema, columns })`:

| Result            | When                                                                                            | Offered as                                  |
| ----------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `COMPATIBLE`      | Same data schema hash, every mapped column found unambiguously, no required field left unmapped | **Apply mapping profile**                   |
| `REQUIRES_REVIEW` | Schema changed (hash differs), or some columns are missing or ambiguous                         | **Apply and review** (resolvable part only) |
| `INCOMPATIBLE`    | Nothing of the profile applies                                                                  | Listed, cannot be applied                   |

- Columns are found by header, so **reordered columns stay compatible** (notes say where a column
  moved).
- A header that occurs more than once only matches when the duplicates are at the same positions as
  in the profile; otherwise the entry is `COLUMN_AMBIGUOUS` and left for the user.
- With a different schema, entries for removed fields or fields whose type changed are dropped.
- Applying a profile only fills the wizard's draft; the user saves the mapping. The import records
  the profile and revision it came from, and so does the dataset version.

### Revisions and history

Every change (rename, description, archive/reactivate, or a new definition from another import with
`PATCH /mapping-profiles/:id { expectedRevision, importId }`) creates a new immutable
`mapping_profile_revisions` row and bumps `currentRevision` under optimistic concurrency. Revisions
cannot be updated or deleted (database trigger). Finalized dataset versions keep their own
**mapping snapshot**, so later profile changes never alter historical data.

### Isolation

Profiles belong to one organization. Another organization never sees, evaluates, applies or updates
them — even with an identical data schema hash (`404` on every cross-tenant access; referencing
another tenant's profile in a mapping is refused).
