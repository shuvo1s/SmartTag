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

The platform deliberately does **not** embed placeholders such as `"{{product_name}}"` in strings.
Placeholders cannot be type-checked, validated against a data schema, localised safely or
distinguished from literal text. The strict schema rejects them where a binding object is expected.

### Bindable properties (Phase 1)

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

The binding is a discriminated union, so new modes are additive:

- `COMPOSITE`: ordered literal + field segments (`"Size: " + size`)
- `EXPRESSION`: formatted/computed values (`formatCurrency(price, currency)`)
- `LOOKUP`: translation tables, care symbol sets, size charts
- conditional rules based on data

## Data schema

Each template declares its fields with stable keys (`product_name`, `gtin`, …), display names,
types, `required` flags and typed default values. Integrations (CSV headers, ERP mappings, API
payloads) bind to keys, so display names can change safely.

## Single-record resolution (Phase 1)

`resolveDocumentBindings(document, record)` in `document-utils` returns a new document with bound
properties replaced, plus issues. Per bound property:

1. value from the record, coerced to the field type (`coerceDataValue`: rejects `"19,99"` for
   decimals, `javascript:` for URLs, `2026-02-30` for dates, …)
2. otherwise the field's `defaultValue`
3. otherwise, if the field is `required` or `settings.missingDataPolicy` is `FAIL`, a
   `MISSING_DATA_VALUE` issue
4. otherwise (`EMPTY`): empty text or value, no image, or hidden (for `visible`)

The source document is never mutated, and the result keeps its bindings, so it stays traceable to
the data schema. The document preview and playground use this to show a record applied to a design.

## Batch VDP (later phases)

```text
Dataset (CSV / Excel / API / ERP)  ──map columns → field keys──▶  validated records (datasetHash)
TemplateVersion (APPROVED, documentHash)
             │
             ▼  worker job (correlationId, versionId, datasetId, rendererVersion)
   for each record: resolveDocumentBindings → preflight (barcode-core, PPI, overflow) → render
             │
             ▼
   print-ready PDF + manifest (hashes, per-record issues)
```

Design rules already enforced in Phase 1:

- jobs reference an **approved, immutable** version by id
- barcode values will pass `validateBarcodeValue` (check digits, charsets, lengths) before encoding
- decimal values stay strings end to end
- missing or invalid data is reported per record, never silently printed with sample values
