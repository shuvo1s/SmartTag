# Production manifest

The manifest is the machine-readable record of a released production job: what was produced, from
which artwork and which data, in which order, with which serial numbers, and how it was checked.
It is what the rendering phase consumes and what an auditor reads to confirm that a printed batch
matches its inputs.

One manifest per job, written when the release finishes.

## Shape

```json
{
  "scheme": "smarttag-production-manifest-v1",
  "contractVersion": "smarttag-production-instance-v1",
  "job": {
    "id": "0199…",
    "jobNumber": "PJ-20260916-000123",
    "name": "FW26 hang tags",
    "productionMode": "PRODUCTION",
    "organizationId": "0199…",
    "customer": { "id": "0199…", "name": "Customer ABC" },
    "brand": null
  },
  "template": {
    "templateId": "0199…",
    "templateCode": "HT-VDP-50X90",
    "versionId": "0199…",
    "versionNumber": 3,
    "documentHash": "477325db…",
    "schemaVersion": 3,
    "status": "APPROVED"
  },
  "dataset": {
    "datasetId": "0199…",
    "datasetName": "Customer ABC — FW26 hang tags",
    "versionId": "0199…",
    "versionNumber": 2,
    "datasetHash": "8f14e45f…",
    "recordCount": 1250
  },
  "dataSchemaHash": "9c1e…",
  "configuration": {
    "version": 1,
    "quantity": {
      "mode": "FIELD",
      "field": "quantity",
      "whenMissing": "REFUSE",
      "defaultQuantity": 1
    },
    "serial": { "enabled": true, "sequenceId": "0199…" },
    "recordSelection": { "mode": "ALL" },
    "warningPolicy": "ACKNOWLEDGE",
    "productionMode": "PRODUCTION"
  },
  "recordSelectionHash": null,
  "serialReservation": {
    "sequenceCode": "YT-HANGTAG",
    "sequenceName": "Yunusco hang tags",
    "startValue": 1000001,
    "endValue": 1018200,
    "firstSerial": "YT-01000001",
    "lastSerial": "YT-01018200"
  },
  "instances": {
    "count": 18200,
    "validCount": 18188,
    "warningCount": 12,
    "errorCount": 0,
    "digest": "5d41402a…",
    "ordering": "dataset record sequence, then copy index; instance sequence starts at 1"
  },
  "productionJobHash": "c9c82ae3…",
  "versions": {
    "contract": "smarttag-production-instance-v1",
    "resolvedInput": "smarttag-resolved-input-v1",
    "dataSchema": "smarttag-data-schema-v1",
    "importNormalization": "smarttag-import-normalization-1"
  },
  "validation": {
    "contentValidated": true,
    "layoutFullyChecked": false,
    "note": "Data, bindings, expressions, barcodes, QR codes and image assets were validated for every instance. Text layout (overflow, missing glyphs) was not: the server has no text shaper yet, so layout is only checked in the browser for previewed instances."
  },
  "releasedAt": "2026-09-16T09:12:44.120Z",
  "releasedBy": { "id": "0199…", "displayName": "Demo Production Manager" },
  "createdAt": "2026-09-16T08:55:01.000Z"
}
```

The `validation` block is deliberately explicit: the manifest never claims that a batch was
layout-preflighted when it was not.

## Storage

- Written as **canonical JSON** (RFC 8785, sorted keys, no whitespace) with one trailing newline,
  so its bytes — and therefore its SHA-256 — depend only on its content.
- Stored through the object-storage abstraction at
  `organizations/<organization>/production/<job>/manifest.json`. The key is derived from the job, so
  a retried release overwrites its own manifest instead of leaving a second one behind.
- The database row (`production_artifacts`) records the storage key, size, content type and
  SHA-256, with `UNIQUE (production_job_id, kind)`: one manifest per job, whatever happens.

## Verification

`verifyProductionManifest(manifest, storedBytes, expectation)` checks, and reports every problem it
finds:

| Check                                                                                 | Fails with                    |
| ------------------------------------------------------------------------------------- | ----------------------------- |
| Stored bytes match the recorded checksum                                              | `MANIFEST_CHECKSUM_MISMATCH`  |
| Stored bytes are the canonical form of the content                                    | `MANIFEST_NOT_CANONICAL`      |
| Contract version is the one this build understands                                    | `CONTRACT_VERSION_MISMATCH`   |
| Job hash matches the job                                                              | `JOB_HASH_MISMATCH`           |
| Instance count matches                                                                | `INSTANCE_COUNT_MISMATCH`     |
| Instances digest matches (also against a digest recomputed from the stored instances) | `INSTANCES_DIGEST_MISMATCH`   |
| Serial reservation matches                                                            | `SERIAL_RESERVATION_MISMATCH` |

`manifestJobHashPayload(manifest)` rebuilds the exact text whose SHA-256 must equal the manifest's
own `productionJobHash`, so a manifest can be verified on its own, without the database.

`GET /production-jobs/:id/manifest` returns the manifest with the verification result; the job page
shows "Verified: the stored file matches its checksum and this job", or exactly what is wrong.

## Download

`GET /production-jobs/:id/manifest/download` needs `production-job:read` and serves the stored file
as an attachment with `Content-Security-Policy: default-src 'none'; sandbox`,
`X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` and the checksum in
`X-Checksum-Sha256`. Storage keys and storage URLs are never exposed, and every download is audited
(`PRODUCTION_MANIFEST_DOWNLOADED`).

## Immutability

A released job's manifest never changes silently:

- the release job is idempotent — a retry recomputes exactly the same content and rewrites the same
  object;
- once the job is `READY_FOR_RENDERING`, a trigger refuses any change of the artifact's checksum,
  any move to another job, and any deletion.

If something must change, that is a **new production job**.
