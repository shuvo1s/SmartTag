# Browser canvas strategy

The Phase 2 designer will likely use **Fabric.js** or a similar canvas library for interactive
editing. That library is an **adapter**, never the source of truth.

```text
                  ┌───────────────────────────────┐
 load version ───▶│   Canonical DesignDocument    │◀─── save (validated, hashed)
                  └──────────────┬────────────────┘
                     toCanvas()  │  ▲  fromCanvas()
                                 ▼  │
                  ┌───────────────────────────────┐
                  │ Canvas adapter (Fabric.js …)  │  editor-only state: selection, handles,
                  └───────────────────────────────┘  snapping, undo stack, viewport, zoom
```

## Rules

1. **Raw Fabric.js JSON is never persisted.** The strict schema rejects unknown keys, so Fabric
   output could not be saved even by accident.
2. **The adapter maps both ways, explicitly, per object type.** For example
   `text ↔ fabric.Textbox`, `rectangle ↔ fabric.Rect`, `image ↔ fabric.Image` (source from the asset
   URL), `barcode/qrCode ↔ fabric.Group` placeholder bitmaps produced by `barcode-core` encoders.
3. **Units are converted at the boundary.** Canvas pixels = points × zoom × DPR. Stored values stay
   in points. Fabric's `scaleX/scaleY` are folded back into `width/height` on save, so canonical
   objects never carry scale factors.
4. **Rotation convention.** Fabric objects are configured with centred rotation, matching the
   canonical "clockwise about frame centre".
5. **Ids are stable.** Canvas objects carry the canonical element id. New objects get ids from
   `createElementId()`; builders (`createTextObject`, …) supply every required key.
6. **Bindings are not canvas properties.** The editor shows field bindings (chips/badges) and edits
   `bindings`. The canvas displays either static values or a sample record (`resolveDocumentBindings`).
7. **Every save validates.** `fromCanvas()` output goes through `validateDesignDocument`. The API
   validates again (plus asset/tenant checks) and computes the hash server-side.
8. **Editor-only state stays out** of the document: selection, guides, zoom, snapping, undo history.

## Required adapter tests (Phase 2)

- Round trip: `fromCanvas(toCanvas(doc))` hashes identically to `doc` for all fixtures.
- Scale folding: resizing an object changes `width/height`, never leaves scale factors behind.
- Rotation: rotating about the centre produces canonical `rotation` in `[0, 360)`.
- Unicode/RTL text survives (Bengali, Arabic).
- Unknown/unsupported canvas objects are rejected, not silently dropped.

## Why this matters

Swapping canvas libraries, rendering on the server, running VDP or importing from other tools
must never require migrating stored designs. The Phase 1 **Document playground** already proves
that the canonical document renders in the browser with no canvas library involved.
