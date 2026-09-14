# Versioning strategy

## Template vs TemplateVersion

```text
Template  (long-lived logical design: code, name, customer, brand, document type)
   ├─ Version 1   APPROVED   hash 85474d…   ← production job #1042 points here
   ├─ Version 2   RETIRED
   ├─ Version 3   APPROVED   hash c70657…   ← production job #1180 points here
   └─ Version 4   DRAFT      hash a60c69…   ← currentVersionId (head)
```

|            | Template                                                                                               | TemplateVersion                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Represents | The design over time                                                                                   | The artwork at one revision                                                            |
| Mutable    | Metadata (name, description, customer/brand, archive status). `code` and `documentType` are immutable. | Only while `DRAFT`                                                                     |
| Holds      | `currentVersionId` (head), `latestVersionNumber`                                                       | `documentJson`, `documentHash`, `schemaVersion`, `summaryJson`, lifecycle audit fields |

`documentId` inside the canonical document equals the template id, so every version of a template
describes the same logical design.

**Production never uses "latest".** Jobs, exports and integrations reference an explicit
TemplateVersion id. `currentVersionId` is a convenience pointer for the UI.

## Lifecycle

```text
DRAFT ──submit──▶ IN_REVIEW ──approve──▶ APPROVED ──retire──▶ RETIRED
  ▲                   │
  └──return to draft──┘
DRAFT ──discard──▶ RETIRED
```

| Transition           | Permission                 | Recorded                       |
| -------------------- | -------------------------- | ------------------------------ |
| DRAFT → IN_REVIEW    | `template-version:submit`  | `submittedAt`, `submittedById` |
| IN_REVIEW → DRAFT    | `template-version:review`  | submission cleared             |
| IN_REVIEW → APPROVED | `template-version:approve` | `approvedAt`, `approvedById`   |
| APPROVED → RETIRED   | `template-version:retire`  | `retiredAt`, `retiredById`     |
| DRAFT → RETIRED      | `template-version:retire`  | `retiredAt`, `retiredById`     |

The transition table (`TEMPLATE_VERSION_TRANSITIONS` in `shared-types`) is the single source of
truth for the API policy and the UI's available actions. Anything not listed is rejected with
`INVALID_STATUS_TRANSITION`. Before a version enters review or is approved, the API re-hashes the
stored JSON and refuses if it no longer matches `documentHash`.

Phase 1 implements transitions, permissions and history. Review comments, multi-step approval,
approver ≠ author rules and notifications are later additions on top of this model, with no
redesign needed.

## Immutability — defence in depth

1. **Domain policy**: `isVersionContentEditable(status)` is `true` only for `DRAFT`. Edits to other
   versions fail with `VERSION_IMMUTABLE`. Editing means creating a new version (`basedOnVersionId`).
2. **Conditional writes**: updates include `status = 'DRAFT' AND revision = expectedRevision` in the
   `WHERE` clause, so a concurrent approval cannot be overwritten.
3. **Database trigger** `smarttag_guard_template_version`:
   - identity (`template_id`, `version_number`, lineage, creator) is never changed
   - `document_json`, `document_hash`, `schema_version`, `summary_json`, `change_summary` and
     `revision` are frozen once status is not `DRAFT`
   - only the transitions above are allowed; approval records cannot be rewritten
   - non-draft versions cannot be deleted
4. **Tenant immutability trigger**: `organization_id` can never change on tenant-owned rows.

Integration tests cover the trigger directly with raw SQL.

## Version numbers

Numbers are allocated inside the creating transaction by incrementing
`templates.latest_version_number` (`UPDATE … SET latest_version_number = latest_version_number + 1`).
The row lock serialises concurrent creators, so numbers are unique and gap-free.
`UNIQUE (template_id, version_number)` is the backstop. An integration test creates six versions
concurrently and expects 2–7.

## Draft editing and optimistic concurrency

`PATCH /template-versions/:id` requires `expectedRevision`. A mismatch returns `VERSION_CONFLICT`
with `currentRevision`, so the Phase 2 editor can reload or merge instead of silently overwriting
another user's work.

## Hashing

`documentHash = SHA-256(RFC 8785 canonical JSON of the document)` as lowercase hex, `CHECK`ed as
`^[0-9a-f]{64}$`. The same design always gives the same hash, which enables:

- detecting "no-op" saves and identical versions
- integrity checks before approval
- future reproducibility manifests (TemplateVersion + Dataset + RendererVersion)

Changing the canonicalization scheme would change every stored hash, so it is pinned by a
known-vector test and would require a formal migration.
