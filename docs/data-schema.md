# Data schema and data records

Every template version declares the variable data its artwork needs: the **data schema**
(`document.dataSchema.fields`, schema version 3). Records — typed in the designer's Test Data
today, arriving from CSV/Excel imports since Phase 4 and APIs later — are validated against it by one shared
implementation in `@smarttag/data-core`.

```text
TemplateVersion.document
└── dataSchema.fields[]        what data the template requires (part of the design, hashed)
└── settings.missingDataPolicy what happens when optional data is missing

data record (not stored with the template)
   └── validateDataRecord(schema, record) → issues + normalized record + resolved-input hash
```

The schema belongs to the canonical document, so it is versioned, hashed, approved and immutable
together with the artwork. Records are **not** part of the document: test data is temporary editor
context; production records live in datasets ([datasets.md](datasets.md)).

## Field definition

```json
{
  "key": "retail_price",
  "displayName": "Retail Price",
  "type": "decimal",
  "required": true,
  "defaultValue": null,
  "description": "Retail price without currency symbol",
  "validation": { "min": "0.01", "max": "9999.99", "allowedValues": null }
}
```

| Property       | Meaning                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| `key`          | Stable machine identity used by bindings, expressions, imports and integrations.         |
| `displayName`  | Label for people (1–100 characters). Changing it never affects bindings or integrations. |
| `type`         | One of the field types below.                                                            |
| `required`     | The record must provide a value, unless the field has a default.                         |
| `defaultValue` | Typed default used when a record has no value, or `null`.                                |
| `description`  | Free text (≤ 500 characters).                                                            |
| `validation`   | Type-specific rules; every rule key is present and `null` means "no rule".               |

Every key is always present (canonical documents never omit keys), so equal schemas hash equally.

### Field types

| Type      | Normalized value                      | Accepted input                                                                       |
| --------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| `string`  | text, exactly as given                | text; finite JSON numbers are written as plain decimal text                          |
| `number`  | JavaScript number (39.95 stays 39.95) | finite number; numeric text (`" 12.5 "`, `"1e3"`)                                    |
| `decimal` | exact decimal string (`"39.90"`)      | finite number (shortest round-trip digits) or plain decimal text; no `,` grouping    |
| `boolean` | `true` / `false`                      | booleans; `true/false`, `yes/no`, `y/n`, `1/0` (text, case-insensitive); numbers 1/0 |
| `date`    | ISO calendar date (`"2026-09-15"`)    | `YYYY-MM-DD` text that is a real date (`2026-02-30` is refused)                      |
| `url`     | the URL text                          | `http(s)://` with a host, no credentials, no white space, ≤ 2 048 characters         |
| `image`   | asset id (lower case)                 | UUID of a placeable image asset **of the same organization**                         |

Values are never "just strings": a decimal is validated, compared, rounded and formatted as a
number, but carried as exact decimal text so money never passes through binary floating point
(`0.1 + 0.2` style errors are impossible) and the printed scale is kept (`39.90` stays `39.90`).
Send decimals as text when the number of fraction digits matters; a JSON number `39.90` has already
lost its trailing zero before SmartTag receives it.

## Keys

- Pattern `^[a-z][a-z0-9_]{0,63}$`: a lowercase letter, then lowercase letters, digits and `_`.
- Unique within the schema (`DUPLICATE_FIELD_KEY`).
- **Reserved namespace `__`**: `__record_index`, `__job_id`, `__serial` and every other key starting
  with `__` are reserved for future system fields. The pattern already excludes them; editors and
  record validation report them explicitly.
- **Dangerous keys** `__proto__`, `constructor` and `prototype` are refused as field keys
  (`INVALID_FIELD_KEY`) and as record keys (`FORBIDDEN_FIELD_KEY`).
- The designer suggests a key from the display name (`"Retail Price (€)"` → `retail_price`); the
  key can be edited before saving.

### Renaming a key

Keys can be renamed in the designer. `renameDataField` (editor-core) finds every field binding and
expression that references the key, rewrites them token by token (text inside string literals and
function names is never touched) and renames the field — **one document change, one undo step**.
The dialog states how many design properties will be updated. If any affected expression cannot be
tokenized, the rename is refused rather than leaving a dangling reference. Integrations that use
the old key must be updated too; that is why keys are intended to stay stable.

### Changing the type

The type of a field that artwork uses cannot change (bindings could become incompatible); the
designer disables the control and explains why. An unused field may change type; its default and
rules are reset.

### Deleting a field

An unused field is deleted directly. A used field is never removed silently: the designer lists the
affected properties ("Front / Product Name / Content") and, only after explicit confirmation,
returns every one of them to its **static** value and deletes the field in the same change (undoable).
Commands refuse the deletion otherwise (`FieldInUseError`).

## Validation rules

| Field types                       | Rules                                                    |
| --------------------------------- | -------------------------------------------------------- |
| `string`                          | `minLength`, `maxLength`, `pattern`, `allowedValues`     |
| `number`, `decimal`               | `min`, `max`, `allowedValues` (decimals as decimal text) |
| `boolean`, `date`, `url`, `image` | none yet (`{}`); their format checks always apply        |

- Lengths count Unicode code points (identical on every platform).
- `pattern` must match the **whole** value. It is a safe, backtracking-free subset of regular
  expressions compiled to a linear-time automaton — see [expressions.md](expressions.md#safe-patterns).
- Rules are checked for consistency (`minLength ≤ maxLength`, `min ≤ max`, unique allowed values,
  allowed values that satisfy the other rules, a pattern that compiles): `INVALID_FIELD_RULE`.
- A default must satisfy the field's own rules and be a real value of its type: `INVALID_FIELD_DEFAULT`.

The same functions (`checkFieldDefinition`, `checkFieldRules` in document-schema) are used by
canonical validation, the field dialog and record validation, so a value the designer accepts is
accepted by the API and imports, and vice versa.

## Record validation — `validateDataRecord(schema, record)`

Returns structured results, never plain strings:

```json
{
  "valid": false,
  "issues": [
    {
      "layer": "DATA",
      "code": "PATTERN_MISMATCH",
      "severity": "ERROR",
      "field": "gtin",
      "target": null,
      "message": "GTIN does not match the required format"
    }
  ],
  "normalizedRecord": { "currency": "USD", "gtin": null, "price": "39.95", "...": "…" },
  "fields": [{ "key": "currency", "source": "DEFAULT", "empty": "MISSING", "invalid": false }],
  "invalidFields": ["gtin"]
}
```

Per field:

1. **Record value** — checked for type and format, then against the rules.
2. **Field default** — when the record has no value (key absent, `null`, or blank text).
3. **No value** — required fields produce an error; optional fields stay `null` and the
   missing-data policy decides during binding resolution.

An invalid value is never replaced by the default: it is an error and normalizes to `null`.

| Code                                                    | Meaning                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `REQUIRED_VALUE_MISSING` / `_NULL` / `_EMPTY`           | Required value absent from the record / `null` / blank text         |
| `INVALID_TYPE`                                          | Wrong JSON type (e.g. `true` for a decimal, an object for text)     |
| `INVALID_VALUE`                                         | Right type, unusable value (`"19,99"`, `2026-02-30`, `javascript:`) |
| `VALUE_TOO_SHORT`, `VALUE_TOO_LONG`, `PATTERN_MISMATCH` | String rules                                                        |
| `VALUE_BELOW_MINIMUM`, `VALUE_ABOVE_MAXIMUM`            | Numeric rules                                                       |
| `VALUE_NOT_ALLOWED`                                     | `allowedValues`                                                     |
| `UNKNOWN_FIELD` (warning)                               | Key not in the schema; ignored                                      |
| `FORBIDDEN_FIELD_KEY`                                   | `__proto__`, `constructor`, `prototype` or a reserved `__` key      |
| `UNKNOWN_ASSET_REFERENCE`                               | Image asset is not a placeable image of the organization (API)      |
| `INVALID_RECORD`, `PAYLOAD_LIMIT_EXCEEDED`              | Not an object; too many keys or too long text                       |

Untrusted input handling: records are read with own-property checks only and are never merged into
other objects; the normalized record is a frozen null-prototype object with exactly the schema's
keys. Keys such as `__proto__` can therefore never reach object prototypes (tested with records
parsed from raw JSON). Text containing lone UTF-16 surrogates or control characters other than tab
and line breaks is refused; markup is ordinary text and is only ever escaped when rendered.

## Normalization and identity

The normalized record is deterministic: keys sorted, every schema key present, defaults applied,
numbers in shortest round-trip form, decimals in canonical decimal text (no `+`, no leading zeros,
no negative zero, scale kept), dates as ISO text, booleans as booleans, missing values as `null`.
The same logical record gives the same normalized record in every browser and in Node.js, whether
it was sent as `{"price": 39.95}` or `{"price": "39.95"}`, in any key order, with or without
explicit default values.

`computeResolvedInputHash(templateVersionHash, normalizedRecord)` =
`SHA-256(RFC 8785 JSON { scheme: "smarttag-resolved-input-v1", templateVersionHash, record })`
identifies one resolved piece of input for reproducible VDP output later
(TemplateVersion + normalized record + renderer version). Test data never changes the template
hash: the template is only ever an input.

## Missing-data policy

`settings.missingDataPolicy` applies when a **printed** property depends on an **optional** field
that has neither a record value nor a default:

| Policy  | Result                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------- |
| `FAIL`  | `MISSING_DATA_VALUE` **error** — the record is not production-valid (default for new templates) |
| `WARN`  | the property renders empty; `MISSING_DATA_VALUE` **warning**                                    |
| `EMPTY` | the property renders empty silently                                                             |

Resolution order for a bound property:

```text
record value (validated) → field default → missing-data policy
```

- There is deliberately **no fallback to the property's static value**: the static value is a
  design-time sample and must never be printed as if it were data.
- Required fields without a value are errors whatever the policy.
- "Empty" means empty text or value, no image, or hidden (for visibility).
- Missing values of objects that do not print (hidden by their visibility binding, their template
  visibility or their group) are not reported.
- Expressions handle missing values explicitly with `fallback()` and `isEmpty()`; see
  [expressions.md](expressions.md#missing-values).
- `USE_DEFAULT` is not a separate policy: defaults are always applied first.

## Limits

| Limit                        | Value                                                          |
| ---------------------------- | -------------------------------------------------------------- |
| Fields per schema            | 500                                                            |
| Keys per record              | 1 000                                                          |
| Text value / string default  | 10 000 characters                                              |
| URL value                    | 2 048 characters                                               |
| Record size (validation API) | 256 KB serialized                                              |
| Allowed values per rule      | 100                                                            |
| Pattern source               | 200 characters, ≤ 2 000 automaton states, repetitions ≤ 100    |
| Expression source            | 2 000 characters (see [expressions.md](expressions.md#limits)) |

## CSV / Excel imports (Phase 4) and future APIs

```text
CSV / Excel (later: ERP payload)
   └─ mapping (optionally from a mapping profile): source column → field key, parsing rules
        └─ record (per row) ──validateDataRecord──▶ normalized record + DATA issues
             └─ resolveDocumentBindings + checkResolvedObjects (+ layout) ──▶ per-row issues
```

The Phase 4 importer only maps columns to keys and normalizes ingestion formats (decimal
separators, date formats, boolean tokens — [import-normalization.md](import-normalization.md));
typing, defaults, rules, missing values, expressions and barcode checks are this shared pipeline.
The data schema hash (`computeDataSchemaHash`) identifies a schema for mapping profiles
([mapping-profiles.md](mapping-profiles.md)). The validation API
(`POST /template-versions/:id/data/validate`) is the same pipeline for one record.
