# Typography

Print output must use the **exact font file** the designer approved. A hang tag that silently
reflows in a different font is a production defect: prices wrap, legal text gets cut off,
barcodes move. Phase 2 therefore makes fonts controlled assets with an identity in the canonical
document, loads exactly those files in the browser, and reports every case where it cannot.

## Font identity in the canonical document

Text objects (schema v2) carry both a **controlled reference** and a **descriptive face**:

| Property      | Meaning                                                                                 |
| ------------- | --------------------------------------------------------------------------------------- |
| `fontAssetId` | UUID of a `FONT` asset registered in the organization's font registry, or `null`        |
| `fontFamily`  | Typographic family of that file, e.g. `"Noto Sans"`                                     |
| `fontWeight`  | CSS weight 100–900 of that file                                                         |
| `fontStyle`   | `NORMAL` or `ITALIC`                                                                    |
| `wrap`        | `WORD` (wrap at word boundaries inside the frame) or `NONE` (explicit `\n` breaks only) |

- `fontAssetId` is the identity. `fontFamily`/`fontWeight`/`fontStyle` describe the file and must
  agree with the registry: the API rejects a mismatch with `FONT_FACE_MISMATCH` and a reference to
  anything that is not a registered font of the same organization with `UNKNOWN_FONT_ASSET`
  (`422 INVALID_DOCUMENT`). The validator in `document-schema` stays tenant-agnostic; these checks
  run in the API with the actor's organization.
- `fontAssetId: null` is a valid but **uncontrolled** text. Validation reports the warning
  `TEXT_FONT_NOT_CONTROLLED`; editors show "(not controlled)" and a marker on the object.
- The designer's font picker only offers registry faces and always sets all four properties
  together, so the pair cannot drift apart through the UI.
- Documents migrated from schema v1 get `fontAssetId: null` and `wrap: "NONE"` (the exact v1
  layout behaviour). Nothing guesses a font for them. See
  [canonical-document-schema.md](canonical-document-schema.md#v1--v2-backwards-compatibility).

## Font registry

Uploading a font (`POST /assets`, `assetType: FONT`, TTF/OTF/WOFF/WOFF2) creates the asset **and**
a `font_faces` row in the same transaction. All metadata is read from the file on the server
(`apps/api/src/modules/assets/font-inspector.ts`, fontkit); nothing is taken from the client.

| Stored                                             | Source in the font file                                              |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `familyName` / `subfamilyName`                     | Typographic family/subfamily (name IDs 16/17), else name IDs 1/2     |
| `fullName`, `postscriptName`, `fontVersion`        | `name` table                                                         |
| `weight`                                           | `OS/2.usWeightClass`, rounded to a CSS weight                        |
| `style`                                            | `OS/2.fsSelection` italic/oblique bits                               |
| `ascender`, `descender`, `lineGap`                 | `OS/2` typo metrics when `USE_TYPO_METRICS` is set, otherwise `hhea` |
| `unitsPerEm`, `capHeight`, `xHeight`, `glyphCount` | `head`, `OS/2`, `maxp`                                               |
| `unicodeRanges`                                    | The `cmap` character set, compressed to ranges                       |
| `embeddingPermission`                              | `OS/2.fsType` (recorded now; enforced by the PDF renderer later)     |

Refused at upload (`415 UNSUPPORTED_MEDIA_TYPE` with the reason): unreadable files, **font
collections** (TTC/OTC — upload each face), **variable fonts** (upload static instances), fonts
without family or PostScript name, invalid `unitsPerEm`, and fonts that map no characters.

Registry rows are immutable (trigger `smarttag_guard_font_face`), may only point at `FONT` assets
of the same organization (composite foreign key), and a font asset cannot change its type. The
browser reads the registry through `GET /fonts` (`asset:read`).

Development seed data registers Noto Sans Regular/Medium/SemiBold/Bold and Noto Sans Bengali
Regular (SIL Open Font License, `apps/api/prisma/seed-assets/fonts/OFL.txt`, pinned SHA-256).

## Loading fonts in the browser

`BrowserFontRegistry` (`packages/canvas-adapter/src/browser-services.ts`):

```text
fontAssetId → GET /api/v1/assets/:id/content → FontFace("st-font-<assetId>", weight, style) → document.fonts
```

- Every asset gets its **own family name**. A document can never pick up a same-named font that
  happens to be installed on the user's computer, and two different files called "Noto Sans"
  never collide.
- `weight` and `style` descriptors come from the registry, so the browser never synthesizes bold
  or italic.
- Each font has a status: `UNASSIGNED` (no `fontAssetId`), `UNKNOWN` (not in the registry),
  `LOADING`, `LOADED`, `FAILED`. Only `LOADED` fonts are used by name.
- When a font finishes loading, cached text layouts are invalidated and the canvas and previews
  re-render.

## Missing fonts: never silent

A missing production font is **never** replaced by Arial or any other font without saying so.
Text is still displayed (so the design stays editable), but always flagged:

| Where                       | What the user sees                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Designer canvas             | Red marker on the object (`FONT_UNAVAILABLE`, `FONT_UNASSIGNED`); status-bar count of display issues |
| Properties panel            | Font status message, "(not controlled)" in the font picker, missing glyphs and overflow listed       |
| Designer preview            | "Substitute fonts: N text" badge with the affected faces and reasons                                 |
| Template / version previews | Warning listing each face, the reason and the number of text objects                                 |
| Canonical SVG               | `data-font-substitute="true"` on the `<text>`; an issue outline when issues are shown                |
| Document validation         | `TEXT_FONT_NOT_CONTROLLED` for text without a controlled font                                        |

Glyph coverage is checked separately: characters outside the font's `unicodeRanges` are reported as
`MISSING_GLYPHS` (the browser would otherwise quietly draw them from a fallback font).

## Text layout engine

All consumers ask one engine where text goes: `createTextLayoutEngine` in
`packages/rendering-core/src/text-layout.ts`.

```text
TextObject ──▶ TextLayoutEngine ──▶ TextLayout { lines (text, x, baseline y, width), fontSize,
                  │                              anchor, direction, overflow, missingGlyphs }
                  └─ TextMeasurer (platform-specific advance widths, exact font file)
```

- **Measurers.** The browser measurer uses canvas `measureText` with the loaded `st-font-…`
  family at a 100 px reference size (avoids small-size rounding) and caches results. Node uses a
  deterministic approximate measurer (`approximate-v1`) for tests and tooling only. The future
  server renderer supplies its own measurer loading the same asset.
- **Line breaking** (`wrap: WORD`): paragraphs split at `\n`; break opportunities come from
  `Intl.Segmenter` word segmentation in the text's `language`; punctuation not separated by
  whitespace stays attached (`ST-1001`, `19.99`). A single word wider than the frame breaks between
  grapheme clusters (never inside one).
- **Vertical metrics.** Baselines follow the CSS line-box model: line advance = `fontSize ×
lineHeight`, half-leading distributed above and below the font's ascender + descender from the
  registry. Unknown metrics fall back to a documented approximation (`metricsSource: APPROXIMATE`).
- **Alignment and direction.** `START`/`END` respect the resolved direction (`AUTO` detects the
  first strong character); anchors map to canvas `textAlign` and SVG `text-anchor`.
- **Overflow.** `overflow.mode` `CLIP` clips to the frame, `VISIBLE` does not, `SHRINK_TO_FIT`
  binary-searches the largest size (0.01 pt steps, not below `minFontSize`) at which no line is
  wider than the frame, no word had to break and the block fits the height. Anything that still
  does not fit sets `overflow: true` and shows the overflow indicator; it is never hidden.
- **Caching.** Layouts are memoized per immutable object snapshot and invalidated when fonts load.

The canvas (`drawArtwork`) and the canonical SVG serializer both draw the engine's lines at the
engine's baselines, which is why the compare overlay in the designer lines up.

## Parity limitations (known, by design for Phase 2)

The browser editor and SVG preview rely on the browser's text shaper for glyph selection. Line
positions are shared, glyph shaping inside a line is not yet under our control. Known gaps before
a production PDF renderer exists:

| Area                                  | Phase 2 behaviour                                                                                                                                       | Production requirement                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Shaping, kerning, ligatures           | Browser shaping (HarfBuzz in Chromium, CoreText in Safari) for both measurement and drawing                                                             | HarfBuzz with the same font file on the server; OpenType features pinned |
| Complex scripts (Bengali, Devanagari) | Conjuncts and vowel reordering come from the browser shaper with the exact font (Noto Sans Bengali in the seed); widths are measured on shaped text     | Same shaping engine on server; golden tests per script                   |
| Arabic / Hebrew                       | RTL paragraphs lay out and align correctly; joining forms come from the browser                                                                         | Shaping on server; verified mirroring of punctuation                     |
| Mixed-direction lines (bidi)          | Lines are broken in logical order; the browser reorders each line when drawing. Break positions can differ from UAX #9 reference layouts in mixed lines | Full bidi algorithm before line breaking                                 |
| CJK line breaking                     | `Intl.Segmenter` dictionary segmentation; no kinsoku (line-start/end prohibition) rules                                                                 | UAX #14 plus kinsoku rules                                               |
| Hyphenation                           | None                                                                                                                                                    | Language-aware hyphenation, if required per customer                     |
| `JUSTIFY`                             | Rendered as `START`                                                                                                                                     | Inter-word justification in the engine                                   |
| Letter spacing                        | Canvas `letterSpacing` where the browser supports it, SVG `letter-spacing`; browsers without canvas support draw unspaced text on the canvas only       | Applied per glyph by the renderer                                        |
| Tabs, soft hyphens, zero-width spaces | Not given special treatment                                                                                                                             | Defined behaviour in the engine                                          |
| Barcode human-readable text           | Uncontrolled monospace stack (`OCR-B`, `Noto Sans Mono`, `monospace`)                                                                                   | Controlled symbology font per standard                                   |
| Browser differences                   | Sub-point width differences between browsers can move a wrap point                                                                                      | Server renderer is the reference for print                               |

Until then the rule is: **the server-side renderer will be the print reference**; the browser is a
faithful editor that surfaces every case where it is not using the exact font or where text does
not fit.
