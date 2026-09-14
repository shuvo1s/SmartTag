# Rendering strategy

## Pipeline

```text
TemplateVersion.documentJson
   │  parseDesignDocument()          migrate + validate (never render unvalidated JSON)
   ▼
DesignDocument
   │  resolveDocumentBindings()      optional: apply a data record (VDP)
   ▼
DesignDocument (resolved)
   │  buildPageScene(doc, page, { textLayout, barcodeEncoder })
   ▼                                 rendering-core: renderer-agnostic display list
PageScene
   ├── renderSceneToSvg()            previews, designer preview/compare, tests
   ├── PDF renderer                  later: print-ready PDF (PDF/X), CMYK, spot colours
   └── raster renderer               later: PNG thumbnails / proofs

DesignDocument objects
   └── drawArtwork()                 designer canvas (canvas-adapter) — same building blocks
```

Shared building blocks used by **every** output, so the canvas, the SVG and the future PDF agree:

| Building block               | Package                                              | Purpose                                                                                            |
| ---------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `TextLayoutEngine`           | rendering-core                                       | Line breaking, shrink-to-fit, baselines, overflow, missing glyphs ([typography.md](typography.md)) |
| `barcodeSymbol` / `qrSymbol` | rendering-core + barcode-core                        | Validate value → encode → vector bar/module rectangles with quiet zones and guard bars             |
| `computeImagePlacement`      | rendering-core                                       | Exact contain/cover/stretch and crop rectangles                                                    |
| `buildPageGuides`            | rendering-core                                       | Bleed/trim/safe/margin boxes and mirrored dieline features (non-printing)                          |
| `BarcodeEncoder`             | barcode-core (contract), barcode-bwip (bwip-js 4.11) | Library-independent encoding; the application's composition root chooses the adapter               |

### `PageScene` (rendering-core)

The scene is plain data in trim-space points. It holds every decision that must be the same for
all output formats:

- trim / bleed / safe / margin boxes and trim corner radius
- visible objects in paint order (`zIndex`, then array order), honouring object and group visibility
- text lines with explicit baselines, logical alignment resolved to anchors, detected direction
- colors converted for preview (`colorToCss`; CMYK/spot use a naive, profile-less formula)
- dieline features mirrored for back pages
- a `dataBound` flag per node

Serializers only translate primitives; they never interpret the document model.

### SVG serializer

- Output is deterministic: the same scene and options give byte-identical SVG, so it is suitable
  for snapshot tests.
- Every text node and attribute value is XML-escaped. Font family names are sanitised. Image URLs
  are allow-listed (`https:`, relative, `blob:`, raster `data:`). Tests assert that no markup or
  event-handler injection is possible.
- Guides (bleed, trim, safe, margins, dieline) are a separate, non-printing layer.
- `finish: 'TRIM'` masks artwork to the finished shape (rounded corners, punch holes).
- **Barcodes and QR codes** render as real vector geometry when an encoder is supplied: CODE128 and
  EAN-13 (`PREVIEW_ENABLED_SYMBOLOGIES`) and QR codes with their error-correction level. Values are
  validated centrally first (check digits, character sets, QR capacity). Invalid values, other
  symbologies and renders without an encoder show a **clearly labelled, hatched placeholder** —
  never fake bars that could be mistaken for scannable artwork.
- **Text** is drawn from the layout engine's lines and baselines. With `resolveFontFamily` the SVG
  names the exact loaded font (`st-font-<assetId>`); text without it is marked
  `data-font-substitute="true"` and reported
  ([typography.md](typography.md#missing-fonts-never-silent)).
- **Images** use `resolveAssetSize` for exact fit and crop; URLs stay allow-listed.
- `showIssues` outlines overflowing text, missing glyphs, substitute fonts and unencodable symbols
  (non-printing; designer compare mode).

## Current limitations (Phase 2, intentional)

| Area     | Phase 2 (browser)                                                                                                      | Production renderer (later)                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Text     | Controlled font files, registry metrics, word wrap, `SHRINK_TO_FIT`, overflow; glyph shaping by the browser            | Server-side shaping (HarfBuzz) with the same files, full bidi, font embedding |
| Color    | RGB preview, naive CMYK/spot fallback                                                                                  | ICC-managed output intents, CMYK, spot separations                            |
| Barcodes | Real CODE128, EAN-13 and QR vector geometry; other symbologies are placeholders; human-readable text font uncontrolled | All enabled symbologies, X-dimension/bar-width reduction, verified HRI text   |
| Images   | Exact fit and crop; effective-PPI rating in the designer                                                               | Colour conversion, image preflight                                            |
| Output   | SVG and canvas                                                                                                         | PDF/X, PNG; imposition later                                                  |

## Determinism and reproducibility

The long-term guarantee is:

```text
TemplateVersion (documentHash) + Dataset (datasetHash) + RendererVersion = reproducible output
```

Phase 1 foundations:

- **Document hash**: SHA-256 of the RFC 8785 canonical JSON (`computeDocumentHash`). It is stored
  on every version, re-verified before submission and approval, and independent of key order and
  formatting.
- **Renderer version**: `RENDERING_CORE_VERSION` (0.2.0 in Phase 2), plus the barcode encoder's
  `name`/`version` and the text measurer id, to be recorded alongside rendered outputs.
- **Pinned inputs**: production jobs will reference a TemplateVersion id and checksummed assets
  (`checksumSha256`), never "latest".

Rules for the future server-side renderer:

- No wall-clock time, randomness or locale-dependent formatting in output.
- Fonts are assets (checksummed), never system fonts.
- Renderer and encoder library versions are part of the output manifest.
- Golden-file tests: fixture document + dataset give a known output hash.
