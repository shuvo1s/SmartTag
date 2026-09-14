# Browser canvas strategy

The designer uses **Fabric.js 7** for interactive editing, isolated in `packages/canvas-adapter`.
Fabric is an **adapter**, never the source of truth. Implementation details:
[editor.md](editor.md).

```text
                  ┌───────────────────────────────┐
 load version ───▶│   Canonical DesignDocument    │◀─── save (validated, hashed, expectedRevision)
                  └──────────────┬────────────────┘
          sync (identity diff)   │  ▲  one command per finished gesture (readCanonical)
                                 ▼  │
                  ┌───────────────────────────────┐
                  │ canvas-adapter (Fabric.js)    │  editor-only state: handles, hover, snap
                  └───────────────────────────────┘  guides, viewport (zoom/pan)
```

## Rules

1. **Raw Fabric.js JSON is never persisted.** There is no Fabric serialization path at all, and the
   strict schema rejects unknown keys, so Fabric output could not be saved even by accident.
2. **Fabric stays in one package.** `document-schema`, `document-utils`, `rendering-core`,
   `editor-core`, `barcode-core` and the API have no Fabric dependency; nothing Fabric needs
   internally was added to the canonical schema.
3. **One custom Fabric object per canonical object.** `ArtworkFabricObject` keeps the canonical
   snapshot and draws it with the shared renderer code (`drawArtwork`: text layout engine, symbol
   geometry, image placement). Fabric supplies transforms, controls and hit-testing only — there is
   no `fabric.Textbox`/`fabric.Image` whose own layout could diverge from the canonical renderer.
4. **Units.** One Fabric unit is one point in trim space. Zoom and pan live only in the viewport
   transform (`CSS px = pt × 96/72 × zoom`, device pixel ratio handled by Fabric). Scale factors are
   folded into `width/height` when a gesture ends, so canonical objects never carry scale.
5. **Rotation convention.** Centre origin and centred rotation match the canonical "clockwise about
   the frame centre". Skew and flips are locked; a transform that still contains them is rejected.
6. **Ids are stable.** Canvas objects carry the canonical id. New objects, duplicates and pasted
   copies get fresh ids from `createElementId()`.
7. **Bindings are not canvas properties.** The canvas shows a data-bound badge; bindings stay in the
   canonical `bindings` map.
8. **Every save validates.** The editor validates and hashes before saving; the API validates again
   (plus tenant asset and font checks), recomputes the hash and enforces the revision.
9. **Editor-only state stays out** of the document: selection, guides, zoom, pan, snapping, undo
   history, hover.
10. **Guides are overlays**, drawn in render hooks — not objects that could be selected or saved.

## Adapter tests (implemented)

`packages/canvas-adapter/test` (Vitest, jsdom + node-canvas):

- Round trip per object type and for complete documents (v2 sample, migrated v1):
  Canonical → Fabric → Canonical is identical and hashes identically; 20 cycles without drift.
- Zoom (10 %–800 %) and pan never change read-back geometry.
- Move changes only `x/y`; resize bakes scale into `width/height`; rotation normalizes to `[0, 360)`;
  lines keep zero height; active-selection transforms read back absolute frames.
- Skew and mirroring are reported as unsupported and leave the canonical object untouched.
- One undoable command per finished gesture; locked objects never move.
- Layer order, visibility and page switches mirror the store; selection syncs both ways.
- Rendering draws real barcode bars and reports font, overflow and symbol issues; symbols are
  encoded once per object snapshot.
- Browser services register exact font files under unique family names and measure with them.
- 120 objects load, render and commit within interactive budgets.

## Why this matters

Swapping canvas libraries, rendering on the server, running VDP or importing from other tools
must never require migrating stored designs. The canonical preview and the designer's compare
mode prove continuously that the stored model renders without any canvas library involved.
