# Datasets

A dataset is a long-lived collection of production data; each finalized import adds an immutable,
numbered **dataset version** tied to one exact template version. The next phase (batch generation)
consumes `TemplateVersion + DatasetVersion`.

```text
Dataset                          "Customer ABC — FW26 hang tags"
└── DatasetVersion 1, 2, …       immutable, hashed
       ├── template version id + document hash + data schema hash
       ├── source file (original bytes, SHA-256)
       ├── mapping snapshot + import configuration (settings, columns, parser, normalization, limits)
       ├── validation summary and counts
       └── DatasetRecords (sequence, row number, normalized record, hashes, status, issues)
```

## Model

| Table                              | Purpose                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `datasets`                         | Name (unique per organization), description, optional customer, `latest_version_number`                          |
| `dataset_versions`                 | One validation run of an import: `DRAFT` while reviewed, `FINALIZED` once saved                                  |
| `dataset_records`                  | Normalized rows, primary key `(dataset_version_id, sequence)`                                                    |
| `data_imports`                     | The working session (status, revision, runs, settings, inspection, columns, mapping, progress, failure, metrics) |
| `data_source_files`                | Original uploads (`PENDING` → `STORED` → `DELETED` for abandoned imports)                                        |
| `mapping_profiles` / `…_revisions` | Reusable mappings and their immutable history ([mapping-profiles.md](mapping-profiles.md))                       |

Every table carries `organization_id`; relations use composite foreign keys that include it, so a
dataset version can never reference another tenant's import, template version or source file.

Validation writes records **once**, directly into a draft version. Finalizing is a metadata change
(dataset, number, hash, finalization) — no records are copied, which keeps finalization fast for
100,000-row imports. Revalidating deletes the previous draft.

Representative dataset version (API `GET /dataset-versions/:id`, abridged):

```json
{
  "id": "0199…",
  "status": "FINALIZED",
  "versionNumber": 2,
  "dataset": { "id": "0199…", "name": "Customer ABC — FW26 hang tags" },
  "templateVersion": {
    "id": "0199…",
    "templateCode": "HT-VDP-50X90",
    "versionNumber": 3,
    "documentHash": "477325db…"
  },
  "dataSchemaHash": "9c1e…",
  "sourceFile": {
    "filename": "fw26-order.xlsx",
    "format": "XLSX",
    "sizeBytes": 48211,
    "checksumSha256": "e3b0…"
  },
  "mappingProfile": { "id": "0199…", "name": "ABC ERP export", "revision": 2 },
  "rowCount": 1250,
  "validCount": 1238,
  "warningCount": 12,
  "errorCount": 0,
  "duplicateRowCount": 3,
  "blankRowCount": 1,
  "recordsDigest": "5d41…",
  "datasetHash": "8f14…",
  "warningsAcknowledgedAt": "2026-09-16T09:12:44.120Z",
  "finalizedAt": "2026-09-16T09:12:44.120Z",
  "finalizedBy": { "displayName": "Demo Data Operator" }
}
```

Representative record (`GET /dataset-versions/:id/records/:sequence`):

```json
{
  "sequence": 25,
  "rowNumber": 27,
  "status": "WARNING",
  "errorCount": 0,
  "warningCount": 1,
  "record": {
    "color": "Navy",
    "country_of_origin": "Bangladesh",
    "currency": "USD",
    "gtin": "9501234567891",
    "is_sustainable": false,
    "price": "39.95",
    "product_image": null,
    "product_name": "Premium Cotton Shirt",
    "product_url": null,
    "size": "XL",
    "style": "YT-2045"
  },
  "recordHash": "b1946ac9…",
  "resolvedInputHash": "6f1ed002…",
  "duplicateOf": null,
  "issues": [
    {
      "layer": "IMPORT",
      "code": "FORMULA_CACHED_VALUE",
      "severity": "WARNING",
      "field": "price",
      "column": { "index": 4, "letter": "E", "header": "RETAIL" },
      "message": "Price: column E contains a formula; the result saved in the file (\"39.95\") was imported without recalculating it"
    }
  ]
}
```

## Rows

- **Status** is one of `VALID`, `WARNING` (warnings, no errors) or `ERROR`; a database check keeps
  status, counts and the resolved-input hash consistent.
- **Order** is the source order: `sequence` 1…n over non-blank data rows, `rowNumber` the source row.
- **Duplicates are kept.** Rows with the same record hash may be legitimate quantities; the later
  ones point to the first (`duplicateOf`) and are counted, never removed.
- **No quantity semantics.** A `quantity` field is an ordinary field; expanding quantities or serials
  into tags belongs to batch production.
- **Not a spreadsheet editor.** Records cannot be edited. Wrong source data is corrected in the
  source and imported as a new version.

## Hashes

| Hash                | Definition                                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source checksum     | SHA-256 of the uploaded bytes, as uploaded                                                                                                                                   |
| Data schema hash    | SHA-256 of canonical `{ scheme: "smarttag-data-schema-v1", fields: [key, type, required, defaultValue, validation] sorted by key }`                                          |
| Record hash         | SHA-256 of RFC 8785 canonical JSON `{ scheme: "smarttag-dataset-record-v1", record }` over the normalized record                                                             |
| Resolved-input hash | Phase 3: SHA-256 of canonical `{ scheme: "smarttag-resolved-input-v1", templateVersionHash, record }` (null for rows with errors)                                            |
| Records digest      | SHA-256 over the concatenation of `recordHash + "\n"` for every record in sequence order (streamable)                                                                        |
| Dataset hash        | SHA-256 of canonical `{ scheme: "smarttag-dataset-version-v1", templateVersionHash, dataSchemaHash, mapping (canonical), normalizationVersion, recordCount, recordsDigest }` |

Canonical JSON is RFC 8785 (sorted keys, no whitespace, shortest numbers); the canonical mapping
sorts entries by field. The dataset hash identifies content: the same normalized records for the same
template version, produced by the same mapping and normalization rules, give the same hash. Names,
descriptions, file names, upload times, users and the source checksum are stored separately and not
hashed (a CSV and an XLSX export of identical data mapped identically are the same content). Record
and resolved-input hashes are computed in the worker with Node's SHA-256 over the same canonical
payloads that the Web Crypto implementations digest; unit tests assert both agree, and an
integration test recomputes the records digest and dataset hash from stored records.

## Immutability

Once `FINALIZED`, the version's records, mapping snapshot, source checksum, template version and
dataset hash cannot change:

- the API refuses changes to finalized imports (`DATASET_IMMUTABLE`) and has no endpoint to edit
  versions or records;
- triggers reject any `UPDATE` or `DELETE` of a finalized version, any insert, update or delete of its
  records (statement-level checks over transition tables, so bulk inserts into drafts stay fast), any
  update of a finalized or cancelled import, and deleting a source file a finalized version uses;
- a CHECK constraint makes a finalized version without a dataset, number, hash, completed run, with
  errors, or with unacknowledged warnings impossible.

A revised upload becomes **Dataset Version 2**; version 1 is untouched.

## Finalization

`POST /data-imports/:id/finalize { expectedRevision, acknowledgeWarnings, dataset }` in one
transaction:

1. lock the import row (`FOR UPDATE`) — concurrent finalizations of one import: one wins, the other
   gets `DATASET_IMMUTABLE`;
2. require `READY`/`READY_WITH_WARNINGS`, the expected revision, a complete draft of the current run,
   **zero error rows** (`DATASET_HAS_ERRORS`; rows are never dropped to make a "valid rows only"
   dataset) and, with warnings, `acknowledgeWarnings: true` (`WARNINGS_NOT_ACKNOWLEDGED`);
3. require the template version to still have the import's document hash (`TEMPLATE_VERSION_CHANGED`);
4. create the dataset (`NEW`, name unique) or use an existing one, then allocate the version number by
   incrementing `datasets.latest_version_number` (the row lock serializes concurrent finalizations;
   `UNIQUE (dataset_id, version_number)` backs it up);
5. compute the dataset hash, mark the version `FINALIZED`, the import `FINALIZED`, and record
   `DATASET_VERSION_FINALIZED` (and `DATASET_CREATED`).

## Screens

- **Data** (`/datasets`): datasets (dataset, version, template, source, rows, valid, warnings,
  errors, status, created), import history, mapping profiles.
- **Dataset**: versions with template, source, rows, warnings, hash, finalization; **Import revised
  data**.
- **Dataset version**: counts, provenance (template version, source file and checksum, profile,
  parser, normalization), all hashes, mapping snapshot, issue summary, records (server-paginated,
  filters, search, issue details, row preview) and, with `dataset:read-source`, the original file.

## Relationship to Phase 3 Test Data

Test Data is a temporary designer preview of one record; datasets are persisted, normalized external
data. Both use the same validator, resolver, object checks and hashes. Previewing a dataset record in
the browser is presentation only: it never changes the record, the dataset hash or the template.
