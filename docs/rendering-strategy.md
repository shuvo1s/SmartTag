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
   │  buildPageScene()               rendering-core: renderer-agnostic display list
   ▼
PageScene
   ├── renderSceneToSvg()            Phase 1: browser previews, snapshot tests
   ├── PDF renderer                  later: print-ready PDF (PDF/X), CMYK, spot colours
   └── raster renderer               later: PNG thumbnails / proofs
```

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
- Barcodes and QR codes render as **clearly labelled, hatched placeholders**, never as fake bars
  that could be mistaken for scannable artwork.

## Phase 1 limitations (intentional)

| Area     | Phase 1                                                | Production renderer                                                                    |
| -------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Text     | Explicit `\n` lines, approximate ascent, browser fonts | Real font metrics, shaping (HarfBuzz), bidi, wrapping, `SHRINK_TO_FIT`, font embedding |
| Color    | RGB preview, naive CMYK/spot fallback                  | ICC-managed output intents, CMYK, spot separations                                     |
| Barcodes | Placeholders                                           | `barcode-core` encoder → vector bars with exact X-dimension and quiet zones            |
| Images   | `<image>` with fit; crop not applied                   | Cropping, effective-PPI preflight (`computeEffectiveResolution`), colour conversion    |
| Output   | SVG                                                    | PDF/X, PNG; imposition later                                                           |

## Determinism and reproducibility

The long-term guarantee is:

```text
TemplateVersion (documentHash) + Dataset (datasetHash) + RendererVersion = reproducible output
```

Phase 1 foundations:

- **Document hash**: SHA-256 of the RFC 8785 canonical JSON (`computeDocumentHash`). It is stored
  on every version, re-verified before submission and approval, and independent of key order and
  formatting.
- **Renderer version**: `RENDERING_CORE_VERSION`, to be recorded alongside rendered outputs.
- **Pinned inputs**: production jobs will reference a TemplateVersion id and checksummed assets
  (`checksumSha256`), never "latest".

Rules for the future server-side renderer:

- No wall-clock time, randomness or locale-dependent formatting in output.
- Fonts are assets (checksummed), never system fonts.
- Renderer and encoder library versions are part of the output manifest.
- Golden-file tests: fixture document + dataset give a known output hash.
