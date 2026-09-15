# Data bindings, test data preview and validation layers

A binding decides where a bindable artwork property gets its value. Bindings are explicit, typed
objects inside the canonical document — never `{{placeholders}}` in text.

## Binding modes

```json
{ "mode": "STATIC" }
{ "mode": "FIELD", "field": "product_name" }
{ "mode": "EXPRESSION", "expression": "concat(\"SIZE: \", size)" }
```

| Mode         | Output value                                                        |
| ------------ | ------------------------------------------------------------------- |
| `STATIC`     | the property's own value (`content`, `value`, `assetId`, `visible`) |
| `FIELD`      | the normalized value of one data field (record value or default)    |
| `EXPRESSION` | a calculated value; see [expressions.md](expressions.md)            |

The property's own value is always kept. With a data binding it is the **design-time sample**
shown in Template values; it is never used as a fallback for missing data. Switching a binding back
to `STATIC` therefore restores a meaningful value without retyping it.

Example text object (abridged):

```json
{
  "id": "vd-size",
  "type": "text",
  "content": "SIZE: M",
  "bindings": {
    "content": { "mode": "EXPRESSION", "expression": "concat(\"SIZE: \", size)" },
    "visible": { "mode": "STATIC" }
  }
}
```

## Bindable properties

| Object              | Property  | Field / expression types that fit                                    |
| ------------------- | --------- | -------------------------------------------------------------------- |
| `text`              | `content` | string, number, decimal, date, url (numbers print in plain notation) |
| `barcode`, `qrCode` | `value`   | string, number, decimal, url                                         |
| `image`             | `assetId` | image (an asset of the organization)                                 |
| every object        | `visible` | boolean                                                              |

Geometry (`x`, `y`, `width`, `height`, `rotation`) and styling are **not** bindable. A binding on any
other property is refused precisely (`INVALID_PROPERTY_BINDING`); an unknown mode gives
`UNKNOWN_BINDING_MODE`. The registry `OBJECT_BINDABLE_PROPERTIES` and a compile-time mapped type
keep the list in sync with the object schemas.

Nonsensical bindings are impossible by construction: the field picker only offers compatible field
types, commands check them (`setPropertyBinding`), and canonical validation reports
`INCOMPATIBLE_BINDING`, `UNKNOWN_BINDING_FIELD` and every expression problem with a precise path
such as `["pages", 0, "objects", 4, "bindings", "content", "expression"]`.

Field names never decide object types: dragging a `gtin` field onto the artboard creates **text**
bound to it; a barcode is chosen explicitly.

## Designer workflow

```text
select object → property (Content / Value / Image / Visibility) → Static | Field | Expression → field or expression
```

- **Properties panel** — every bindable property has a Static / Field / Expression switch; Field
  opens a searchable picker (display name, key, type, required marker); Expression opens the
  expression editor (insert field, insert function, live validation, preview result). Each change is
  one undo step. The Visibility section exists for every object.
- **Data panel** — fields with type, required badge and "Used by N"; the usage list names every
  property ("Back / Product QR code / Value") and selects it. Add, edit, rename (with a count of the
  bindings that will be updated), delete (refused silently, confirmed explicitly), missing-data
  policy, drag a field onto the artboard or insert it as bound text.
- **Layers** — bound objects show `↳ field_key` or an expression marker; in Data preview, objects
  hidden by data and objects with data issues are marked.
- Indicators, ghosts and markers are editor-only: they are drawn by the canvas adapter and the UI,
  never written to the document and never rendered by the canonical renderer.

## Test data preview

```text
Canonical template (editor store)  +  test record (editor session, temporary)
                     │                          │
                     └──── data-core pipeline ──┘
                                  │
                         resolved preview (display only)
```

- **Template values** shows stored values. **Data preview** shows the artwork resolved with the test
  record; a banner makes the mode explicit.
- Test data is entered per field with a control for its type (text, numeric text that keeps exactly
  what was typed, yes/no select that can also be "no value", date, URL, organization asset) or as
  JSON. "Fill sample values" starts from defaults and rule-compatible examples.
- Test data is **editor context only**: not written into the document, not saved, not part of undo
  history, not sent to the server on save. The template hash never changes (E2E and unit tests
  compare hashes before and after previewing).
- The canvas draws resolved copies of objects while selection, dragging and every command keep
  using the canonical objects (`EditorCanvas.setDataPreview`). A resolved copy is only drawn while
  its geometry equals the canonical object's, so a stale preview can never draw at an old size.
- The canonical SVG preview and the properties panel ("With test data: …") show the same resolution.
- Inline text editing of data-driven text is blocked in Data preview (the sample text is edited in
  Template values).

## Resolution — `resolveDocumentBindings(document, validation)`

For each bound property (visibility first):

1. FIELD: the normalized field value. EXPRESSION: evaluate over normalized values; missing values
   read as `null`.
2. Convert for the property: text for content and symbol values, an asset id for images,
   true/false for visibility.
3. Missing or invalid inputs → `INVALID_DATA_VALUE` (error), `MISSING_DATA_VALUE` (error for required
   fields and policy `FAIL`, warning for `WARN`, nothing for `EMPTY`) — only for objects that print.
4. Evaluation errors → `EXPRESSION_EVALUATION_ERROR`; the property renders empty (visibility keeps its
   template value so the object and its marker stay visible). Other properties keep resolving.

The source document is never mutated. Unchanged objects and pages keep their identity, so memoized
text layouts, barcode geometry and canvas objects are reused; a changed test value re-resolves in
well under a millisecond for 120 objects / 60 bindings.

## Validation layers

```text
Document schema validation       validateDesignDocument — structure, schema, bindings, expressions
        ↓
Data record validation (DATA)    validateDataRecord — types, required values, rules
        ↓
Binding resolution (BINDING)     resolveDocumentBindings — missing values, evaluation errors
        ↓
Object validation (OBJECT)       checkResolvedObjects — barcode check digits, QR capacity, images
        ↓
Layout warnings (LAYOUT)         checkResolvedLayout — text overflow, glyphs missing from the font
```

| Example               | Layer  | Code                                                |
| --------------------- | ------ | --------------------------------------------------- |
| Missing GTIN          | DATA   | `REQUIRED_VALUE_EMPTY`                              |
| GTIN `9501234567893`  | OBJECT | `BARCODE_VALUE_INVALID` ("Check digit should be 1") |
| Product name overflow | LAYOUT | `TEXT_OVERFLOW` (warning)                           |
| Unknown asset         | OBJECT | `IMAGE_ASSET_UNAVAILABLE`                           |

Issues are never collapsed into `INVALID_DOCUMENT`. Each carries `layer`, `code`, `severity`
(`ERROR` / `WARNING`), `message`, `field` and `target` (page, object, property). Object and layout
checks cover printed, data-bound objects; a property whose resolution already failed is not reported
twice (a missing GTIN is not also an "empty barcode").

`buildDataPreview(document, record, { textLayout, assetAvailability })` runs all layers and returns
`summarizeDataIssues(...)`: fields checked, valid, with warnings, with errors, per field and per
layer. The designer's **Data validation** summary, the issue list (click to reveal the artwork or
field) and the validation API use exactly this result; imports will reuse it per row.

Text overflow after resolution uses the designer's text layout engine with the exact production
font files. Shrink-to-fit is respected (overflow is reported only when the text does not fit even at
its minimum size); text is never truncated silently. The API does not run layout checks yet because
it has no production text shaper (see [rendering-strategy.md](rendering-strategy.md)).

### Dynamic barcodes, QR codes and images

- Resolved barcode values pass `validateBarcodeValue` (check digits, character sets, lengths).
  Invalid values render as a clearly labelled placeholder — never as misleading valid-looking bars —
  and produce an OBJECT error plus a canvas marker.
- Resolved QR values pass `validateQrValue` (capacity for the error-correction level).
- Image fields resolve to **asset ids of the organization** only. Remote URLs are never fetched into
  artwork (a `url` field cannot bind to an image). The API checks record image ids against the
  organization's placeable images (`UNKNOWN_ASSET_REFERENCE`); the designer loads them through the
  tenant-scoped asset endpoints, so another tenant's id is unavailable (`IMAGE_ASSET_UNAVAILABLE`).

## Validation API

`POST /api/v1/template-versions/:versionId/data/validate` — see [api.md](api.md#validating-a-data-record).

## Saving

Unchanged from Phase 2; the data schema and bindings are part of the canonical document:

```text
editor store → validateDesignDocument (schema, fields, rules, bindings, expressions) → hash
             → PATCH { document, expectedRevision } → server: migrate, validate, asset checks, hash, audit
```

Approved versions show their schema, bindings and expressions read-only; the API (and a database
trigger) refuse changes. Viewers and approvers without the designer role can inspect bindings and
use test data, but every data-schema and binding control is disabled and the API refuses their
`PATCH` with `403`.
