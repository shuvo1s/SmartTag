# Variable data printing (VDP) strategy

## Static vs field-bound properties

Every bindable artwork property has a **formal binding**, stored separately from the property value:

```json
{
  "id": "front-price",
  "type": "text",
  "content": "19.99",
  "bindings": {
    "content": { "mode": "FIELD", "field": "price" },
    "visible": { "mode": "STATIC" }
  }
}
```

- `STATIC`: output uses the property value (`content: "19.99"`).
- `FIELD`: output uses the value of data field `price` from the record. The stored `content`
  remains the design-time preview value.
- `EXPRESSION` (schema v3): output is calculated, e.g. `concat(currency, " ", formatNumber(price, 2))`.
  See [expressions.md](expressions.md).

The platform deliberately does **not** embed placeholders such as `"{{product_name}}"` in strings.
Placeholders cannot be type-checked, validated against a data schema, localised safely or
distinguished from literal text. The strict schema rejects them where a binding object is expected.

### Bindable properties

| Object              | Properties | Accepted field types               |
| ------------------- | ---------- | ---------------------------------- |
| `text`              | `content`  | string, number, decimal, date, url |
| `barcode`, `qrCode` | `value`    | string, number, decimal, url       |
| `image`             | `assetId`  | image                              |
| all objects         | `visible`  | boolean                            |

The registry `OBJECT_BINDABLE_PROPERTIES` defines these per object type, and a compile-time
mapped type keeps it in sync with the schemas. The validator rejects bindings to unknown fields
(`UNKNOWN_BINDING_FIELD`) and incompatible types (`INCOMPATIBLE_BINDING`).

### Future binding modes

The binding is a discriminated union, so new modes are additive. `EXPRESSION` (Phase 3) covers
composite text, formatting and conditions (including data-driven visibility). Still to come:

- `LOOKUP`: translation tables, care symbol sets, size charts
- sequential numbering through reserved `__` system fields

## Data schema

Each template declares its fields with stable keys (`product_name`, `gtin`, …), display names,
types, `required` flags, typed default values and validation rules. Integrations (CSV headers, ERP
mappings, API payloads) bind to keys, so display names can change safely. Details:
[data-schema.md](data-schema.md).

## Single-record pipeline (Phase 3)

`@smarttag/data-core` (shared by the designer, the API and future importers and workers):

```text
validateDataRecord ─▶ resolveDocumentBindings ─▶ checkResolvedObjects ─▶ checkResolvedLayout
      DATA                   BINDING                     OBJECT                 LAYOUT
```

- records are validated and normalized per field type, with required values, rules and defaults
- bound properties resolve from normalized values (fields and expressions, visibility first); missing
  values follow the missing-data policy and never fall back to sample values
- resolved barcodes, QR codes and images are validated; text overflow is reported after resolution
- `computeResolvedInputHash(templateVersionHash, normalizedRecord)` identifies the resolved input

The source document is never mutated and keeps its bindings. The designer's Data preview, the
document preview/playground and `POST /template-versions/:id/data/validate` all use this pipeline.
See [data-bindings.md](data-bindings.md).

## Batch VDP (later phases)

```text
DatasetVersion (Phase 4: CSV / Excel; later API / ERP)  ──mapped + validated──▶  records (datasetHash)
TemplateVersion (APPROVED, documentHash)
             │
             ▼  worker job (correlationId, versionId, datasetId, rendererVersion)
   for each record: validateDataRecord → resolveDocumentBindings → object/layout checks → preflight → render
             │
             ▼
   print-ready PDF + manifest (hashes, per-record issues)
```

Design rules already enforced in Phase 1:

- jobs reference an **approved, immutable** version by id
- barcode values will pass `validateBarcodeValue` (check digits, charsets, lengths) before encoding
- decimal values stay strings end to end
- missing or invalid data is reported per record, never silently printed with sample values
