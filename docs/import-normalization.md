# Import normalization

Import normalization turns a source cell into a value for one data field **before** the shared
record validation runs. It only handles ingestion concerns — text as numbers, dates and booleans,
white space and empty cells. Business logic (combining style, color and size, formatting prices for
print) belongs in [template expressions](expressions.md), never in an import.

Everything is explicit configuration stored with the mapping (`parsing` plus per-field overrides).
Nothing depends on the browser or server locale, time zone or language, so the same file and
mapping always produce the same normalized records (`IMPORT_NORMALIZATION_VERSION =
smarttag-import-normalization-1`, recorded with every dataset version and part of its hash).

```json
{
  "trimWhitespace": true,
  "emptyValues": ["N/A"],
  "number": { "decimalSeparator": ",", "thousandsSeparator": "." },
  "dateFormat": "DD/MM/YYYY",
  "boolean": { "trueValues": ["yes"], "falseValues": ["no"] }
}
```

The result of normalization is handed to `validateDataRecord` exactly like a JSON record value, so
types, rules, defaults, required values and the missing-data policy are decided there, once.

## Empty values

- With `trimWhitespace` (default) leading and trailing white space is removed from text cells.
- Blank cells, white-space-only cells and any `emptyValues` token (case-insensitive) mean **no
  value**. The template decides what that means: required → `REQUIRED_VALUE_EMPTY`, default →
  the default, optional → the missing-data policy.
- A value that cannot be read is **rejected**, not empty: the row gets an IMPORT error and the field
  is invalid (never replaced by its default, never reported as missing).

## Numbers and decimals

| Decimal separator | Thousands separator | `39.95`   | `39,95`   | `1,234.95`  | `1.234,95`  | `1 234,95`  |
| ----------------- | ------------------- | --------- | --------- | ----------- | ----------- | ----------- |
| `.`               | none                | `"39.95"` | error     | error       | error       | error       |
| `,`               | none                | error     | `"39.95"` | error       | error       | error       |
| `.`               | `,`                 | `"39.95"` | error     | `"1234.95"` | error       | error       |
| `,`               | `.`                 | error     | `"39.95"` | error       | `"1234.95"` | error       |
| `,`               | space               | error     | `"39.95"` | error       | error       | `"1234.95"` |

- Output is plain decimal text with `.` (`"1.234,95"` → `"1234.95"`); the fraction digits are kept
  exactly as written (`"12,50"` → `"12.50"`), so decimal fields keep their scale.
- Grouping must be regular (groups of three after the first). Space grouping accepts space,
  no-break space, narrow no-break space and thin space; apostrophe grouping accepts `'` and `’`.
- Scientific notation (`9.50123E+12`, often produced when a spreadsheet exported a long number) is
  refused because digits may have been lost. Currency symbols, percentages and parentheses are
  refused rather than interpreted.

**Ambiguity is prevented by configuration.** `1,234` is `1234` with thousands separator `,` and
`1.234` with decimal separator `,`; with decimal `.` and no thousands separator it is an error. The
importer never picks one on its own.

Error example (row issue, layer IMPORT, code `DECIMAL_PARSE_FAILED`):

```text
Retail Price: cannot parse "19,99" using decimal separator "." and no thousands separator:
it contains characters other than digits and the decimal separator
```

Typed spreadsheet numbers need no parsing: they are read with 15 significant digits (what
spreadsheet applications display; `0.1 + 0.2` is `0.3`) and converted to decimal text for decimal
fields. A number cell mapped to a text field becomes plain decimal text, zero-padded when its number
format is all zeros (a GTIN formatted `0000000000000`).

## Dates

Text dates are read in exactly one configured format, per mapping or per field:

| Format       | Example      |
| ------------ | ------------ |
| `YYYY-MM-DD` | `2026-09-15` |
| `YYYY/MM/DD` | `2026/09/15` |
| `DD/MM/YYYY` | `15/09/2026` |
| `MM/DD/YYYY` | `09/15/2026` |
| `DD-MM-YYYY` | `15-09-2026` |
| `MM-DD-YYYY` | `09-15-2026` |
| `DD.MM.YYYY` | `15.09.2026` |

- Output is the ISO calendar date of the data schema (`"2026-09-15"`); invalid calendar dates
  (`31/04/2026`) are refused. Days and months may have one or two digits; years need four.
- **No reinterpretation.** `03/04/2026` is `2026-04-03` with `DD/MM/YYYY`, `2026-03-04` with
  `MM/DD/YYYY`, and an error with the default `YYYY-MM-DD`:
  `Ship date: cannot read "03/04/2026" as a date: it is not written as YYYY-MM-DD; choose the date format the file uses`.
  The Configure step lists the formats the samples fit ("fit DD/MM/YYYY and MM/DD/YYYY: choose the
  format explicitly") but never chooses.
- **Typed spreadsheet dates** (numbers with a date format) are converted directly, without text
  parsing, from the workbook's date system: 1900 system (serial 1 = 1900-01-01; serial 60, the
  non-existent 1900-02-29, is refused; from serial 61 counted from 1899-12-30) or 1904 system
  (serial 0 = 1904-01-01). A time of day is ignored for date fields with a `DATE_TIME_IGNORED`
  warning. A plain number mapped to a date field is an error (serial numbers are never guessed).

## Booleans

Only configured tokens (trimmed, case-insensitive) are accepted; any other text is an error
(`BOOLEAN_PARSE_FAILED`). Presets: `true / false` (default), `yes / no`, `Y / N`, `1 / 0`. A token
cannot mean both true and false. Spreadsheet boolean cells are always accepted; spreadsheet numbers
1 and 0 only when the tokens include them.

## Images

Image fields accept **asset IDs** of images already uploaded to the organization. Links, network
paths, file paths and file names (`https://…`, `\\server\share\…`, `C:\…`, `shirt.png`, `data:…`)
are refused with `IMAGE_REFERENCE_NOT_SUPPORTED` and never downloaded or read. Asset IDs are looked
up in a tenant-scoped query per batch; another organization's asset is indistinguishable from an
unknown one (`UNKNOWN_ASSET_REFERENCE`).

## Other cells

| Source cell                        | Result                                                      |
| ---------------------------------- | ----------------------------------------------------------- |
| Spreadsheet error (`#N/A`)         | `SOURCE_VALUE_INVALID` error                                |
| Formula with a cached result       | The cached result, with a `FORMULA_CACHED_VALUE` warning    |
| Formula without a cached result    | `FORMULA_VALUE_UNAVAILABLE` error                           |
| Text longer than the cell limit    | `CELL_TOO_LONG` error (the parsers refuse such files first) |
| Date cell in a text field          | ISO date (`2026-09-15` or `2026-09-15T13:45:00`)            |
| Boolean cell in a text field       | `TRUE` / `FALSE`                                            |
| CSV text that looks like a formula | Plain text; nothing is ever evaluated                       |

## Issue codes (IMPORT layer)

`SOURCE_VALUE_INVALID`, `NUMBER_PARSE_FAILED`, `DECIMAL_PARSE_FAILED`, `DATE_PARSE_FAILED`,
`BOOLEAN_PARSE_FAILED`, `IMAGE_REFERENCE_NOT_SUPPORTED`, `CELL_TOO_LONG`,
`FORMULA_VALUE_UNAVAILABLE` (errors); `FORMULA_CACHED_VALUE`, `DATE_TIME_IGNORED` (warnings). Each
names the field, the source column (`RETAIL — Column E`) and the value.
