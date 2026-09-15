# Data imports (CSV and Excel)

A data import brings tabular production data from a file into **one exact template version** and,
after validation and review, saves it as an immutable [dataset version](datasets.md). Imports reuse
the Phase 3 variable-data engine for every row; they add reading files, mapping columns to data
fields and reading text as numbers, dates and booleans ([import-normalization.md](import-normalization.md)).

```text
CSV / XLSX ──upload──▶ stored original (SHA-256) ──inspect (worker)──▶ sheets, columns, preview
   ──source settings──▶ columns ──mapping + rules──▶ ──validate (worker)──▶ draft dataset version
   ──review (rows, issues, preview)──▶ finalize ──▶ immutable dataset version
```

Per row, one shared pipeline (`@smarttag/import-core` `createRowProcessor`):

```text
source row → mapping → import normalization (IMPORT issues)
  → validateDataRecord (DATA) → tenant asset references (DATA)
  → resolveDocumentBindings (BINDING) → checkResolvedObjects (OBJECT: barcodes, QR codes, images)
  → record hash + resolved-input hash → DatasetRecord
```

Nothing re-implements record validation: types, rules, defaults, required values, the missing-data
policy, expressions and barcode checks are exactly those of the designer's Test Data and of
`POST /template-versions/:id/data/validate`.

## Wizard

`Data → Import data`, or **Import data** on a template version page (users with `dataset:create`).

| Step         | What happens                                                                                                                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload       | Choose the template version (never just a template), optionally an existing dataset, and a `.csv` or `.xlsx` file. The API checks the file and stores the original; inspection is queued.                                                                                    |
| Source       | Detected encoding and delimiter (CSV) or worksheets with row counts (XLSX), header row, preview of the first rows (header highlighted), detected data rows and columns. CSV encoding/delimiter changes re-inspect the stored file; sheet and header changes need no re-read. |
| Map fields   | One row per source column: sample, SmartTag field, type, status (Mapped / Suggested / Ignored). Exact suggestions are pre-filled but unsaved; other suggestions need **Accept**. Mapping profiles are evaluated against the file.                                            |
| Configure    | Import rules (trim, extra empty values, decimal/thousands separators, text date format, true/false values) with per-field overrides and a live parsing preview on sample values.                                                                                             |
| Validate     | Starts background validation; progress `38,420 / 75,000 rows · 51%`.                                                                                                                                                                                                         |
| Review       | Rows, valid, warnings, errors, duplicates, blank rows; mapped fields, ignored columns, unmapped required fields; issue counts; paginated rows with filters and search; issue details; visual preview of the selected row; **Save as mapping profile**.                       |
| Save dataset | New dataset or next version of an existing one. Refused with errors; warnings need an explicit acknowledgement.                                                                                                                                                              |

The stepper always shows the current step; steps open only when their prerequisites exist, and the
wizard moves on by itself when inspection or validation finishes.

## Lifecycle

One explicit status per import (`import-core` `lifecycle.ts`, mirrored by a database trigger):

```text
UPLOADED → INSPECTING → MAPPING_REQUIRED ⇄ READY_TO_VALIDATE → VALIDATING → READY
                                                                          → READY_WITH_WARNINGS → FINALIZED
                                                                          → HAS_ERRORS
FAILED (retry → INSPECTING / VALIDATING)       CANCELLED (terminal)       FINALIZED (terminal)
```

- Settings and mapping can change in `MAPPING_REQUIRED`, `READY_TO_VALIDATE` and the three
  validated states; a change invalidates the previous validation (status goes back to
  `MAPPING_REQUIRED` or `READY_TO_VALIDATE`). A new source setting that needs re-reading returns to
  `INSPECTING`.
- A failed inspection caused by settings (for example an encoding) accepts new source settings.
- Every user action carries `expectedRevision` (`VERSION_CONFLICT` otherwise); invalid transitions
  are refused by the service and by the trigger.
- Only `READY` and `READY_WITH_WARNINGS` can be finalized.

## Files and security

Uploaded files are untrusted.

| Check                    | Where        | Behaviour                                                                                                                                                                             |
| ------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size                     | API (multer) | Rejected while streaming: `IMPORT_FILE_TOO_LARGE` (413)                                                                                                                               |
| Extension + content      | API          | Only `.csv` and `.xlsx`; the content must match (ZIP signature for XLSX; no ZIP/Office/PDF/image/executable signature and no NUL bytes for CSV). The browser MIME type is ignored.    |
| Legacy and macro formats | API          | `.xls` → "Legacy XLS (Excel 97–2003) is not supported. Save the workbook as XLSX or CSV…"; `.xlsm`, `.xltm`, `.xlsb`, `.ods` refused; password-protected XLSX (OLE container) refused |
| Workbook container       | API + worker | Entry count, declared uncompressed size, compression ratio, macros (`vbaProject.bin`, macro-enabled content types) and binary workbooks checked before any worksheet is read          |
| Malformed content        | Worker       | Inspection fails with a readable reason (`MALFORMED_FILE`, line number for CSV)                                                                                                       |
| Rows, columns, cell size | Worker       | Limits below; a CSV row or cell over the limit fails the file, an XLSX sheet over the limit is marked unusable while other sheets stay usable                                         |

The original bytes are stored unchanged in object storage (`organizations/<org>/data-sources/<id>`,
one object per upload) with the original file name, detected format, size, SHA-256 and upload time.
Downloads (`GET …/source`) need `dataset:read-source`, are served as attachments with
`Content-Security-Policy: sandbox` and `nosniff`, and are audited (`DATA_SOURCE_DOWNLOADED`).

### CSV

- Parser: csv-parse 7.0.2, streamed (the file is never loaded into rows in memory).
- RFC 4180 quoting: quoted delimiters, doubled quotes and line breaks inside quoted values. A stray
  quote in an unquoted value is **malformed**, never reinterpreted.
- Row number = record index (a value spanning lines is one row, as in a spreadsheet application).
- Encodings: UTF-8 (validated; invalid bytes fail with a hint), UTF-8 and UTF-16 with a byte order
  mark (the BOM always wins), UTF-16LE/BE, Windows-1252, ISO-8859-1 when chosen. Nothing is guessed.
- Delimiters `,` `;` tab `|`: a delimiter is a candidate when ≥ 90 % of the first 50 records split
  into the same number (> 1) of fields. One candidate is pre-selected (overridable); several
  candidates are **ambiguous** and the user must choose before mapping.
- Trailing empty fields are ignored; fully blank rows are skipped and counted (`blankRowCount`).

### XLSX

- Reader: yauzl 3.4.0 (ZIP, random access, validated entry sizes) + sax 1.6.1 (streaming XML).
  Worksheets are streamed; shared strings and styles are read into memory within their limits.
- Every worksheet is listed with visibility and row counts; with more than one visible worksheet the
  user must choose (the first sheet is never assumed). Chart, dialog and macro sheets are skipped.
- Typed cells: numbers (15 significant digits, as spreadsheet applications show them), dates from
  date-formatted numbers in the 1900 or 1904 date system, booleans, inline and shared strings,
  error values (`#N/A` → row error). All-zero number formats (`0000000000000`) keep leading zeros.
- **Formulas are never evaluated.** A formula with a cached result is imported with a
  `FORMULA_CACHED_VALUE` warning; a formula without a cached result is a
  `FORMULA_VALUE_UNAVAILABLE` error. External workbook links are reported and never followed.
- Merged cells: the value belongs to the top-left cell (reported as a warning).
- `DOCTYPE` declarations are refused (no DTDs, no external or recursive entities).

## Limits

Configured through validated environment variables (API and worker read the same ones):

| Variable                                   | Default     | Meaning                                                  |
| ------------------------------------------ | ----------- | -------------------------------------------------------- |
| `IMPORT_MAX_FILE_BYTES`                    | 52 428 800  | Upload size (50 MB)                                      |
| `IMPORT_MAX_ROWS`                          | 100 000     | Data rows (non-blank rows below the header)              |
| `IMPORT_MAX_COLUMNS`                       | 250         | Columns with values                                      |
| `IMPORT_MAX_SHEETS`                        | 50          | Worksheets in a workbook                                 |
| `IMPORT_MAX_CELL_CHARS`                    | 10 000      | Characters per cell (= the data schema's text limit)     |
| `IMPORT_MAX_HEADER_CHARS`                  | 256         | Characters per header cell                               |
| `IMPORT_PREVIEW_ROWS`                      | 25          | Preview rows; the header row must be one of them         |
| `IMPORT_XLSX_MAX_ENTRIES`                  | 1 000       | ZIP entries                                              |
| `IMPORT_XLSX_MAX_UNCOMPRESSED_BYTES`       | 536 870 912 | Declared uncompressed size of all entries (512 MB)       |
| `IMPORT_XLSX_MAX_COMPRESSION_RATIO`        | 200         | Largest ratio of an entry larger than 1 MB               |
| `IMPORT_XLSX_MAX_SHARED_STRINGS_BYTES`     | 134 217 728 | Uncompressed shared strings part (128 MB)                |
| `IMPORT_VALIDATION_BATCH_SIZE`             | 500         | Rows validated and written per database batch            |
| `IMPORT_ABANDONED_AFTER_HOURS`             | 336         | Inactive unfinished imports are cancelled after 14 days  |
| `IMPORT_PENDING_UPLOAD_AFTER_MINUTES`      | 60          | Uploads that never completed are removed after this time |
| `IMPORT_STALLED_AFTER_MINUTES`             | 30          | Processing without progress is marked failed (retryable) |
| `IMPORT_WORKER_CONCURRENCY` (worker)       | 2           | Import jobs processed at the same time                   |
| `IMPORT_CLEANUP_INTERVAL_MINUTES` (worker) | 60          | Cleanup schedule                                         |

## Background processing

The API never reads or validates rows; it stores the upload, changes state and queues jobs on the
`smarttag-imports` BullMQ queue (`REDIS_URL` is required for imports; without it the endpoints return
`SERVICE_UNAVAILABLE`). The worker (`apps/worker`) runs `@smarttag/import-processing`:

| Job               | Payload                                                | Work                                                                                                              |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `import.inspect`  | organization, import, requesting user, `inspectionRun` | Reads the stored file once: sheets, preview rows, counts, detected settings; keeps mapping entries that still fit |
| `import.validate` | organization, import, requesting user, `validationRun` | Streams rows through the row pipeline into a DRAFT dataset version in batches of 500 with progress                |
| `data.cleanup`    | —                                                      | Scheduled hourly and after cancellations (see below)                                                              |

- **Idempotent and retry-safe.** Job ids are `inspect-<import>-<run>` / `validate-<import>-<run>`, so
  a run is queued once. A job whose run is no longer current (the user changed something, or the
  import was cancelled) does nothing. Before writing rows, validation deletes the drafts of earlier
  runs and any partial draft of an interrupted attempt of the same run, so retries never duplicate
  records; results become visible atomically (draft completed + import status in one transaction
  guarded by the run number).
- **Retries.** 3 attempts with exponential backoff for unexpected errors; on the last attempt the
  import becomes `FAILED` with `retryable: true` (the user can **Retry**). File problems fail
  immediately with `retryable: false`.
- **Tenant-aware.** Every job carries the organization; every query filters by it.
- **Observable.** Structured job logs (job id, attempt, correlation id) and per-run metrics stored on
  the import (`processing.inspection` / `processing.validation`: duration, rows per second, peak RSS
  of the worker process, batches). Progress (`progress_processed_rows`, `progress_total_rows`) is
  polled by the wizard every second.
- **Stalled work.** Imports in `INSPECTING`/`VALIDATING` without progress for 30 minutes are marked
  `FAILED` (retryable) by the cleanup job.

## Storage cleanup

1. The API records the upload (`PENDING`) **before** writing bytes, then marks it `STORED` and creates
   the import in one transaction. If storage or the database fails, it deletes the object and marks
   the row `DELETED` (best effort).
2. The cleanup job removes objects of uploads still `PENDING` after 60 minutes.
3. Cancelled imports lose their draft versions (and records) and their uploaded file.
4. Unfinished imports inactive for 14 days are cancelled (audited, `reason: ABANDONED`) and cleaned.
5. Files of finalized dataset versions are never deleted — a database trigger refuses it.

## API

See [api.md](api.md#data-imports-datasets-and-mapping-profiles).

## Audit

Aggregates only, never row values: `DATA_IMPORT_CREATED` (template version and hash, schema hash,
format, size, source SHA-256), `DATA_IMPORT_SOURCE_SETTINGS_UPDATED`, `DATA_IMPORT_MAPPING_UPDATED`
(counts, profile), `DATA_IMPORT_VALIDATION_REQUESTED`, `DATA_IMPORT_VALIDATED` (row counts, status),
`DATA_IMPORT_FAILED` (stage, code), `DATA_IMPORT_CANCELLED`, `DATA_SOURCE_DOWNLOADED`,
`DATASET_CREATED`, `DATASET_VERSION_FINALIZED` (dataset, version number, counts, hashes, profile),
`MAPPING_PROFILE_CREATED`, `MAPPING_PROFILE_UPDATED`.

## Layout checks and their limit

Server validation covers data, bindings and expressions, barcodes, QR codes and image assets for
**every** row. Text overflow depends on shaping text with the production fonts, which the server
cannot do yet, so it is **not** reported for every row. The row preview in Review runs the layout
checks (text overflow, missing glyphs) with the browser's text layout engine for the row being
previewed, and the summary says so. A future server-side text shaper will provide complete batch
layout preflight.

## Performance

`e2e/tests/import-performance.spec.ts` drives the real stack (API, worker, PostgreSQL, Redis)
through upload, inspection, mapping, validation and finalization and writes
`e2e/test-results/import-performance.json`. It is opt-in:

```bash
E2E_IMPORT_BENCHMARK=1 npx playwright test tests/import-performance.spec.ts --project=chromium
# sizes: E2E_BENCHMARK_CSV_ROWS (default 100000), E2E_BENCHMARK_XLSX_ROWS (default 25000)
```

The benchmark imports into a variable-data template draft (the E2E hang-tag template) and maps six
columns: style, product name, color, size, a decimal price and a GTIN-13 (barcode validation for
every row). The CSV writes prices with a decimal comma; the workbook has two sheets and stores prices
and GTINs as typed numbers. Measured on 2026-09-15 on the development machine (Windows Server 2022,
Node 24.21.0, local PostgreSQL 18 and Redis 8.10, API, worker and database on one host, one worker
process for both files):

| Measure                                    | CSV               | XLSX             |
| ------------------------------------------ | ----------------- | ---------------- |
| Rows                                       | 100,000           | 25,000           |
| File size                                  | 6,902,332 B       | 804,481 B        |
| Upload request                             | 498 ms            | 91 ms            |
| Inspection (worker job)                    | 1,278 ms          | 1,799 ms         |
| Validation (worker job)                    | 22,461 ms         | 5,640 ms         |
| Validation throughput                      | 4,452 rows/s      | 4,433 rows/s     |
| of which row pipeline / database calls     | 8,578 / 12,851 ms | 1,863 / 2,304 ms |
| Finalization request                       | 69 ms             | 48 ms            |
| Worker peak RSS during validation          | 459,886,592 B     | 347,992,064 B    |
| Worker peak JS heap used during validation | 288,262,264 B     | 170,479,896 B    |
| API `/health` p95 while validating         | 15 ms             | 12 ms            |
| Import detail p95 while validating         | 43 ms             | 22 ms            |
| Last page of rows / search                 | 500 / 145 ms      | 123 / 65 ms      |

Peak memory is the worker process (process-wide RSS, sampled after every batch), so it includes
everything the process holds, not only the job. Numbers vary between runs and machines; rerun the
benchmark instead of relying on them.

## Not in this phase

Batch artwork, PDF output, serial numbers, quantity expansion (a `quantity` field is just a field),
ERP/PLM/MES connectors, remote image ingestion, AI mapping and per-cell dataset editing (correct the
source and import a new version).
