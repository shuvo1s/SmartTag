# Production instances

A production instance is **one physical tag**. It is the unit the rendering phase will render, the
unit a serial number belongs to, and the unit that is hashed.

## What an instance stores

The data is never copied: an instance points at its dataset record, which is immutable, and adds
only what makes this tag different from the other copies of that record.

```json
{
  "sequence": 4,
  "datasetRecordSequence": 2,
  "sourceRowNumber": 3,
  "copyIndex": 2,
  "copies": 3,
  "serial": "YT-01000004",
  "status": "VALID",
  "errorCount": 0,
  "warningCount": 0,
  "sourceWarningCount": 0,
  "resolvedInputHash": "6f1ed002…",
  "instanceHash": "b1946ac9…"
}
```

A million-tag job therefore stores a million small rows, not a million copies of the artwork or of
the data.

## Ordering

```text
record 1 copy 1 → sequence 1
record 1 copy 2 → sequence 2
record 2 copy 1 → sequence 3
…
```

Dataset record order, then copy order, starting at 1. The order is decided while expanding (never
by an unordered query) and is frozen when the job is released. It will drive PDF order, imposition,
roll sequence and serial mapping.

Duplicate records stay duplicates: two identical rows asking for five tags each are ten tags.
Nothing is deduplicated, because two identical tags are usually two physical tags.

## Production context and system fields

Values that belong to the tag rather than to the data:

| System field       | Type   | Value                                           |
| ------------------ | ------ | ----------------------------------------------- |
| `__serial`         | text   | The formatted serial number, e.g. `YT-01000004` |
| `__instance_index` | number | Position in the job (1…n)                       |
| `__copy_index`     | number | Copy number within the record (1…q)             |
| `__source_row`     | number | Row number in the imported source file          |
| `__job_number`     | text   | `PJ-20260916-000123`                            |

They are **not** part of any data schema: they never appear in `dataSchema.fields`, never change a
data schema hash and never appear in a dataset. A data schema can never define a key in the `__`
namespace, so the two sets can never collide. Adding them changed no stored document and needed no
schema migration — only the set of accepted binding field keys grew.

Bindings and expressions use them exactly like data fields:

```text
__serial                       (barcode value)
concat("SERIAL: ", __serial)   (text)
```

### Pending values

Where there is no production context — the designer preview, Test Data, data import validation —
a system field simply has no value. Those properties resolve empty, are **not** reported as missing
data, and object checks (barcode, QR, image) skip them: production has not produced the value yet,
so there is nothing to check. As soon as a job supplies the context, everything is checked normally.

## Validation

Each instance runs through the Phase 3 engine:

```text
TemplateVersion + normalized DatasetRecord + ProductionContext
  → resolveDocumentBindings (fields, expressions, system fields)
  → checkResolvedObjects (barcode check digits, QR capacity, image assets of this organization)
  → issues, status (VALID / WARNING / ERROR), hashes
```

Issue layers on an instance: `PRODUCTION` (quantity), `DATA`, `BINDING`, `OBJECT`. Warnings the
dataset record already carried are counted separately (`sourceWarningCount`) and shown as "from the
imported data", so a production warning is never confused with a data warning.

**Layout is checked only in the browser, for the tag being previewed** — the server has no text
shaper yet. The job and the manifest say so.

Copies of one record are resolved once when the artwork has no per-instance values; that is what
makes large jobs affordable. With `__serial`, `__instance_index` or `__copy_index` in the artwork,
every copy is resolved on its own.

## Hashes

| Hash                | Covers                                                         |
| ------------------- | -------------------------------------------------------------- |
| `resolvedInputHash` | Artwork + data (Phase 3; identical for every copy of a record) |
| `instanceHash`      | Artwork + data + production context (unique per tag)           |

```text
instanceHash = SHA-256( canonical {
  scheme: "smarttag-production-instance-v1",
  templateVersionHash, recordHash,
  context: { copyIndex, instanceIndex, jobNumber, serial, sourceRow }
} )
```

Instance hashes are written when the job is released, because the serial number is part of the tag.
Their ordered digest identifies the whole job ([production-jobs.md](production-jobs.md#hashes)).

Two instances may have the same hash only if they are the same tag in every respect; identical
hashes are never merged.

## Reading instances

| Method | Path                                       | Notes                                            |
| ------ | ------------------------------------------ | ------------------------------------------------ |
| GET    | `/production-jobs/:id/instances`           | `status`, `search`, `pageSize`, `afterSequence`  |
| GET    | `/production-jobs/:id/instances/:sequence` | One tag with issues, record, context, neighbours |
| GET    | `/production-jobs/:id/samples`             | A few tags worth previewing                      |

Large jobs are paged by sequence (**keyset paging**): `afterSequence` continues from the last tag
of the previous page, so the last page of a million-tag job costs the same as the first. Search
matches a serial number, a source row or a record sequence.

**Samples** point at the first tag, the first tag of another record, a tag with warnings and the
last tag (the highest serial number). They are a sample to look at before releasing — never a
complete layout preflight.
