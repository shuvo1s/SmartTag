# Serial numbers and sequences

Serial numbers are printed on tags, so they must never repeat. Everything about them is decided on
the server: the browser never computes a serial number, and a number that has been committed to a
production job is never handed to another one.

## Sequence

| Field                         | Meaning                                                             |
| ----------------------------- | ------------------------------------------------------------------- |
| `name`                        | What people call it ("Yunusco hang tags")                           |
| `code`                        | Stable short code used in manifests and hashes (`YT-HANGTAG`)       |
| `prefix`, `padding`, `suffix` | How a number is written: `YT-` + 8 digits → `YT-00001257`           |
| `nextValue`                   | The next number to hand out; only ever moves forward                |
| `resetPolicy`                 | `NEVER` in this phase (a sequence that restarts can repeat numbers) |
| `status`                      | `ACTIVE` or `ARCHIVED` (archived sequences cannot be chosen)        |

`formatSerial` is pure and deterministic: the same number always reads the same way. The format is
frozen as soon as the sequence has produced its first range, because released jobs keep the values
it produced (database trigger).

Codes are unique per organization, and a sequence of another organization is simply not found
(`404`).

## Reservation

A production job takes an **atomic range** when it is released:

```text
Sequence YT-HANGTAG, nextValue 1,000,001
Job PJ-20260916-000123 with 18,200 tags
  → reservation 1,000,001 … 1,018,200   (nextValue becomes 1,018,201)
```

The release transaction locks the sequence row (`SELECT … FOR UPDATE`) before reading `nextValue`,
so two jobs released at the same moment are serialized and can never receive overlapping numbers.
Three further defences back this up:

- one reservation per job (`UNIQUE (production_job_id)`), so a repeated release cannot take a
  second range;
- an exclusion constraint (`EXCLUDE USING gist`) that makes two overlapping ranges of one sequence
  impossible, whatever the application does;
- a trigger that refuses any change or deletion of a reservation, and any backwards move of
  `nextValue`.

### Requirements

The exclusion constraint compares a uuid with `=` and an `int8range` with `&&` in one GiST index,
which needs the standard contrib extension **btree_gist**. The migration creates it
(`CREATE EXTENSION IF NOT EXISTS btree_gist`); a deployment whose database user may not create
extensions has to install it beforehand.

## Preview versus commitment

While a job is being prepared, the job page shows what its serial numbers **would** be:

```text
6 tags · YT-01000001 … YT-01000006 · Nothing is reserved until the job is released.
```

Previews read `nextValue`; they reserve nothing, so looking at a draft never burns numbers. The
range is taken exactly once, inside the release transaction.

## Gaps, never reuse

Once a range is committed it belongs to that job for good:

- a job that later **fails** keeps its range;
- a released job can never be cancelled;
- nothing releases numbers back to the sequence.

A gap in the numbering is safe; the same number on two tags is not. This is deliberate and
enforced by the database, not only by the application.

## Serials in artwork

A template prints a serial number through the system field `__serial`
([production-instances.md](production-instances.md#system-fields)), as a field binding or inside an
expression:

```text
concat("SERIAL: ", __serial)
```

Because the number only exists once a job is released, the value is **pending** everywhere else:
the designer preview, Test Data and data import validation leave those properties empty, report no
missing-data error for them, and skip barcode, QR and image checks on them. The release step
resolves them again with the real number and checks them for real — if a serial makes a tag invalid
(a barcode check digit, say), the job fails with a clear reason and its range stays used.

## Limits

| Limit                 | Value                                 |
| --------------------- | ------------------------------------- |
| Largest serial number | 9,007,199,254,740,991 (exact in JSON) |
| Padding               | 0 – 24 digits                         |
| Prefix / suffix       | 16 characters each                    |

## API

| Method | Path             | Authorization     | Description                                          |
| ------ | ---------------- | ----------------- | ---------------------------------------------------- |
| GET    | `/sequences`     | `sequence:read`   | Sequences of the organization                        |
| POST   | `/sequences`     | `sequence:manage` | Create (name, code, prefix, padding, start)          |
| GET    | `/sequences/:id` | `sequence:read`   | One sequence with its usage                          |
| PATCH  | `/sequences/:id` | `sequence:manage` | Rename, describe, format (before first use), archive |

Every change is audited (`SEQUENCE_CREATED`, `SEQUENCE_UPDATED`), and every reservation is audited
with its range (`SEQUENCE_RANGE_RESERVED`).
