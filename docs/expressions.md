# Expressions

Expressions calculate property values from data fields: `concat("SIZE: ", size)` → `SIZE: XL`,
`is_sustainable == true` → visible. They are implemented in `@smarttag/expression-core`, a package
with no dependencies that knows nothing about documents, canvases or frameworks.

```text
source text ──tokenize──▶ tokens ──parse──▶ syntax tree ──analyze (schema)──▶ type + dependencies
                                                        └──evaluate (field values)──▶ value + missing fields
```

Expressions are stored as source text in `EXPRESSION` bindings (readable, diffable, hash-stable)
and parsed on demand; syntax trees are cached by source.

## Syntax

```text
expression := or
or         := and ( "||" and )*
and        := equality ( "&&" equality )*
equality   := comparison ( ( "==" | "!=" ) comparison )*
comparison := unary ( ( "<" | "<=" | ">" | ">=" ) unary )*
unary      := ( "!" | "-" ) unary | primary
primary    := number | string | true | false | null
            | name "(" [ expression ( "," expression )* ] ")"     function call
            | name                                                data field key
            | "(" expression ")"
```

- **Strings** use `"…"` or `'…'`; escapes `\\`, `\"`, `\'`, `\n`, `\t`. No template literals.
- **Numbers** are plain decimals (`39.95`, at most 20 integer and 12 fraction digits) and are exact.
- **Names** are field keys (`size`) or, when followed by `(`, function names.
- Whitespace and line breaks between tokens are ignored.

There is no assignment, member access (`a.b`), indexing (`a[b]`), arithmetic, lambda, statement,
`new`, `import` or placeholder syntax. The tokenizer explains common attempts: `+` → "use concat()",
`.` → "property access is not supported", `=` → "use ==", `` ` `` → "template literals are not
supported", `?:` → "use if()".

## Types

Field keys have their field's type. Literals: number → `decimal`, text → `string`, `true`/`false`
→ `boolean`, `null`.

| Rule                    | Detail                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Compatible alternatives | `number` + `decimal` → `decimal`; `string`/`url`/`date` → `string`                                                       |
| `==`, `!=`              | numbers with numbers (exact: `39.90 == 39.9`), text with text, same types; `null` with anything                          |
| `<`, `<=`, `>`, `>=`    | numbers; text, URLs and ISO dates by code units (never locale); `null` → false                                           |
| `&&`, `\|\|`, `!`       | true/false (a missing value counts as false)                                                                             |
| Unary `-`               | numbers                                                                                                                  |
| Result for a property   | Text content: text, numbers, dates, URLs · Barcode/QR value: text, numbers, URLs · Image: image · Visibility: true/false |

Numbers print without exponent notation; decimals print exactly as normalized (`39.90`).

## Functions

The closed set, looked up in a null-prototype map (names such as `constructor` or `toString` can
never resolve):

| Function                                                 | Result                                                                                              | Example                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `concat(value, …)`                                       | text; missing values count as empty text; 1–32 arguments                                            | `concat(style, "-", color, "-", size)`                           |
| `upper(text)`, `lower(text)`                             | case conversion by Unicode default rules (not the browser locale)                                   | `upper(color)`                                                   |
| `trim(text)`                                             | text without leading/trailing white space                                                           | `trim(product_name)`                                             |
| `fallback(value, alternative, …)`                        | the first value that is neither missing nor empty text                                              | `fallback(product_url, concat("https://example.com/p/", style))` |
| `round(number, [digits])`                                | same numeric type; half away from zero; 0–12 digits (default 0)                                     | `round(price, 2)`                                                |
| `formatNumber(number, digits, [decimalSep], [groupSep])` | text with explicit separators (defaults `.` and none); 0–12 digits; separators ≤ 3 chars, no digits | `formatNumber(price, 2, ",", ".")` → `1.234,50`                  |
| `if(condition, then, else)`                              | one of two values; only the chosen branch is evaluated                                              | `if(is_sustainable, "RECYCLED", "")`                             |
| `isEmpty(value)`                                         | true when the value is missing or empty text                                                        | `if(isEmpty(size), "", concat("SIZE: ", size))`                  |

Rounding and formatting use exact decimal arithmetic (`round(1.005, 2)` is `1.01`), so results are
identical on every platform. Nothing depends on the runtime locale, time zone, time or randomness.

Specification examples:

| Expression                                      | Record                 | Result           |
| ----------------------------------------------- | ---------------------- | ---------------- |
| `concat("SIZE: ", size)`                        | `size: "XL"`           | `SIZE: XL`       |
| `upper(concat(style, "-", color, "-", size))`   | `YT2045`, `Navy`, `XL` | `YT2045-NAVY-XL` |
| `concat(currency, " ", formatNumber(price, 2))` | `USD`, `39.95`         | `USD 39.95`      |
| `if(is_sustainable, "RECYCLED", "")`            | `is_sustainable: true` | `RECYCLED`       |
| `country == "CA"` (visibility)                  | `country: "CA"`        | visible          |

## Missing values

A field without a value (no record value, no default) reads as `null`. The evaluator tracks which
missing fields a result depends on; `fallback()` and `isEmpty()` handle missing values explicitly,
and the branch of `if()` that is not taken does not count:

- `concat("AKA ", nickname)` with `nickname` missing → `"AKA "`, depends on missing `nickname`
- `fallback(nickname, product_name)` → `product_name`, no missing dependency
- `if(isEmpty(nickname), "", concat("AKA ", nickname))` → `""`, no missing dependency

Missing dependencies are reported through the missing-data policy exactly like field bindings
([data-schema.md](data-schema.md#missing-data-policy)).

## Errors

All problems are structured `{ code, message, start, end }` (character offsets for highlighting):

| Code                          | Found by  | Example                                                              |
| ----------------------------- | --------- | -------------------------------------------------------------------- |
| `EXPRESSION_PARSE_ERROR`      | parser    | `concat("a"` · `process.env` · `size = "x"`                          |
| `EXPRESSION_LIMIT_EXCEEDED`   | parser    | source, nesting, elements or arguments too large                     |
| `UNKNOWN_FIELD`               | analysis  | `concat(sise)`                                                       |
| `UNKNOWN_FUNCTION`            | analysis  | `capitalize(x)` · `fetch("…")` · `eval("…")`                         |
| `WRONG_ARGUMENT_COUNT`        | analysis  | `upper(a, b)`                                                        |
| `TYPE_MISMATCH`               | analysis  | `upper(price)` · `if(size, "a", "b")` · `size == 3`                  |
| `EXPRESSION_EVALUATION_ERROR` | evaluator | digits from data out of range · result longer than 10 000 characters |

Canonical validation reports the analysis codes with the binding path and the object name
(`Size: There is no data field "sise" (character 18)`), so a document with a broken expression cannot
be saved. The result type must also suit the property (`INCOMPATIBLE_BINDING`). Evaluation errors
depend on data and are reported per property during resolution (`BINDING` layer) without stopping
other properties.

## Expression editor

Expression field, **Insert field**, **Insert function** (with signatures and examples), live
validation with codes and character positions, and a **preview result** for the current test record
(or sample values when there is none, listing fields without values). An expression is applied to
the document only when it is valid — with Apply, Ctrl/⌘ Enter or leaving the field — as one undo
step; a half-typed expression never makes the document unsavable. Escape discards the draft.

## Security

Expressions are data, not code:

- **No `eval`, no `Function` constructor, no `new RegExp` on user input** — a source test asserts this.
- The interpreter walks a plain syntax tree (no functions, prototypes or host references in it; it
  round-trips through JSON) over a closed function set. Field values are looked up with own-property
  checks and shape-validated; a malformed value is an evaluation error, never coerced.
- Nothing can reach globals, `process`, `require`, `import`, the network, the file system, the
  environment, timers, time or randomness. Evaluation is deterministic and side-effect free.
- Adversarial tests cover `process.env`, `require("fs")`, `require(...).exec(...)`, `fetch(...)`,
  `eval(...)`, `Function(...)()`, `constructor`, `__proto__`, `prototype`, `toString()`,
  `globalThis`, `window["alert"]`, template literals, `new Date()`, statements, arrow functions,
  `{{placeholders}}` and `\u` escapes: each fails with a structured parse/unknown-name error before
  evaluation; markup inside strings stays inert text.
- Produced text is bounded (10 000 characters) and every structure is bounded (below), so an
  expression cannot consume unbounded CPU or memory: evaluation is linear in the size of the tree.

## Limits

| Limit                                     | Value             |
| ----------------------------------------- | ----------------- |
| Source length                             | 2 000 characters  |
| Syntax-tree elements                      | 500               |
| Nesting depth                             | 32                |
| Arguments per call                        | 32                |
| Name length                               | 64                |
| String literal length                     | 1 000             |
| Produced text                             | 10 000 characters |
| Fraction digits (`round`, `formatNumber`) | 12                |

## Safe patterns

Validation rule `pattern` (string fields) uses `compileSafePattern` from the same package.
JavaScript regular expressions backtrack and can take exponential time on inputs such as
`(a+)+$` against `aaaa…!`, and cannot be interrupted. SmartTag instead compiles patterns to a
Thompson automaton and simulates all states at once: matching takes time proportional to
input length × automaton size for **every** pattern.

- Supported: literals, `.`, classes `[a-z]` / `[^…]`, `\d \D \w \W \s \S` (ASCII), escaped
  metacharacters, `\n \r \t`, groups `( )` / `(?: )`, `|`, `* + ? {n} {n,} {n,m}`.
- Rejected (with a message): back-references, look-around, named groups, lazy/possessive
  quantifiers, word boundaries, Unicode property escapes, anchors in the middle.
- The whole value must match; leading `^` and trailing `$` are accepted and redundant.
- Limits: 200 characters of source, repetition counts ≤ 100, ≤ 2 000 automaton states, input ≤
  10 000 characters. Tests run classic ReDoS patterns against 5 000-character hostile input.

## Dependencies and performance

`expressionDependencies(ast)` lists the fields an expression reads; `collectFieldUsages` uses it for
the Data panel and for safe renames and deletions. Recomputation is not incremental on purpose:
resolving 60 bindings including 20 expressions takes ≈ 0.2–0.4 ms in Node.js and ≈ 1 ms in the
browser, so a dependency graph would add complexity without a measurable benefit
(`packages/data-core/test/performance.test.ts`, `e2e/tests/data-performance.spec.ts`).
