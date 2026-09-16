# Production jobs

A production job turns two immutable inputs — one **approved template version** and one
**finalized dataset version** — into an exact, ordered, hashed set of tags, ready for the rendering
phase.

```text
Approved TemplateVersion  ─┐
                           ├─→ ProductionJob ─→ ProductionInstances ─→ Production manifest
Finalized DatasetVersion  ─┘     configuration     (one per tag)         (what was released)
                                 serial range
```

Phase 5 stops there on purpose: nothing is printed, imposed, rendered or turned into a PDF. The
terminal state is `READY_FOR_RENDERING`.

## Inputs

| Rule                           | Why                                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Template version is `APPROVED` | Production runs on approved artwork. `TEMPLATE_NOT_APPROVED` otherwise.                                                                                           |
| Dataset version is `FINALIZED` | A draft dataset can still change. `DATASET_NOT_FINALIZED` otherwise.                                                                                              |
| Same data schema hash          | The data was validated against exactly this contract (`TEMPLATE_DATASET_SCHEMA_MISMATCH`).                                                                        |
| Same customer                  | A template and a dataset of different customers never mix (`CUSTOMER_MISMATCH`); a brand must belong to the job's customer (enforced by a composite foreign key). |

A job records `templateVersionId` + `templateVersionHash`, `datasetVersionId` + `datasetHash` and
`dataSchemaHash` when it is created. None of them can ever change (trigger), and the worker refuses
to continue if the template version was edited in the meantime.

**Non-production mode.** A job created as `NON_PRODUCTION` may use a version that is not approved
(never a retired one). It is marked in the list, on the job page and in its manifest, and is hashed
with its mode, so it can never be mistaken for released production.

## Lifecycle

```text
DRAFT ──validate──▶ QUEUED ──▶ EXPANDING ──▶ READY / READY_WITH_WARNINGS / HAS_ERRORS
  ▲                                                │
  └────────── configuration changed ───────────────┘
                                                   │ release (errors = 0)
                                                   ▼
                                RELEASED ──worker──▶ READY_FOR_RENDERING
                                   │
                                   └─ FAILED (retryable; the serial range stays reserved)
```

| Status                | Meaning                                                      |
| --------------------- | ------------------------------------------------------------ |
| `DRAFT`               | Being configured; inputs fixed, everything else editable     |
| `QUEUED`              | Expansion requested, waiting for a worker                    |
| `EXPANDING`           | Instances are being created and validated                    |
| `VALIDATING`          | The expansion result is being checked and summarised         |
| `READY`               | Every tag is valid                                           |
| `READY_WITH_WARNINGS` | Valid, some tags carry warnings                              |
| `HAS_ERRORS`          | At least one tag failed; the job cannot be released          |
| `RELEASED`            | Inputs, configuration and serial numbers frozen and reserved |
| `READY_FOR_RENDERING` | Serial numbers written, hashes complete, manifest stored     |
| `FAILED`              | A step failed; retryable                                     |
| `CANCELLED`           | Abandoned before release; its tags are removed               |

Transitions are enforced in `production-core/lifecycle.ts`, by the API and by a database trigger.
Changing the configuration of an expanded job throws its tags away and returns it to `DRAFT`: the
counts on a job always belong to its current configuration.

## Quantity

| Mode             | Meaning                                      |
| ---------------- | -------------------------------------------- |
| `ONE_PER_RECORD` | One tag per dataset record (the default)     |
| `FIELD`          | The number of tags comes from one data field |

A quantity value must be a whole number greater than zero: `0`, `-1`, `2.5` and `"five"` are
refused (`QUANTITY_VALUE_INVALID`), never rounded or guessed. A record without a value either fails
(`whenMissing: REFUSE`) or uses the configured default. A record whose quantity cannot be used still
produces **one** instance carrying the error, so the problem is visible in the job and blocks its
release — records are never silently skipped.

```text
Row 1 quantity 2     Row 2 quantity 3     Row 3 quantity 1
   ↓                    ↓                    ↓
tag 1 (copy 1)       tag 3 (copy 1)       tag 6 (copy 1)
tag 2 (copy 2)       tag 4 (copy 2)
                     tag 5 (copy 3)
```

Duplicated records are expanded exactly like any other record: two identical rows asking for five
tags each are ten tags.

### Limits

Configuration, not scattered constants (`PRODUCTION_*` environment variables, same values in the
API and the worker):

| Limit                             | Default   | Variable                             |
| --------------------------------- | --------- | ------------------------------------ |
| Tags per record                   | 100,000   | `PRODUCTION_MAX_QUANTITY_PER_RECORD` |
| Tags per job                      | 1,000,000 | `PRODUCTION_MAX_INSTANCES_PER_JOB`   |
| Explicitly selected records       | 100,000   | `PRODUCTION_MAX_SELECTED_RECORDS`    |
| Instances written per statement   | 1,000     | `PRODUCTION_EXPANSION_BATCH_SIZE`    |
| Dataset records read per batch    | 1,000     | `PRODUCTION_RECORD_BATCH_SIZE`       |
| Serial numbers shown in a preview | 5         | `PRODUCTION_SERIAL_PREVIEW_COUNT`    |

Exceeding the job limit fails the job with `INSTANCE_LIMIT_EXCEEDED` before anything is written.

## Production instances

One instance is one physical tag. The data is **not** copied: an instance points at its dataset
record (immutable) and adds only what makes this tag different from the other copies.

| Field                                            | Meaning                                                 |
| ------------------------------------------------ | ------------------------------------------------------- |
| `sequence`                                       | 1…n, the order tags are produced in                     |
| `datasetRecordSequence`, `sourceRowNumber`       | Which record, and which row it came from                |
| `copyIndex` / `copies`                           | Copy 2 of 3                                             |
| `serialOffset`, `serialValue`                    | Position in the reserved range and the formatted serial |
| `status`, `errorCount`, `warningCount`, `issues` | What the Phase 3 engine found for this tag              |
| `sourceWarningCount`                             | Warnings the dataset record already carried             |
| `resolvedInputHash`                              | Phase 3 hash of artwork + data                          |
| `instanceHash`                                   | Artwork + data + production context                     |

**Ordering** is `dataset record sequence, then copy index`, and it never changes after release. It
will drive PDF order, imposition and roll sequence in the next phase.

## Validation

Every instance is resolved with the Phase 3 engine — there is no second production engine:

```text
TemplateVersion + normalized DatasetRecord + ProductionContext
  → expression evaluation and binding resolution
  → object checks (barcode check digits, QR capacity, image assets of this organization)
  → issues, status, hashes
```

Copies of one record are resolved once when the artwork does not use per-instance values; when it
does (a serial number, the position in the job), every copy is resolved on its own.

**Layout is not fully checked.** The server still has no text shaper, so text overflow and missing
glyphs are not checked for every tag. The browser checks them for the tag being previewed, the job
says so, and the manifest records `layoutFullyChecked: false`. Claiming otherwise would be a lie
about a print run.

## Release

`POST /production-jobs/:id/release` runs one transaction:

1. lock the job row (`FOR UPDATE`);
2. require `READY`/`READY_WITH_WARNINGS`, the expected revision, **zero error tags**
   (`PRODUCTION_JOB_HAS_ERRORS`) and, with warnings, `acknowledgeWarnings: true`
   (`PRODUCTION_WARNINGS_NOT_ACKNOWLEDGED`);
3. re-check the inputs: the template version still approved and unchanged, the dataset version
   still finalized and unchanged;
4. reserve the serial range under the sequence's row lock ([sequences.md](sequences.md));
5. freeze the job: status `RELEASED`, `releasedAt`, `releasedBy`, `releaseRun + 1`.

The tags themselves are finished by the `production.release` worker job: it writes each serial
number and instance hash, accumulates the ordered digest, computes the job hash and stores the
manifest, then moves the job to `READY_FOR_RENDERING`.

If a serial number makes a tag invalid (a barcode built from it, say), the job stops as `FAILED`
with a clear reason. Its serial range stays reserved — numbers are never reused.

## Immutability

Once released, a job's inputs, configuration, instances, serial range and hashes are final:

- the API refuses configure, validate, cancel and a second release (`PRODUCTION_JOB_IMMUTABLE`);
- triggers reject changes to the inputs, the configuration, the instance count, the release fields
  and the job hash, any change or deletion of its instances (statement-level checks over transition
  tables, so bulk writes stay fast), any change or deletion of its serial reservation, and deleting
  the job itself;
- the job history (`production_job_events`) is append-only.

A revised run is a **new job**, never an edit of a released one.

## Hashes

| Hash                | Definition                                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolvedInputHash` | Phase 3: SHA-256 of canonical `{ scheme, templateVersionHash, record }`                                                                                                                              |
| `instanceHash`      | SHA-256 of canonical `{ scheme: "smarttag-production-instance-v1", templateVersionHash, recordHash, context }`                                                                                       |
| Instances digest    | SHA-256 over `instanceHash + "\n"` for every tag in sequence order (streamable)                                                                                                                      |
| `productionJobHash` | SHA-256 of canonical `{ scheme: "smarttag-production-job-v1", templateVersionHash, datasetHash, dataSchemaHash, configuration, serialReservation, instanceCount, instancesDigest, contractVersion }` |
| Manifest checksum   | SHA-256 of the stored manifest bytes                                                                                                                                                                 |

The production context in the instance hash is `{ copyIndex, instanceIndex, jobNumber, serial,
sourceRow }`. Timestamps, user names and database ids are never hashed. Canonical JSON is RFC 8785.

**Contract version.** `smarttag-production-instance-v1` says how an instance is interpreted; it is
stored on the job, in every hash and in the manifest, so a future renderer knows exactly what it is
rendering.

## Job numbers

`PJ-20260916-000123`: the prefix, the UTC day and a per-organization counter for that day, allocated
inside the creating transaction (`production_job_counters`, unique per organization and number). The
number is a label — the job's identity is its database id — and it is never reused.

## Background processing

The API never expands or validates tags: it stores the decision and queues a job.

| Job                  | Payload                                            | Work                                                        |
| -------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `production.expand`  | organization, job, requesting user, `expansionRun` | Expands records into instances and validates each of them   |
| `production.release` | organization, job, requesting user, `releaseRun`   | Serial numbers, instance hashes, digest, job hash, manifest |

- **Idempotent.** The job id is derived from the job and its run number, so a run is queued once.
  A job whose run is no longer current does nothing.
- **Retry-safe.** Expansion deletes the instances of earlier attempts before writing; the release
  step recomputes exactly the same serials, hashes and manifest and rewrites the same rows and the
  same manifest object — never a second range, never a second manifest.
- **Batched.** Instances are written 1,000 per statement with progress after each batch.
- **Tenant-aware.** Every job carries the organization; every query filters by it.
- **Observable.** Structured job logs and per-run metrics (durations, throughput, peak memory)
  stored on the job.

## Screens

- **Production** (`/production`): jobs (job number, name, customer, template, dataset, tags,
  status, warnings, created, released) with status filters and search; serial sequences.
- **New production job**: approved template version and finalized dataset version; the server
  checks that they fit before the job exists.
- **Job**: counts and issue summary, configuration (quantity, serial sequence, serial preview),
  progress, the tag browser (keyset paging, filters, search, sample tags), one tag with its issues
  and a preview rendered with its production context, release with warning acknowledgement,
  provenance and hashes, manifest verification and download, and the job history.

## Not in this phase

Rendering, PDF/X, CMYK, ICC output intents, spot colours, imposition, sheet or roll layout, RIP or
printer integration, ERP/PLM/MES connectors, AI, and complete server-side typography and preflight.
`READY_FOR_RENDERING` means exactly that: ready for the rendering phase to consume.
